// Great-circle routes: evenly spaced points along the shortest path on the sphere, with an optional
// arc that rises in the middle (for flight routes drawn above the globe).

import type { LngLat } from "./mercator.ts";

const DEG = Math.PI / 180;
export const MEAN_EARTH_RADIUS_M = 6371008.8;

function toVector(p: LngLat): [number, number, number] {
  const lat = p.lat * DEG;
  const lng = p.lng * DEG;
  return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
}

/** Central angle between two places, in radians. */
export function centralAngle(a: LngLat, b: LngLat): number {
  const va = toVector(a);
  const vb = toVector(b);
  const cross = [va[1] * vb[2] - va[2] * vb[1], va[2] * vb[0] - va[0] * vb[2], va[0] * vb[1] - va[1] * vb[0]];
  const dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
  return Math.atan2(Math.hypot(cross[0], cross[1], cross[2]), dot);
}

export function distanceMeters(a: LngLat, b: LngLat): number {
  return centralAngle(a, b) * MEAN_EARTH_RADIUS_M;
}

export type RoutePoint = { lat: number; lng: number; altitude: number };

/**
 * `count` points from a to b (both included). Longitudes stay continuous (no jump at ±180).
 * `arcHeight` is the altitude at the middle as a fraction of the route length (0 for a surface line).
 */
export function greatCircle(a: LngLat, b: LngLat, count: number, arcHeight = 0): RoutePoint[] {
  const omega = centralAngle(a, b);
  const va = toVector(a);
  const vb = toVector(b);
  const length = omega * MEAN_EARTH_RADIUS_M;
  const points: RoutePoint[] = [];
  let previousLng = a.lng;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    let v: number[];
    if (omega < 1e-9) v = va;
    else {
      const s = Math.sin(omega);
      const wa = Math.sin((1 - t) * omega) / s;
      const wb = Math.sin(t * omega) / s;
      v = [wa * va[0] + wb * vb[0], wa * va[1] + wb * vb[1], wa * va[2] + wb * vb[2]];
    }
    const lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / DEG;
    let lng = Math.atan2(v[1], v[0]) / DEG;
    lng += 360 * Math.round((previousLng - lng) / 360);
    previousLng = lng;
    points.push({ lat, lng, altitude: arcHeight * length * Math.sin(Math.PI * t) });
  }
  points[0] = { lat: a.lat, lng: a.lng, altitude: 0 };
  // The end point exactly, on the same side of the antimeridian as the route before it.
  points[count - 1] = { lat: b.lat, lng: b.lng + 360 * Math.round((points[count - 1].lng - b.lng) / 360), altitude: 0 };
  return points;
}
