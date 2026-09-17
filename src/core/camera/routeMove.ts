// A camera move along a line (a great-circle route, a GPS track, a road): the centre travels along
// the line, the zoom either arcs up and down like a flight or blends level, and the bearing can turn
// with the direction of travel, looking a little ahead and smoothed so corners never snap.
//
// The move always starts exactly on `from` and lands exactly on `to`: when those views are not on the
// line's ends, the camera glides from the first view onto the line and off its end to the last view.

import { lngLatToWorld, unwrapLongitudeNear, worldToLngLat, type LngLat, type Point } from "../geo/mercator.ts";
import type { View, Viewport } from "./camera.ts";
import { DEFAULT_RHO, shortestAngleDelta, zoomPanProfile } from "./flyPath.ts";

export type RouteMoveOptions = {
  /** "arc": zoom out in the middle like a flight. "level": blend the zoom evenly. Default "arc". */
  zoom?: "arc" | "level";
  rho?: number;
  /** Turn the camera with the direction of travel. Default true. */
  followBearing?: boolean;
  /** How far ahead the camera looks, as a fraction of the line (0 to 0.25). Default 0.03. */
  lookAhead?: number;
  /** Length of line the heading is averaged over, as a fraction of the line (0.005 to 0.5). Default 0.08. */
  smoothing?: number;
  /** Fraction of the move over which the bearing blends from the first view and into the last. Default 0.2. */
  bearingBlend?: number;
  pitchDip?: boolean;
  pitchZooms?: number;
};

export type RouteMove = {
  at: (t: number) => View;
  topZoom: number;
  /** Length of the travelled line in world pixels at zoom 0. */
  length: number;
};

const smoothstep = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/** A polyline in world pixels at zoom 0 with lookups by fraction of its length. */
export class Polyline {
  readonly points: Point[];
  readonly lengths: number[];
  readonly total: number;

  constructor(line: LngLat[]) {
    const points: Point[] = [];
    let previous: number | null = null;
    for (const p of line) {
      const lng: number = previous === null ? p.lng : unwrapLongitudeNear(p.lng, previous);
      previous = lng;
      const w = lngLatToWorld({ lng, lat: p.lat }, 0);
      const last = points[points.length - 1];
      if (!last || Math.hypot(w.x - last.x, w.y - last.y) > 1e-12) points.push(w);
    }
    if (!points.length) throw new Error("a route needs at least one point");
    this.points = points;
    this.lengths = [0];
    for (let i = 1; i < points.length; i++) this.lengths.push(this.lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    this.total = this.lengths[this.lengths.length - 1];
  }

  /** The point at a fraction of the length; fractions outside [0, 1] continue straight past the ends. */
  pointAt(fraction: number): Point {
    const n = this.points.length;
    if (n === 1 || this.total === 0) return this.points[0];
    const distance = fraction * this.total;
    let i: number;
    if (distance <= 0) i = 1;
    else if (distance >= this.total) i = n - 1;
    else {
      // Binary search for the segment that holds the distance.
      let lo = 1;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.lengths[mid] < distance) lo = mid + 1;
        else hi = mid;
      }
      i = lo;
    }
    const a = this.points[i - 1];
    const b = this.points[i];
    const span = this.lengths[i] - this.lengths[i - 1];
    const k = span > 0 ? (distance - this.lengths[i - 1]) / span : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  /** Compass heading of travel (degrees clockwise from north) over a window around a fraction. */
  headingAt(fraction: number, window: number): number {
    const half = Math.max(1e-4, window / 2);
    const a = this.pointAt(Math.max(0, fraction - half));
    const b = this.pointAt(Math.min(1, fraction + half));
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-15) return 0;
    // World y grows to the south.
    return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  }
}

export function routeMove(line: LngLat[], from: View, to: View, viewport: Viewport, options: RouteMoveOptions = {}): RouteMove {
  // Glide from the first view onto the line and from its end to the last view.
  const path = new Polyline([from.center, ...line, to.center]);
  const startZoom = from.zoom;
  const scale = Math.pow(2, startZoom);
  const w0 = Math.max(viewport.width, viewport.height);
  const w1 = w0 / Math.pow(2, to.zoom - startZoom);
  const widthRatio = w1 / w0;
  const arc = (options.zoom ?? "arc") === "arc";
  const profile = arc ? zoomPanProfile(w0, w1, path.total * scale, options.rho ?? DEFAULT_RHO) : null;
  const usable = !!profile && profile.length > 0 && Number.isFinite(profile.length) && path.total > 0;

  const follow = (options.followBearing ?? true) && path.total > 0;
  const lookAhead = Math.max(0, Math.min(0.25, options.lookAhead ?? 0.03));
  const window = Math.max(0.005, Math.min(0.5, options.smoothing ?? 0.08));
  const blend = Math.max(0.01, Math.min(0.5, options.bearingBlend ?? 0.2));
  const range = options.pitchZooms ?? 2.5;
  const keepFor = (endZoom: number, zoom: number) => 1 - smoothstep((endZoom - zoom) / range);

  // Headings are sampled once and unwrapped, so the bearing never spins the long way round.
  const SAMPLES = 256;
  const headings: number[] = [];
  if (follow) {
    for (let i = 0; i <= SAMPLES; i++) {
      const raw = path.headingAt(Math.min(1, i / SAMPLES + lookAhead), window);
      const reference = i === 0 ? from.bearing : headings[i - 1];
      headings.push(reference + shortestAngleDelta(reference, raw));
    }
  }
  const headingAt = (fraction: number): number => {
    const x = Math.max(0, Math.min(1, fraction)) * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(x));
    return headings[i] + (headings[i + 1] - headings[i]) * (x - i);
  };
  const landingBearing = follow ? headings[SAMPLES] + shortestAngleDelta(headings[SAMPLES], to.bearing) : from.bearing + shortestAngleDelta(from.bearing, to.bearing);
  const endWorld = path.pointAt(1);
  const landingCenter: LngLat = { lat: to.center.lat, lng: worldToLngLat(endWorld, 0).lng };

  const at = (progress: number): View => {
    const t = Math.max(0, Math.min(1, progress));
    if (t === 0) return { center: { ...from.center }, zoom: from.zoom, bearing: from.bearing, pitch: from.pitch };
    if (t === 1) return { center: landingCenter, zoom: to.zoom, bearing: landingBearing, pitch: to.pitch };
    // Level: the zoom blends evenly and the distance grows with the visible width, which keeps the
    // speed on screen constant.
    let fraction = Math.abs(widthRatio - 1) < 1e-9 ? t : (1 - Math.pow(widthRatio, t)) / (1 - widthRatio);
    let zoom = from.zoom + (to.zoom - from.zoom) * t;
    if (usable && profile) {
      const s = t * profile.length;
      fraction = Math.max(0, Math.min(1, profile.panFraction(s)));
      zoom = startZoom + Math.log2(1 / profile.widthRatio(s));
    }
    const center = worldToLngLat(path.pointAt(fraction), 0);
    let bearing: number;
    if (follow) {
      const heading = headingAt(fraction);
      const leaving = from.bearing + (heading - from.bearing) * smoothstep(t / blend);
      bearing = leaving + (landingBearing - leaving) * smoothstep((t - (1 - blend)) / blend);
    } else {
      bearing = from.bearing + (landingBearing - from.bearing) * t;
    }
    let pitch = from.pitch + (to.pitch - from.pitch) * t;
    if (arc && (options.pitchDip ?? true)) pitch = from.pitch * keepFor(from.zoom, zoom) * (1 - t) + to.pitch * keepFor(to.zoom, zoom) * t;
    return { center, zoom, bearing, pitch };
  };

  const topZoom = usable && profile ? Math.min(from.zoom, to.zoom, startZoom - profile.climb) : Math.min(from.zoom, to.zoom);
  return { at, topZoom, length: path.total };
}
