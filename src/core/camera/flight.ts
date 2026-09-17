// Camera flights baked into keyframes: the van Wijk–Nuij path (flyPath.ts), eased like After Effects'
// Easy Ease, with the pitch easing towards straight down while the camera is high up, so a pitched
// shot does not stay pitched over a whole continent.

import type { View, Viewport } from "./camera.ts";
import { flyPath } from "./flyPath.ts";

/** A CSS/After Effects style cubic Bézier easing from (0,0) to (1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const dx = (t: number) => 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton steps, then bisection if the slope is too flat.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = bx(t) - x;
      const slope = dx(t);
      if (Math.abs(err) < 1e-9) return by(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60; i++) {
      const v = bx(t);
      if (Math.abs(v - x) < 1e-9) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return by(t);
  };
}

/** After Effects' Easy Ease (33.33 % influence on both keys). */
export const easyEase = cubicBezier(1 / 3, 0, 2 / 3, 1);

export type FlightOptions = {
  duration: number;
  frameRate: number;
  startTime?: number;
  easing?: (t: number) => number;
  /**
   * Let each end's pitch fade out as the camera climbs above that end (default true): the pitch is
   * flat when the camera is more than `pitchZooms` zoom levels above it.
   */
  pitchDip?: boolean;
  pitchZooms?: number;
  rho?: number;
};

export type FlightKey = { time: number; view: View };

export function flightKeys(from: View, to: View, viewport: Viewport, options: FlightOptions): FlightKey[] {
  const path = flyPath(from, to, viewport, { rho: options.rho });
  const easing = options.easing ?? easyEase;
  const frames = Math.max(1, Math.round(options.duration * options.frameRate));
  const start = options.startTime ?? 0;
  const range = options.pitchZooms ?? 2.5;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  // 1 at or below an end's zoom, fading to 0 once the camera is `range` zoom levels above it.
  const keepFor = (endZoom: number, zoom: number) => 1 - smooth(Math.max(0, Math.min(1, (endZoom - zoom) / range)));
  const keys: FlightKey[] = [];
  for (let i = 0; i <= frames; i++) {
    const t = easing(i / frames);
    const view = path.at(t);
    if (options.pitchDip ?? true) {
      view.pitch = from.pitch * keepFor(from.zoom, view.zoom) * (1 - t) + to.pitch * keepFor(to.zoom, view.zoom) * t;
    }
    keys.push({ time: start + i / options.frameRate, view });
  }
  // Start and land exactly on the given views.
  keys[0].view = { center: { ...from.center }, zoom: from.zoom, bearing: from.bearing, pitch: from.pitch };
  keys[keys.length - 1].view = { center: { lat: to.center.lat, lng: keys[keys.length - 1].view.center.lng }, zoom: to.zoom, bearing: keys[keys.length - 1].view.bearing, pitch: to.pitch };
  return keys;
}
