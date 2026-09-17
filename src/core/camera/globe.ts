// Camera projection for maps rendered with MapLibre's "globe" projection, including points above the
// surface. Written from MapLibre GL's public behaviour and its open-source (BSD-3) transforms:
//
// Globe (vertical perspective). The planet is a sphere whose radius in pixels keeps the map scale of
// the view centre: R = worldSize / (2π) / cos(centre latitude). A unit surface vector
// (sin λ cos φ, sin φ, cos λ cos φ), scaled by R (and by 1 + altitude / earth radius), is turned so
// the centre faces the camera (Ry(-λc), then Rx(φc)), moved back by R, turned by the bearing (Rz) and
// the pitch (Rx(-pitch)), and moved back by the camera distance D. The camera looks down -z with y up:
//   screen = (W/2 + D·x / w, H/2 - D·y / w), w = -z.
//
// Mercator. The closed form of core/camera/camera.ts, extended with height above the ground.
//
// Transition. MapLibre's "globe" projection is a globe up to zoom 11 and Mercator from zoom 12. In
// between, its shaders mix the two clip-space positions by globeness = 12 - zoom, and divide
// afterwards; this module does the same, so points match the rendered pixels at every zoom.

import { cameraToCenterDistance, type View, type Viewport } from "./camera.ts";
import { lngLatToWorld, unwrapLongitudeNear, type LngLat } from "../geo/mercator.ts";

export type MapProjection = "mercator" | "globe";

/** MapLibre's earth radius in metres (used for globe altitude and Mercator pixels per metre). */
export const EARTH_RADIUS_M = 6371008.8;

export const GLOBE_TO_MERCATOR = { from: 11, to: 12 } as const;

const DEG = Math.PI / 180;

/** 1 while fully a globe, 0 once fully Mercator. */
export function globeness(zoom: number, projection: MapProjection = "globe"): number {
  if (projection === "mercator") return 0;
  return Math.max(0, Math.min(1, (GLOBE_TO_MERCATOR.to - zoom) / (GLOBE_TO_MERCATOR.to - GLOBE_TO_MERCATOR.from)));
}

export function globeRadiusPixels(view: View): number {
  return (512 * Math.pow(2, view.zoom)) / (2 * Math.PI) / Math.cos(view.center.lat * DEG);
}

export type ProjectedPoint3 = {
  x: number;
  y: number;
  /** Clip-space w in pixels: distance along the view axis. */
  w: number;
  /** In front of the camera and not hidden behind the planet. */
  visible: boolean;
};

type PixelClip = { px: number; py: number; w: number; visible: boolean };

function mercatorClip(view: View, viewport: Viewport, point: LngLat, altitudeMeters: number): PixelClip {
  const d = cameraToCenterDistance(viewport);
  const center = lngLatToWorld(view.center, view.zoom);
  const target = lngLatToWorld({ lng: unwrapLongitudeNear(point.lng, view.center.lng), lat: point.lat }, view.zoom);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const b = view.bearing * DEG;
  const p = view.pitch * DEG;
  const xr = Math.cos(b) * dx + Math.sin(b) * dy;
  const yr = -Math.sin(b) * dx + Math.cos(b) * dy;
  const pixelsPerMeter = (512 * Math.pow(2, view.zoom)) / (2 * Math.PI * EARTH_RADIUS_M * Math.cos(view.center.lat * DEG));
  const h = altitudeMeters * pixelsPerMeter;
  const w = d - yr * Math.sin(p) - h * Math.cos(p);
  return { px: d * xr, py: d * (yr * Math.cos(p) - h * Math.sin(p)), w, visible: w > 1e-6 };
}

function globeClip(view: View, viewport: Viewport, point: LngLat, altitudeMeters: number): PixelClip {
  const d = cameraToCenterDistance(viewport);
  const r = globeRadiusPixels(view);
  const lambda = point.lng * DEG;
  const phi = point.lat * DEG;
  const lift = r * (1 + altitudeMeters / EARTH_RADIUS_M);
  let x = Math.sin(lambda) * Math.cos(phi) * lift;
  let y = Math.sin(phi) * lift;
  let z = Math.cos(lambda) * Math.cos(phi) * lift;
  // Ry(-centre longitude)
  const cl = Math.cos(-view.center.lng * DEG);
  const sl = Math.sin(-view.center.lng * DEG);
  [x, z] = [cl * x + sl * z, -sl * x + cl * z];
  // Rx(centre latitude)
  const cp = Math.cos(view.center.lat * DEG);
  const sp = Math.sin(view.center.lat * DEG);
  [y, z] = [cp * y - sp * z, sp * y + cp * z];
  z -= r;
  // Rz(bearing)
  const cb = Math.cos(view.bearing * DEG);
  const sb = Math.sin(view.bearing * DEG);
  [x, y] = [cb * x - sb * y, sb * x + cb * y];
  // Rx(-pitch)
  const ct = Math.cos(view.pitch * DEG);
  const st = Math.sin(view.pitch * DEG);
  [y, z] = [ct * y + st * z, -st * y + ct * z];
  z -= d;
  const w = -z;

  // The planet centre in view space, for occlusion.
  const cx = 0;
  const cy = -r * st;
  const cz = -r * ct - d;
  let visible = w > 1e-6;
  if (visible) {
    if (altitudeMeters <= 0) {
      // A surface point is visible when its outward normal faces the camera at the origin.
      visible = (x - cx) * -x + (y - cy) * -y + (z - cz) * -z > 0;
    } else {
      // A raised point is hidden when the line of sight from the camera passes through the planet.
      const lengthSq = x * x + y * y + z * z;
      const t = Math.max(0, Math.min(1, (cx * x + cy * y + cz * z) / lengthSq));
      const ex = t * x - cx;
      const ey = t * y - cy;
      const ez = t * z - cz;
      visible = ex * ex + ey * ey + ez * ez >= r * r;
    }
  }
  return { px: d * x, py: -d * y, w, visible };
}

/**
 * Projects a geographic point (optionally above the ground) to screen pixels, for the Mercator or the
 * globe projection. With the globe projection, zooms between 11 and 12 mix both like MapLibre does.
 */
export function projectPoint(view: View, viewport: Viewport, point: LngLat, options: { projection?: MapProjection; altitudeMeters?: number } = {}): ProjectedPoint3 {
  const altitude = options.altitudeMeters ?? 0;
  const t = globeness(view.zoom, options.projection ?? "mercator");
  let clip: PixelClip;
  if (t === 0) clip = mercatorClip(view, viewport, point, altitude);
  else if (t === 1) clip = globeClip(view, viewport, point, altitude);
  else {
    const flat = mercatorClip(view, viewport, point, altitude);
    const round = globeClip(view, viewport, point, altitude);
    clip = {
      px: flat.px + (round.px - flat.px) * t,
      py: flat.py + (round.py - flat.py) * t,
      w: flat.w + (round.w - flat.w) * t,
      visible: round.visible && flat.w + (round.w - flat.w) * t > 1e-6
    };
  }
  return { x: viewport.width / 2 + clip.px / clip.w, y: viewport.height / 2 + clip.py / clip.w, w: clip.w, visible: clip.visible };
}
