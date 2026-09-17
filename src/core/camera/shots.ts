// The shot list: a camera described as key views ("shots") with a hold on each and a move into each.
//
//   shot 1 (hold, optional orbit / push / globe spin)
//     move: fly | straight | route | cut, with a duration and an easing
//   shot 2 ...
//
// The list is the source of the camera animation. `bakeShots` turns it into keys for the five map
// controls (one key per frame while the camera moves, two keys for a still hold), and `shotViewAt`
// gives the view at any time for previews. Durations snap to whole frames. Longitude and bearing stay
// continuous from shot to shot, so nothing ever spins the long way round.

import { clampLatitude, lngLatToWorld, unwrapLongitudeNear, worldToLngLat, type LngLat } from "../geo/mercator.ts";
import { greatCircle } from "../geo/greatCircle.ts";
import type { View, Viewport } from "./camera.ts";
import { DEFAULT_EASING, EASING_IDS, easingFunction, type Easing, type EasingId } from "./easing.ts";
import { flight } from "./flight.ts";
import { flyPath, shortestAngleDelta } from "./flyPath.ts";
import { routeMove } from "./routeMove.ts";

export const MOVE_KINDS = ["fly", "straight", "route", "cut"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

export const FLIGHT_HEIGHTS = { low: 1.0, normal: 1.42, high: 1.9 } as const;
export type FlightHeight = keyof typeof FLIGHT_HEIGHTS;

export type RouteSettings = {
  /** Places the route passes through ([lng, lat]); great circles join them. Empty: from shot to shot. */
  waypoints?: [number, number][];
  /** An explicit line ([lng, lat]), such as a GPS track. Wins over waypoints. */
  line?: [number, number][];
  followBearing?: boolean;
  lookAhead?: number;
  smoothing?: number;
  /** Keep the zoom level instead of arcing up like a flight. */
  level?: boolean;
};

export type Move = {
  kind: MoveKind;
  seconds: number;
  easing: Easing;
  height?: FlightHeight;
  /** Level the pitch out while the camera is high above both ends (fly and arcing routes). Default true. */
  pitchDip?: boolean;
  route?: RouteSettings;
};

export type Shot = {
  id: string;
  name: string;
  view: View;
  /** Seconds the camera stays on the shot. */
  hold: number;
  /** Motion during the hold: degrees of bearing, zoom levels, degrees of longitude (a turning globe). */
  orbit?: number;
  push?: number;
  spin?: number;
  holdEasing?: Easing;
  /** How the camera gets here from the previous shot. Ignored for the first shot. */
  move: Move;
};

export type ShotList = { v: 1; start: number; shots: Shot[] };

export const DEFAULT_MOVE: Move = { kind: "fly", seconds: 6, easing: { id: "smooth" }, height: "normal", pitchDip: true };

export const MAX_ZOOM = 22;
export const MAX_PITCH = 85;

const finite = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

function normaliseEasing(raw: unknown, fallback: Easing): Easing {
  const e = raw as Partial<Easing> | undefined;
  if (!e || typeof e !== "object" || !EASING_IDS.includes(e.id as EasingId)) return { ...fallback };
  if (e.id !== "custom") return { id: e.id as EasingId };
  const b = Array.isArray(e.bezier) && e.bezier.length === 4 ? e.bezier.map((v) => finite(v, 0)) : [1 / 3, 0, 2 / 3, 1];
  return { id: "custom", bezier: [b[0], b[1], b[2], b[3]] };
}

function normalisePairs(raw: unknown): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: [number, number][] = [];
  for (const p of raw) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]);
  return out.length >= 2 ? out : undefined;
}

export function normaliseView(raw: unknown): View {
  const v = (raw ?? {}) as Partial<View>;
  const c = (v.center ?? {}) as Partial<LngLat>;
  return {
    center: { lat: clampLatitude(finite(c.lat, 0)), lng: finite(c.lng, 0) },
    zoom: clamp(finite(v.zoom, 1), 0, MAX_ZOOM),
    bearing: finite(v.bearing, 0),
    pitch: clamp(finite(v.pitch, 0), 0, MAX_PITCH)
  };
}

export function normaliseMove(raw: unknown): Move {
  const m = (raw ?? {}) as Partial<Move>;
  const kind: MoveKind = MOVE_KINDS.includes(m.kind as MoveKind) ? (m.kind as MoveKind) : "fly";
  const move: Move = {
    kind,
    seconds: clamp(finite(m.seconds, DEFAULT_MOVE.seconds), 0, 600),
    easing: normaliseEasing(m.easing, DEFAULT_EASING),
    height: m.height && m.height in FLIGHT_HEIGHTS ? m.height : "normal",
    pitchDip: m.pitchDip !== false
  };
  if (kind === "route") {
    const r = (m.route ?? {}) as RouteSettings;
    move.route = {
      waypoints: normalisePairs(r.waypoints),
      line: normalisePairs(r.line),
      // Turning with the route suits level routes (a road, a track); an arcing flight keeps its bearing.
      followBearing: typeof r.followBearing === "boolean" ? r.followBearing : r.level === true,
      lookAhead: clamp(finite(r.lookAhead, 0.03), 0, 0.25),
      smoothing: clamp(finite(r.smoothing, 0.08), 0.005, 0.5),
      level: r.level === true
    };
  }
  return move;
}

/** Reads a shot list from stored data; anything missing or out of range becomes a safe default. */
export function normaliseShotList(raw: unknown): ShotList {
  const list = (raw ?? {}) as Partial<ShotList>;
  const shots: Shot[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of (Array.isArray(list.shots) ? list.shots : []).entries()) {
    const s = (entry ?? {}) as Partial<Shot>;
    let id = typeof s.id === "string" && s.id ? s.id : `s${index + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    shots.push({
      id,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : `Shot ${index + 1}`,
      view: normaliseView(s.view),
      hold: clamp(finite(s.hold, 2), 0, 600),
      orbit: clamp(finite(s.orbit, 0), -3600, 3600),
      push: clamp(finite(s.push, 0), -10, 10),
      spin: clamp(finite(s.spin, 0), -3600, 3600),
      holdEasing: normaliseEasing(s.holdEasing, { id: "smooth" }),
      move: normaliseMove(s.move)
    });
  }
  return { v: 1, start: Math.max(0, finite(list.start, 0)), shots };
}

export type Segment = {
  kind: "hold" | "move";
  /** Index of the shot held, or of the shot the move arrives at. */
  shot: number;
  startFrame: number;
  endFrame: number;
  /** A cut: zero frames long; the next segment starts on a new view. */
  cut: boolean;
  /** View at progress k in [0, 1] of the segment (easing included). */
  at: (k: number) => View;
  topZoom: number;
};

export type Timeline = {
  frameRate: number;
  /** Frame (of the scene comp) the first shot starts on. */
  startFrame: number;
  endFrame: number;
  segments: Segment[];
  /** Per shot: the frames it is held from and to, with the continuous views at both ends. */
  shots: { arriveFrame: number; leaveFrame: number; arrival: View; departure: View }[];
};

function routeLine(move: Move, from: View, to: View): LngLat[] {
  const r = move.route ?? {};
  if (r.line) return r.line.map(([lng, lat]) => ({ lng, lat }));
  const stops: LngLat[] = r.waypoints ? r.waypoints.map(([lng, lat]) => ({ lng, lat })) : [from.center, to.center];
  const line: LngLat[] = [];
  for (let i = 1; i < stops.length; i++) {
    const leg = greatCircle(stops[i - 1], stops[i], 96);
    for (const p of i === 1 ? leg : leg.slice(1)) line.push({ lng: p.lng, lat: p.lat });
  }
  return line.length ? line : [from.center, to.center];
}

/** "Straight": the zoom changes evenly and the centre moves at a constant speed on screen. */
function straightMove(from: View, to: View): (t: number) => View {
  const endLng = unwrapLongitudeNear(to.center.lng, from.center.lng);
  const endBearing = from.bearing + shortestAngleDelta(from.bearing, to.bearing);
  const a = lngLatToWorld(from.center, 0);
  const b = lngLatToWorld({ lng: endLng, lat: to.center.lat }, 0);
  // Visible width at the end relative to the start.
  const ratio = Math.pow(2, -(to.zoom - from.zoom));
  return (progress: number) => {
    const t = clamp(progress, 0, 1);
    if (t === 0) return { center: { ...from.center }, zoom: from.zoom, bearing: from.bearing, pitch: from.pitch };
    if (t === 1) return { center: { lat: to.center.lat, lng: endLng }, zoom: to.zoom, bearing: endBearing, pitch: to.pitch };
    // Distance covered grows with the visible width, which keeps the speed on screen constant.
    const f = Math.abs(ratio - 1) < 1e-9 ? t : (1 - Math.pow(ratio, t)) / (1 - ratio);
    return {
      center: worldToLngLat({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, 0),
      zoom: from.zoom + (to.zoom - from.zoom) * t,
      bearing: from.bearing + (endBearing - from.bearing) * t,
      pitch: from.pitch + (to.pitch - from.pitch) * t
    };
  };
}

export function buildTimeline(list: ShotList, viewport: Viewport, frameRate: number): Timeline {
  const fps = frameRate > 0 ? frameRate : 25;
  const frames = (seconds: number) => Math.max(0, Math.round(seconds * fps));
  const startFrame = frames(list.start);
  const segments: Segment[] = [];
  const shots: Timeline["shots"] = [];
  let frame = startFrame;
  let previous: View | null = null;

  list.shots.forEach((shot, index) => {
    let arrival: View = { center: { ...shot.view.center }, zoom: shot.view.zoom, bearing: shot.view.bearing, pitch: shot.view.pitch };
    if (previous) {
      const from = previous;
      const move = shot.move;
      const ease = easingFunction(move.easing);
      if (move.kind === "cut") {
        segments.push({ kind: "move", shot: index, startFrame: frame, endFrame: frame, cut: true, at: () => arrival, topZoom: arrival.zoom });
      } else {
        const length = Math.max(1, frames(move.seconds));
        let at: (t: number) => View;
        let topZoom = Math.min(from.zoom, shot.view.zoom);
        const rho = FLIGHT_HEIGHTS[move.height ?? "normal"];
        if (move.kind === "straight") at = straightMove(from, shot.view);
        else if (move.kind === "route") {
          const r = move.route ?? {};
          const path = routeMove(routeLine(move, from, shot.view), from, shot.view, viewport, {
            zoom: r.level ? "level" : "arc",
            rho,
            followBearing: r.followBearing,
            lookAhead: r.lookAhead,
            smoothing: r.smoothing,
            pitchDip: move.pitchDip
          });
          at = path.at;
          topZoom = path.topZoom;
        } else {
          const path = flight(from, shot.view, viewport, { rho, pitchDip: move.pitchDip });
          at = path.at;
          topZoom = path.topZoom;
        }
        arrival = at(1);
        const sample = at;
        segments.push({ kind: "move", shot: index, startFrame: frame, endFrame: frame + length, cut: false, at: (k) => sample(k <= 0 ? 0 : k >= 1 ? 1 : ease(k)), topZoom });
        frame += length;
      }
    }
    const hold = frames(shot.hold);
    const orbit = shot.orbit ?? 0;
    const push = shot.push ?? 0;
    const spin = shot.spin ?? 0;
    const departure: View = {
      center: { lat: arrival.center.lat, lng: arrival.center.lng + (hold ? spin : 0) },
      zoom: clamp(arrival.zoom + (hold ? push : 0), 0, MAX_ZOOM),
      bearing: arrival.bearing + (hold ? orbit : 0),
      pitch: arrival.pitch
    };
    const holdEase = easingFunction(shot.holdEasing ?? { id: "smooth" });
    const still = !hold || (orbit === 0 && push === 0 && spin === 0);
    const held = arrival;
    segments.push({
      kind: "hold",
      shot: index,
      startFrame: frame,
      endFrame: frame + hold,
      cut: false,
      at: still
        ? () => held
        : (k) => {
            const e = k <= 0 ? 0 : k >= 1 ? 1 : holdEase(k);
            return {
              center: { lat: held.center.lat, lng: held.center.lng + (departure.center.lng - held.center.lng) * e },
              zoom: held.zoom + (departure.zoom - held.zoom) * e,
              bearing: held.bearing + (departure.bearing - held.bearing) * e,
              pitch: held.pitch
            };
          },
      topZoom: Math.min(held.zoom, departure.zoom)
    });
    shots.push({ arriveFrame: frame, leaveFrame: frame + hold, arrival, departure });
    frame += hold;
    previous = departure;
  });

  return { frameRate: fps, startFrame, endFrame: frame, segments, shots };
}

/** The view on a frame of the scene comp. Before the first shot and after the last, the camera holds. */
export function viewAtFrame(timeline: Timeline, frame: number): View | null {
  const { segments } = timeline;
  if (!segments.length) return null;
  if (frame <= timeline.startFrame) return segments[0].at(0);
  if (frame >= timeline.endFrame) return segments[segments.length - 1].at(1);
  // On a boundary the later segment wins, so a cut shows its new view on its own frame.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.endFrame === s.startFrame || frame < s.startFrame || frame > s.endFrame) continue;
    return s.at((frame - s.startFrame) / (s.endFrame - s.startFrame));
  }
  return segments[segments.length - 1].at(1);
}

export const CONTROL_KEYS = ["lat", "lng", "zoom", "bearing", "pitch"] as const;
export type ControlKey = (typeof CONTROL_KEYS)[number];

export type BakedShots = {
  frameRate: number;
  startTime: number;
  endTime: number;
  frames: number;
  /** Keys per map control; times are scene comp seconds. */
  controls: { key: ControlKey; times: number[]; values: number[] }[];
  /** Key times whose outgoing interpolation must be Hold (the frame before a cut). */
  holdTimes: number[];
  markers: { time: number; name: string; shotId: string }[];
  topZoom: number;
  /** Keys written in total, and how many a key on every frame would have needed. */
  keyCount: number;
  denseKeyCount: number;
};

const valueOf = (view: View, key: ControlKey): number =>
  key === "lat" ? view.center.lat : key === "lng" ? view.center.lng : key === "zoom" ? view.zoom : key === "bearing" ? view.bearing : view.pitch;

export function bakeShots(list: ShotList, viewport: Viewport, frameRate: number): BakedShots {
  const timeline = buildTimeline(list, viewport, frameRate);
  const fps = timeline.frameRate;
  const first = timeline.startFrame;
  if (!list.shots.length) {
    return { frameRate: fps, startTime: first / fps, endTime: first / fps, frames: 0, controls: CONTROL_KEYS.map((key) => ({ key, times: [], values: [] })), holdTimes: [], markers: [], topZoom: 0, keyCount: 0, denseKeyCount: 0 };
  }
  const count = timeline.endFrame - first + 1;
  const views: View[] = [];
  for (let f = 0; f < count; f++) views.push(viewAtFrame(timeline, first + f)!);

  // Frames that always keep their keys: both ends of every segment, and the frames around a cut.
  const keep = new Set<number>([0, count - 1]);
  const holdFrames: number[] = [];
  for (const s of timeline.segments) {
    keep.add(s.startFrame - first);
    keep.add(s.endFrame - first);
    if (s.cut && s.startFrame > first) {
      keep.add(s.startFrame - first - 1);
      holdFrames.push(s.startFrame - first - 1);
    }
  }

  const controls = CONTROL_KEYS.map((key) => {
    const times: number[] = [];
    const values: number[] = [];
    for (let f = 0; f < count; f++) {
      const v = valueOf(views[f], key);
      const still = f > 0 && f < count - 1 && Math.abs(v - valueOf(views[f - 1], key)) < 1e-12 && Math.abs(valueOf(views[f + 1], key) - v) < 1e-12;
      if (still && !keep.has(f)) continue;
      times.push((first + f) / fps);
      values.push(v);
    }
    return { key, times, values };
  });

  return {
    frameRate: fps,
    startTime: first / fps,
    endTime: timeline.endFrame / fps,
    frames: count,
    controls,
    holdTimes: holdFrames.map((f) => (first + f) / fps),
    markers: list.shots.map((shot, i) => ({ time: timeline.shots[i].arriveFrame / fps, name: shot.name, shotId: shot.id })),
    topZoom: timeline.segments.reduce((low, s) => Math.min(low, s.topZoom), Infinity),
    keyCount: controls.reduce((n, c) => n + c.times.length, 0),
    denseKeyCount: count * CONTROL_KEYS.length
  };
}

/**
 * A duration for a flight that feels unhurried: the van Wijk–Nuij path length at a calm speed,
 * between 2 and 20 seconds, in half seconds.
 */
export function suggestedMoveSeconds(from: View, to: View, viewport: Viewport): number {
  const length = flyPath(from, to, viewport).length;
  if (!Number.isFinite(length)) return DEFAULT_MOVE.seconds;
  const turn = Math.abs(shortestAngleDelta(from.bearing, to.bearing)) / 90 + Math.abs(to.pitch - from.pitch) / 60;
  return clamp(Math.round((length / 0.75 + turn) * 2) / 2, 2, 20);
}

export function newShotId(existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let n = taken.size + 1; ; n++) if (!taken.has(`s${n}`)) return `s${n}`;
}
