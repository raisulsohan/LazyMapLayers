// A line made ready for a route layer in After Effects, whose expressions project every point on
// every frame: thinned to a budget of points, and with long legs cut into short pieces so they bend
// with the globe instead of crossing it as one straight stroke.

import { centralAngle, greatCircle } from "./greatCircle.ts";
import { lngLatToWorld, worldToLngLat, type LngLat } from "./mercator.ts";
import { continuousLine, cumulativeKm, simplifyLineIndices } from "./simplify.ts";

export type PreparedLine = {
  points: LngLat[];
  /** How far along the original line (km on the ground) each point lies; never decreases. */
  km: number[];
};

export type PrepareOptions = {
  maxPoints: number;
  /**
   * True: a long leg follows the great circle, the shortest way between two places (lines that join
   * places, such as flights and tracks). False: it stays straight on the flat map (outlines of areas).
   */
  geodesic: boolean;
  /** Legs longer than this many degrees of arc are cut into pieces (default 2). */
  maxLegDegrees?: number;
};

const DEG = Math.PI / 180;

export function prepareRouteLine(line: LngLat[], options: PrepareOptions): PreparedLine {
  if (line.length < 2) return { points: line.slice(), km: line.map(() => 0) };
  const continuous = continuousLine(line);
  const along = cumulativeKm(line);
  const budget = Math.max(2, options.maxPoints);

  // Long legs may use up to half of the budget; the pieces get longer when the line is very long.
  let arc = 0;
  for (let i = 1; i < line.length; i++) arc += centralAngle(line[i - 1], line[i]) / DEG;
  const step = Math.max(options.maxLegDegrees ?? 2, arc / (budget / 2));
  let kept = simplifyLineIndices(line, budget);
  const piecesOf = (indices: number[]) => {
    let extra = 0;
    for (let k = 1; k < indices.length; k++) extra += Math.max(0, Math.ceil(centralAngle(line[indices[k - 1]], line[indices[k]]) / DEG / step) - 1);
    return extra;
  };
  const extra = piecesOf(kept);
  if (extra > 0 && kept.length + extra > budget) kept = simplifyLineIndices(line, Math.max(2, budget - extra));

  const points: LngLat[] = [continuous[kept[0]]];
  const km: number[] = [along[kept[0]]];
  // Whole turns added when a great circle reached its end on the other side of ±180.
  let shift = 0;
  for (let k = 1; k < kept.length; k++) {
    const from = points[points.length - 1];
    const to = { lat: continuous[kept[k]].lat, lng: continuous[kept[k]].lng + shift };
    const fromKm = along[kept[k - 1]];
    const toKm = along[kept[k]];
    const pieces = Math.ceil(centralAngle(from, to) / DEG / step);
    if (pieces > 1) {
      if (options.geodesic) {
        const curve = greatCircle(from, to, pieces + 1);
        for (let j = 1; j < pieces; j++) {
          points.push({ lat: curve[j].lat, lng: curve[j].lng });
          km.push(fromKm + ((toKm - fromKm) * j) / pieces);
        }
        // The great circle may reach the end on the other side of ±180: the line carries on from there.
        shift += curve[pieces].lng - to.lng;
        points.push({ lat: to.lat, lng: curve[pieces].lng });
        km.push(toKm);
        continue;
      }
      const a = lngLatToWorld(from, 0);
      const b = lngLatToWorld(to, 0);
      for (let j = 1; j < pieces; j++) {
        const t = j / pieces;
        points.push(worldToLngLat({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 0));
        km.push(fromKm + (toKm - fromKm) * t);
      }
    }
    points.push(to);
    km.push(toKm);
  }
  return { points, km };
}
