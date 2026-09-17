// Smooth and efficient zooming and panning (J. J. van Wijk and W. A. A. Nuij, IEEE InfoVis 2003).
//
// The path zooms out and back in at the same time as it pans, so the camera speed on screen stays
// perceptually constant. There is no "hold the position, zoom out, pan, zoom in" split. The maths
// works in world pixels at the start zoom; `rho` trades zooming against panning (1.42 is the value
// the paper found most pleasant, and the one MapLibre's flyTo uses).

import { lngLatToWorld, worldToLngLat, unwrapLongitudeNear } from "../geo/mercator.ts";
import type { View, Viewport } from "./camera.ts";

export type FlyPathOptions = {
  /** Zoom/pan trade-off. Larger values zoom out further. Default 1.42. */
  rho?: number;
  /** Optional cap on how far the path may zoom out. Overrides rho when given. */
  minZoom?: number;
};

export type FlyPath = {
  /** View at progress t in [0, 1]. Pitch and bearing move linearly with t (bearing the short way). */
  at: (t: number) => View;
  /** Path length in the paper's units. Divide by a speed (MapLibre uses 1.2 per second) for a duration. */
  length: number;
  /** Lowest zoom the path reaches. */
  minZoomReached: number;
};

export const DEFAULT_RHO = 1.42;
const EPSILON = 1e-6;

export type ZoomPanProfile = {
  /** Path length in the paper's units. */
  length: number;
  /** Visible width at s in [0, length], relative to the start width. */
  widthRatio: (s: number) => number;
  /** Distance travelled at s, as a fraction of the whole distance (0 when there is no distance). */
  panFraction: (s: number) => number;
  /** The smallest scale (largest width) on the way, as zoom levels below the start zoom (0 or more). */
  climb: number;
};

/**
 * The optimal zoom-and-pan profile for travelling `distance` (world pixels at the start zoom) while
 * the visible width goes from `startWidth` to `endWidth`. The distance may run along any curve.
 */
export function zoomPanProfile(startWidth: number, endWidth: number, distance: number, rho = DEFAULT_RHO): ZoomPanProfile {
  const w0 = startWidth;
  const w1 = endWidth;
  const u1 = distance;
  const rho2 = rho * rho;
  // r(0) and r(1) from the paper: b_i and r_i = ln(sqrt(b_i^2 + 1) - b_i).
  const r = (i: 0 | 1): number => {
    const b = (w1 * w1 - w0 * w0 + (i === 1 ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i === 1 ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(b * b + 1) - b);
  };
  const r0 = u1 > EPSILON ? r(0) : 0;
  const pathLength = u1 > EPSILON ? (r(1) - r0) / rho : Number.NaN;

  if (u1 <= EPSILON || !Number.isFinite(pathLength)) {
    // Pure zoom (or no movement at all): exponential zoom, no pan.
    const direction = w1 < w0 ? -1 : 1;
    return {
      length: Math.abs(Math.log(w1 / w0)) / rho,
      widthRatio: (s) => Math.exp(direction * rho * s),
      panFraction: () => 0,
      climb: 0
    };
  }
  const widthRatio = (s: number) => Math.cosh(r0) / Math.cosh(r0 + rho * s);
  const panFraction = (s: number) => (w0 * ((Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2)) / u1;
  // The widest view is where cosh(r0 + rho * s) is smallest, i.e. r0 + rho * s = 0.
  const sPeak = -r0 / rho;
  const climb = sPeak > 0 && sPeak < pathLength ? Math.max(0, -Math.log2(1 / widthRatio(sPeak))) : 0;
  return { length: pathLength, widthRatio, panFraction, climb };
}

/** The rho that makes a move of `distance` climb no higher than `capZoom` (see FlyPathOptions.minZoom). */
export function rhoForMinZoom(startWidth: number, startZoom: number, capZoom: number, distance: number): number {
  const wMax = startWidth / Math.pow(2, capZoom - startZoom);
  return Math.sqrt((wMax / distance) * 2);
}

export function flyPath(from: View, to: View, viewport: Viewport, options: FlyPathOptions = {}): FlyPath {
  const startZoom = from.zoom;
  const targetCenter = { lng: unwrapLongitudeNear(to.center.lng, from.center.lng), lat: to.center.lat };
  const startWorld = lngLatToWorld(from.center, startZoom);
  const targetWorld = lngLatToWorld(targetCenter, startZoom);
  const deltaX = targetWorld.x - startWorld.x;
  const deltaY = targetWorld.y - startWorld.y;

  const w0 = Math.max(viewport.width, viewport.height);
  const w1 = w0 / Math.pow(2, to.zoom - startZoom);
  const u1 = Math.hypot(deltaX, deltaY);

  let rho = options.rho ?? DEFAULT_RHO;
  if (options.minZoom !== undefined && u1 > EPSILON) rho = rhoForMinZoom(w0, startZoom, Math.min(options.minZoom, from.zoom, to.zoom), u1);
  const profile = zoomPanProfile(w0, w1, u1, rho);
  const length = profile.length;

  const bearingDelta = shortestAngleDelta(from.bearing, to.bearing);

  const at = (t: number): View => {
    const k = Math.max(0, Math.min(1, t));
    if (k === 1) {
      return { center: targetCenter, zoom: to.zoom, bearing: from.bearing + bearingDelta, pitch: to.pitch };
    }
    const s = k * length;
    const scale = 1 / profile.widthRatio(s);
    const zoom = length === 0 ? startZoom + (to.zoom - startZoom) * k : startZoom + Math.log2(scale);
    const f = profile.panFraction(s);
    const center = worldToLngLat({ x: startWorld.x + deltaX * f, y: startWorld.y + deltaY * f }, startZoom);
    return {
      center,
      zoom,
      bearing: from.bearing + bearingDelta * k,
      pitch: from.pitch + (to.pitch - from.pitch) * k
    };
  };

  return { at, length, minZoomReached: Math.min(from.zoom, to.zoom, startZoom - profile.climb) };
}

export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  const delta = (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  return delta === -180 ? 180 : delta;
}
