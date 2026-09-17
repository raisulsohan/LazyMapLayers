// Line simplification (Douglas–Peucker) in Web Mercator space, so the tolerance means the same on
// screen everywhere on the line. Used to keep imported tracks light enough for After Effects
// expressions, which project every point on every frame.

import { lngLatToWorld, unwrapLongitudeNear, type LngLat, type Point } from "./mercator.ts";

function keepFlags(points: Point[], tolerance: number): Uint8Array {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const limit = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      let t = length2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = p.x - (a.x + dx * t);
      const ey = p.y - (a.y + dy * t);
      const distance2 = ex * ex + ey * ey;
      if (distance2 > worst) {
        worst = distance2;
        index = i;
      }
    }
    if (index > 0 && worst > limit) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return keep;
}

/**
 * The line with at most `maxPoints` points: the tolerance starts at a tiny fraction of the line's
 * extent and doubles until the line is light enough. Longitudes stay continuous across the
 * antimeridian. Lines that are short already come back unchanged.
 */
export function simplifyLine(line: LngLat[], maxPoints: number): LngLat[] {
  if (line.length <= Math.max(2, maxPoints)) return line;
  const continuous: LngLat[] = [];
  for (const p of line) continuous.push({ lat: p.lat, lng: continuous.length ? unwrapLongitudeNear(p.lng, continuous[continuous.length - 1].lng) : p.lng });
  const world = continuous.map((p) => lngLatToWorld(p, 0));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of world) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  let tolerance = Math.max(1e-12, Math.hypot(maxX - minX, maxY - minY) / 20000);
  for (let round = 0; round < 40; round++) {
    const keep = keepFlags(world, tolerance);
    let count = 0;
    for (let i = 0; i < keep.length; i++) count += keep[i];
    if (count <= maxPoints) return continuous.filter((_, i) => keep[i] === 1);
    tolerance *= 1.6;
  }
  // A pathological line: fall back to even sampling.
  const step = (line.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => continuous[Math.round(i * step)]);
}

/** Length of a line in kilometres along the ground (haversine per segment). */
export function lineLengthKm(line: LngLat[]): number {
  const R = 6371.0088;
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return total;
}
