// Perspective map camera compatible with MapLibre GL's mercator transform.
//
// MapLibre places the camera at `cameraToCenterDistance = (height / 2) / tan(fov / 2)` screen
// pixels from the map centre, tilts the ground plane by `pitch` around the screen x axis and
// rotates it by `bearing`. Working that transform out gives a closed form that needs no matrices:
//
//   (dx, dy) = world point - centre, in world pixels at the view zoom
//   x' =  cos(b) * dx + sin(b) * dy
//   y' = -sin(b) * dx + cos(b) * dy
//   k  = D / (D - y' * sin(p))            (perspective scale at that point)
//   screen = (w / 2 + x' * k,  h / 2 + y' * cos(p) * k)
//
// The same numbers drive the After Effects rig, so AE layers and rendered frames line up.
// Spike S2 in docs/PLAN.md verifies this against MapLibre itself.

import {
  lngLatToWorld,
  worldToLngLat,
  unwrapLongitudeNear,
  type LngLat,
  type Point
} from "../geo/mercator.ts";

/** MapLibre's default vertical field of view (atan(0.75) * 2, about 36.87 degrees). */
export const DEFAULT_FOV_RAD = 0.6435011087932844;

export type View = {
  center: LngLat;
  zoom: number;
  /** Degrees clockwise from north, like MapLibre. */
  bearing: number;
  /** Degrees away from straight down, like MapLibre. */
  pitch: number;
};

export type Viewport = {
  width: number;
  height: number;
  /** Vertical field of view in radians. */
  fov?: number;
};

export type ProjectedPoint = Point & {
  /** Screen pixels per world pixel at this point; 1 at the centre of an unpitched view. */
  scale: number;
  /** False when the point is behind the camera or beyond the horizon. */
  visible: boolean;
};

const DEG = Math.PI / 180;

export function cameraToCenterDistance(viewport: Viewport): number {
  const fov = viewport.fov ?? DEFAULT_FOV_RAD;
  return viewport.height / 2 / Math.tan(fov / 2);
}

/** Projects a geographic point to screen pixels (origin top-left). */
export function project(view: View, viewport: Viewport, point: LngLat): ProjectedPoint {
  const center = lngLatToWorld(view.center, view.zoom);
  const target = lngLatToWorld(
    { lng: unwrapLongitudeNear(point.lng, view.center.lng), lat: point.lat },
    view.zoom
  );
  return projectWorldOffset(view, viewport, target.x - center.x, target.y - center.y);
}

/** Projects an offset from the view centre, given in world pixels at the view zoom. */
export function projectWorldOffset(view: View, viewport: Viewport, dx: number, dy: number): ProjectedPoint {
  const b = view.bearing * DEG;
  const p = view.pitch * DEG;
  const d = cameraToCenterDistance(viewport);
  const xr = Math.cos(b) * dx + Math.sin(b) * dy;
  const yr = -Math.sin(b) * dx + Math.cos(b) * dy;
  const depth = d - yr * Math.sin(p);
  const k = d / depth;
  return {
    x: viewport.width / 2 + xr * k,
    y: viewport.height / 2 + yr * Math.cos(p) * k,
    scale: k,
    visible: depth > 1e-6
  };
}

/**
 * Finds the geographic point under a screen pixel on the ground plane.
 * Returns null above the horizon.
 */
export function unproject(view: View, viewport: Viewport, screen: Point): LngLat | null {
  const b = view.bearing * DEG;
  const p = view.pitch * DEG;
  const d = cameraToCenterDistance(viewport);
  const u = screen.x - viewport.width / 2;
  const v = screen.y - viewport.height / 2;
  const denominator = d * Math.cos(p) + v * Math.sin(p);
  if (denominator <= 1e-9) return null;
  const yr = (v * d) / denominator;
  const xr = (u * (d - yr * Math.sin(p))) / d;
  const dx = Math.cos(b) * xr - Math.sin(b) * yr;
  const dy = Math.sin(b) * xr + Math.cos(b) * yr;
  const center = lngLatToWorld(view.center, view.zoom);
  return worldToLngLat({ x: center.x + dx, y: center.y + dy }, view.zoom);
}

/** Screen y of the horizon, or -Infinity when the horizon is not in front of the camera. */
export function horizonY(view: View, viewport: Viewport): number {
  const p = view.pitch * DEG;
  if (p <= 0) return -Infinity;
  return viewport.height / 2 - cameraToCenterDistance(viewport) / Math.tan(p);
}
