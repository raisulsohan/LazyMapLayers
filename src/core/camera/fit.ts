// Frames a set of places or a bounding box: the closest view at a given bearing and pitch that keeps
// everything inside the frame, with a margin. Works with pitched and rotated cameras because it uses
// the same projection as the renderer instead of a flat-map formula.

import { lngLatToWorld, unwrapLongitudeNear, worldToLngLat, type LngLat } from "../geo/mercator.ts";
import type { Bbox } from "../tiles/tileMath.ts";
import { project, unproject, type View, type Viewport } from "./camera.ts";

export type FitOptions = {
  bearing?: number;
  pitch?: number;
  /** Free margin on every side, as a fraction of the frame's smaller dimension. Default 0.1. */
  padding?: number;
  minZoom?: number;
  /** Also the zoom used for a single point. Default 16. */
  maxZoom?: number;
};

export function fitPoints(points: LngLat[], viewport: Viewport, options: FitOptions = {}): View {
  if (!points.length) throw new Error("fitPoints needs at least one point");
  const bearing = options.bearing ?? 0;
  const pitch = Math.max(0, Math.min(85, options.pitch ?? 0));
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxZoom ?? 16;
  const pad = Math.max(0, Math.min(0.45, options.padding ?? 0.1)) * Math.min(viewport.width, viewport.height);

  // Keep the longitudes on one side of the antimeridian, near the first point.
  const near: LngLat[] = [];
  for (const p of points) near.push({ lat: p.lat, lng: near.length ? unwrapLongitudeNear(p.lng, near[0].lng) : p.lng });

  // Start at the middle of the points in mercator space.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of near) {
    const w = lngLatToWorld(p, 0);
    minX = Math.min(minX, w.x);
    maxX = Math.max(maxX, w.x);
    minY = Math.min(minY, w.y);
    maxY = Math.max(maxY, w.y);
  }
  let center = worldToLngLat({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0);

  const inside = (view: View): boolean => {
    for (const p of near) {
      const s = project(view, viewport, p);
      if (!s.visible || s.x < pad || s.x > viewport.width - pad || s.y < pad || s.y > viewport.height - pad) return false;
    }
    return true;
  };

  /** The closest zoom around a centre that keeps every point inside the padded frame. */
  const closestZoom = (around: LngLat): number => {
    let lo = minZoom;
    let hi = maxZoom;
    if (!inside({ center: around, zoom: lo, bearing, pitch })) return lo;
    if (inside({ center: around, zoom: hi, bearing, pitch })) return hi;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (inside({ center: around, zoom: mid, bearing, pitch })) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  let zoom = minZoom;
  for (let round = 0; round < 8; round++) {
    zoom = closestZoom(center);
    // Centre the points' screen box: move the view to the ground point under the box's middle.
    const view: View = { center, zoom, bearing, pitch };
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const p of near) {
      const s = project(view, viewport, p);
      if (!s.visible) continue;
      left = Math.min(left, s.x);
      right = Math.max(right, s.x);
      top = Math.min(top, s.y);
      bottom = Math.max(bottom, s.y);
    }
    if (!Number.isFinite(left)) break;
    const moved = unproject(view, viewport, { x: (left + right) / 2, y: (top + bottom) / 2 });
    if (!moved) break;
    const shift = Math.hypot((left + right) / 2 - viewport.width / 2, (top + bottom) / 2 - viewport.height / 2);
    if (shift < 0.25) break;
    center = moved;
  }
  return { center, zoom: closestZoom(center), bearing, pitch };
}

/** Frames a bounding box; an east smaller than the west means the box crosses the antimeridian. */
export function fitBounds(bbox: Bbox, viewport: Viewport, options: FitOptions = {}): View {
  const east = bbox.east < bbox.west ? bbox.east + 360 : bbox.east;
  const points: LngLat[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = bbox.west + (east - bbox.west) * t;
    const lat = bbox.south + (bbox.north - bbox.south) * t;
    points.push({ lng, lat: bbox.south }, { lng, lat: bbox.north }, { lng: bbox.west, lat }, { lng: east, lat });
  }
  return fitPoints(points, viewport, options);
}
