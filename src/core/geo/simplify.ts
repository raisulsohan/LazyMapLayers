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

/** A line with longitudes made continuous across the antimeridian (no jump at ±180). */
export function continuousLine(line: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of line) out.push({ lat: p.lat, lng: out.length ? unwrapLongitudeNear(p.lng, out[out.length - 1].lng) : p.lng });
  return out;
}

/**
 * Indices of the points a line keeps when thinned to at most `maxPoints`: the tolerance starts at a
 * tiny fraction of the line's extent and grows until the line is light enough. Lines that are short
 * already keep every point.
 */
export function simplifyLineIndices(line: LngLat[], maxPoints: number): number[] {
  if (line.length <= Math.max(2, maxPoints)) return line.map((_, i) => i);
  const world = continuousLine(line).map((p) => lngLatToWorld(p, 0));
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
    const indices: number[] = [];
    for (let i = 0; i < keep.length; i++) if (keep[i] === 1) indices.push(i);
    if (indices.length <= maxPoints) return indices;
    tolerance *= 1.6;
  }
  // A pathological line: fall back to even sampling.
  const step = (line.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => Math.round(i * step));
}

/**
 * The line with at most `maxPoints` points (Douglas–Peucker). Longitudes stay continuous across the
 * antimeridian. Lines that are short already come back unchanged.
 */
export function simplifyLine(line: LngLat[], maxPoints: number): LngLat[] {
  if (line.length <= Math.max(2, maxPoints)) return line;
  const continuous = continuousLine(line);
  return simplifyLineIndices(line, maxPoints).map((i) => continuous[i]);
}

/** Indices of the points a curve of (x, y) values keeps within a tolerance (Douglas–Peucker). */
export function simplifyCurveIndices(points: Point[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = keepFlags(points, tolerance);
  const indices: number[] = [];
  for (let i = 0; i < keep.length; i++) if (keep[i] === 1) indices.push(i);
  return indices;
}

/**
 * Polygons ([polygon][ring][lng, lat]) within a budget of points: the largest rings keep most of the
 * budget, rings too small to matter are dropped, and coordinates are rounded to about a metre.
 */
export function simplifyPolygons(polygons: number[][][][], maxPoints: number): number[][][][] {
  const rings: { polygon: number; ring: number; points: number[][] }[] = [];
  polygons.forEach((polygon, p) => polygon.forEach((points, r) => points.length >= 4 && rings.push({ polygon: p, ring: r, points })));
  const total = rings.reduce((n, r) => n + r.points.length, 0);
  if (!total) return [];
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  const out: number[][][][] = polygons.map(() => []);
  for (const entry of rings) {
    const share = Math.floor((maxPoints * entry.points.length) / total);
    // An outer ring always stays; holes and islands that would get fewer than 6 points go.
    if (share < 6 && !(entry.ring === 0 && rings.length === 1)) {
      if (entry.ring === 0 && entry.points.length / total < 0.02) continue;
      if (entry.ring > 0) continue;
    }
    const light = simplifyLine(entry.points.map(([lng, lat]) => ({ lng, lat })), Math.max(6, share)).map((q) => [round(q.lng), round(q.lat)]);
    const first = light[0];
    const last = light[light.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) light.push([first[0], first[1]]);
    if (light.length >= 4) (out[entry.polygon][entry.ring] = light);
  }
  // Holes whose outer ring went, and empty polygons, go too; rings are re-packed.
  return out.map((polygon) => (polygon[0] ? polygon.filter(Boolean) : [])).filter((polygon) => polygon.length > 0);
}

/** Kilometres along the ground from the first point to each point of a line (haversine per segment). */
export function cumulativeKm(line: LngLat[]): number[] {
  const R = 6371.0088;
  const out: number[] = line.length ? [0] : [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    out.push(out[i - 1] + 2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  }
  return out;
}

/** Length of a line in kilometres along the ground. */
export function lineLengthKm(line: LngLat[]): number {
  return line.length ? cumulativeKm(line)[line.length - 1] : 0;
}
