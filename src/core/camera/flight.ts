// Camera flights baked into keyframes: the van Wijk–Nuij path (flyPath.ts), eased like After Effects'
// Easy Ease, with the pitch easing towards straight down while the camera is high up, so a pitched
// shot does not stay pitched over a whole continent.

import type { View, Viewport } from "./camera.ts";
import { cubicBezier, easyEase } from "./easing.ts";
import { flyPath } from "./flyPath.ts";

export { cubicBezier, easyEase };

export type FlightShape = {
  /**
   * Let each end's pitch fade out as the camera climbs above that end (default true): the pitch is
   * flat when the camera is more than `pitchZooms` zoom levels above it.
   */
  pitchDip?: boolean;
  pitchZooms?: number;
  rho?: number;
};

export type FlightOptions = FlightShape & {
  duration: number;
  frameRate: number;
  startTime?: number;
  easing?: (t: number) => number;
};

export type FlightKey = { time: number; view: View };

export type Flight = {
  /** The view at progress t in [0, 1] (apply the easing before calling). Starts and lands exactly. */
  at: (t: number) => View;
  /** Lowest zoom the flight reaches. */
  topZoom: number;
};

/** A flight as a function of progress. Longitude and bearing stay continuous (they may leave ±180). */
export function flight(from: View, to: View, viewport: Viewport, shape: FlightShape = {}): Flight {
  const path = flyPath(from, to, viewport, { rho: shape.rho });
  const range = shape.pitchZooms ?? 2.5;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  // 1 at or below an end's zoom, fading to 0 once the camera is `range` zoom levels above it.
  const keepFor = (endZoom: number, zoom: number) => 1 - smooth(Math.max(0, Math.min(1, (endZoom - zoom) / range)));
  const landing = path.at(1);
  const at = (progress: number): View => {
    const t = Math.max(0, Math.min(1, progress));
    if (t === 0) return { center: { ...from.center }, zoom: from.zoom, bearing: from.bearing, pitch: from.pitch };
    if (t === 1) return { center: { lat: to.center.lat, lng: landing.center.lng }, zoom: to.zoom, bearing: landing.bearing, pitch: to.pitch };
    const view = path.at(t);
    if (shape.pitchDip ?? true) {
      view.pitch = from.pitch * keepFor(from.zoom, view.zoom) * (1 - t) + to.pitch * keepFor(to.zoom, view.zoom) * t;
    }
    return view;
  };
  return { at, topZoom: path.minZoomReached };
}

export function flightKeys(from: View, to: View, viewport: Viewport, options: FlightOptions): FlightKey[] {
  const path = flight(from, to, viewport, options);
  const easing = options.easing ?? easyEase;
  const frames = Math.max(1, Math.round(options.duration * options.frameRate));
  const start = options.startTime ?? 0;
  const keys: FlightKey[] = [];
  for (let i = 0; i <= frames; i++) {
    const t = i === 0 ? 0 : i === frames ? 1 : easing(i / frames);
    keys.push({ time: start + i / options.frameRate, view: path.at(t) });
  }
  return keys;
}
