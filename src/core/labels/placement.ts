// Timeline-wide label placement.
//
// Labels are placed on every frame of the camera animation, not per still: on each frame the labels
// that were already on screen keep their place first (hysteresis), then new ones are added by
// priority wherever they do not overlap anything placed so far. Afterwards every appearance shorter
// than the minimum time on screen is dropped (dropping never causes an overlap), and each remaining
// appearance fades in after it starts and fades out before it ends. The result: no overlaps on any
// frame, no flicker, and no label that blinks on for a few frames.

import type { View, Viewport } from "../camera/camera.ts";
import { pixelOnGlobe, projectPoint, type MapProjection } from "../camera/globe.ts";

export type LabelCandidate = {
  id: string;
  lat: number;
  lng: number;
  /** Lower goes first. */
  priority: number;
  /** Box size in map comp pixels. */
  width: number;
  height: number;
  /** "center": the box is centred on the point. "right": a marker at the point, the box to its right. */
  anchor: "center" | "right";
  /** For "right": gap between the point and the box, and the marker radius kept free around the point. */
  offset?: number;
  markerRadius?: number;
  /** Visible from minZoom (inclusive) to maxZoom (exclusive). */
  minZoom: number;
  maxZoom: number;
};

export type PlacementOptions = {
  viewport: Viewport;
  projection?: MapProjection;
  /** Keep boxes this far inside the frame. */
  margin?: number;
  /** Extra space kept around every box. */
  padding?: number;
  /** Appearances shorter than this many frames are dropped. */
  minFrames?: number;
  /** Boxes nothing may overlap, per frame (for example pins and callouts). */
  keepOut?: (frame: number) => Box[];
};

export type Box = { x: number; y: number; width: number; height: number };

/** Frames [start, end) during which a label is shown. */
export type LabelTrack = { id: string; intervals: [number, number][] };

function boxFor(candidate: LabelCandidate, x: number, y: number, padding: number): Box {
  if (candidate.anchor === "center") {
    return { x: x - candidate.width / 2 - padding, y: y - candidate.height / 2 - padding, width: candidate.width + 2 * padding, height: candidate.height + 2 * padding };
  }
  const radius = candidate.markerRadius ?? 0;
  const left = x - radius;
  const right = x + (candidate.offset ?? 0) + candidate.width;
  const half = Math.max(candidate.height / 2, radius);
  return { x: left - padding, y: y - half - padding, width: right - left + 2 * padding, height: 2 * half + 2 * padding };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function placeLabels(candidates: LabelCandidate[], views: View[], options: PlacementOptions): LabelTrack[] {
  const { width, height } = options.viewport;
  const margin = options.margin ?? 0;
  const padding = options.padding ?? 0;
  const minFrames = options.minFrames ?? 1;
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const shownPerFrame: Set<string>[] = [];
  let previous = new Set<string>();

  for (let f = 0; f < views.length; f++) {
    const view = views[f];
    const placed: Box[] = [...(options.keepOut?.(f) ?? [])];
    const eligible: { candidate: LabelCandidate; box: Box }[] = [];
    for (const candidate of ordered) {
      if (view.zoom < candidate.minZoom || view.zoom >= candidate.maxZoom) continue;
      const p = projectPoint(view, options.viewport, candidate, { projection: options.projection ?? "mercator" });
      if (!p.visible) continue;
      const box = boxFor(candidate, p.x, p.y, padding);
      if (box.x + padding < margin || box.y + padding < margin || box.x + box.width - padding > width - margin || box.y + box.height - padding > height - margin) continue;
      // On a globe, the whole label must sit on the planet, not stick out into space.
      if (options.projection === "globe") {
        const x0 = box.x + padding;
        const y0 = box.y + padding;
        const x1 = box.x + box.width - padding;
        const y1 = box.y + box.height - padding;
        if (![[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([x, y]) => pixelOnGlobe(view, options.viewport, x, y, 0.985))) continue;
      }
      eligible.push({ candidate, box });
    }
    const shown = new Set<string>();
    // Labels already on screen keep their place first, then the rest by priority.
    for (const pass of [true, false]) {
      for (const { candidate, box } of eligible) {
        if (previous.has(candidate.id) !== pass) continue;
        if (placed.some((other) => overlaps(box, other))) continue;
        placed.push(box);
        shown.add(candidate.id);
      }
    }
    shownPerFrame.push(shown);
    previous = shown;
  }

  const tracks: LabelTrack[] = [];
  for (const candidate of ordered) {
    const intervals: [number, number][] = [];
    let start = -1;
    for (let f = 0; f <= views.length; f++) {
      const on = f < views.length && shownPerFrame[f].has(candidate.id);
      if (on && start < 0) start = f;
      if (!on && start >= 0) {
        if (f - start >= minFrames) intervals.push([start, f]);
        start = -1;
      }
    }
    if (intervals.length) tracks.push({ id: candidate.id, intervals });
  }
  return tracks;
}

/**
 * Opacity keyframes (time in frames, value 0 to 100) for a track: fade in over `fadeFrames` after
 * each appearance starts and out over `fadeFrames` before it ends (shorter appearances peak lower).
 *
 * The first and last frames of the comp are cuts, not appearances: a name already on screen when
 * the comp begins is there in full on its first frame, and one still on screen when it ends stays
 * until the last. Otherwise frame 0 of every map would show no names, and every comp would end in a
 * fade nobody asked for. `totalFrames` is the comp's length in frames.
 */
export function opacityKeys(track: LabelTrack, fadeFrames: number, totalFrames = Infinity): [number, number][] {
  const keys: [number, number][] = [];
  const add = (frame: number, value: number) => {
    const last = keys[keys.length - 1];
    if (last && last[0] === frame) return;
    keys.push([frame, value]);
  };
  for (const [start, end] of track.intervals) {
    const fromStart = start <= 0;
    const toEnd = end >= totalFrames;
    const length = end - start;
    const sides = (fromStart ? 0 : 1) + (toEnd ? 0 : 1);
    const fade = sides ? Math.min(fadeFrames, length / sides) : 0;
    add(start, fromStart ? 100 : 0);
    if (!fromStart) add(start + fade, 100);
    if (!toEnd) add(end - fade, 100);
    add(end, toEnd ? 100 : 0);
  }
  return keys;
}
