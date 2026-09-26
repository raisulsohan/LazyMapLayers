// What a designer does to shapes once they are picked: break a multi-part outline into its parts,
// cut one area out of another, count the points that fall inside an area, and draw the lines between
// a set of places. Everything here is plain geometry, so the panel can show the result before it
// builds a single layer.

import { areaKm2, cleanPolygons, centreOf, type Polygons } from "./combine.ts";
import { distanceMeters, greatCircle, type RoutePoint } from "./greatCircle.ts";
import { pointInPolygons } from "./pointInPolygon.ts";
import { difference, intersection } from "polyclip-ts";

export type LngLat = { lat: number; lng: number };

export type Part = { polygons: Polygons; km2: number; centre: LngLat | null };

/**
 * Every polygon of an outline on its own, largest first: the mainland of a country away from its
 * islands, one island of an archipelago, one field of a survey.
 */
export function explodeArea(polygons: Polygons): Part[] {
  return cleanPolygons(polygons)
    .map((polygon) => {
      const one: Polygons = [polygon];
      return { polygons: one, km2: areaKm2(one), centre: centreOf(one) };
    })
    .sort((a, b) => b.km2 - a.km2);
}

/** Whether every point of a ring lies inside an area. */
function ringInside(ring: number[][], polygons: Polygons): boolean {
  return ring.every((point) => pointInPolygons({ lng: point[0], lat: point[1] }, polygons));
}

export type Cut = {
  polygons: Polygons;
  /** Parts taken away: as a hole when they lay wholly inside, clipped when they overlapped an edge. */
  cut: number;
  /** Of those, the ones that crossed an edge and were clipped. */
  clipped: number;
  /** Parts that did not touch the area at all: nothing to take away. */
  outside: number;
};

/**
 * One area taken out of another: a lake out of a country, an enclave out of a state, the sea out of
 * a coastal district, one country out of a region it shares a border with.
 *
 * A part wholly inside the area becomes a hole of the polygon it sits in, exactly as it is. A part
 * that crosses the area's edge is clipped with a polygon clipper (polyclip-ts, DECISIONS D83), which
 * takes away only the overlap and can split the area into pieces. A part that does not touch the area
 * at all is counted and left alone.
 */
export function cutHole(outer: Polygons, inner: Polygons): Cut {
  let base = cleanPolygons(outer).map((polygon) => polygon.map((ring) => ring.map((point) => [point[0], point[1]])));
  const parts = cleanPolygons(inner);
  let cut = 0;
  let clipped = 0;
  let outside = 0;
  const crossing: Polygons = [];
  for (const part of parts) {
    const ring = part[0];
    const host = base.findIndex((polygon) => ringInside(ring, [polygon]));
    // Inside, and clear of the holes already there: a hole of its own, point for point.
    if (host >= 0 && !base[host].slice(1).some((hole) => ring.some((point) => pointInPolygons({ lng: point[0], lat: point[1] }, [[hole]])))) {
      base[host].push(ring.map((point) => [point[0], point[1]]));
      cut++;
      continue;
    }
    const overlap = base.length ? intersection(base as never, [part] as never) : [];
    if (!overlap.length) {
      outside++;
      continue;
    }
    crossing.push(part);
    cut++;
    clipped++;
  }
  if (crossing.length) base = cleanPolygons(difference(base as never, crossing as never) as unknown as Polygons);
  return { polygons: base, cut, clipped, outside };
}

/** The points that fall inside an area, by their place in the list. */
export function pointsInside(polygons: Polygons, points: LngLat[]): number[] {
  const area = cleanPolygons(polygons);
  if (!area.length) return [];
  const inside: number[] = [];
  points.forEach((point, index) => {
    if (pointInPolygons(point, area)) inside.push(index);
  });
  return inside;
}

export type MeshOptions = {
  /** Each place joins only its nearest neighbours; without it, every pair is joined. */
  neighbours?: number;
  /** Lines longer than this are left out. */
  maxKm?: number;
  /** Points per line. */
  steps?: number;
  /** How high the arc rises over the ground, as a share of the line's length (0 for flat). */
  arc?: number;
};

export type MeshLine = { from: number; to: number; km: number; points: RoutePoint[] };

/** More lines than this and a scene is a cobweb, not a map. */
export const MAX_MESH_LINES = 200;

/**
 * The lines between a set of places: every pair, or each place to its nearest neighbours. Pairs come
 * shortest first, so the cap keeps the links that read as neighbours rather than the ones that cross
 * the frame.
 */
export function connectionMesh(places: LngLat[], options: MeshOptions = {}): { lines: MeshLine[]; dropped: number } {
  const usable = places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  const pairs: { from: number; to: number; km: number }[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      pairs.push({ from: i, to: j, km: distanceMeters(usable[i], usable[j]) / 1000 });
    }
  }
  pairs.sort((a, b) => a.km - b.km);
  const maxKm = options.maxKm ?? Infinity;
  const neighbours = options.neighbours;
  const counts = new Map<number, number>();
  const wanted: typeof pairs = [];
  let dropped = 0;
  for (const pair of pairs) {
    if (pair.km > maxKm) {
      dropped++;
      continue;
    }
    if (neighbours !== undefined) {
      const enough = (counts.get(pair.from) ?? 0) >= neighbours && (counts.get(pair.to) ?? 0) >= neighbours;
      if (enough) {
        dropped++;
        continue;
      }
    }
    if (wanted.length >= MAX_MESH_LINES) {
      dropped++;
      continue;
    }
    counts.set(pair.from, (counts.get(pair.from) ?? 0) + 1);
    counts.set(pair.to, (counts.get(pair.to) ?? 0) + 1);
    wanted.push(pair);
  }
  const steps = Math.max(2, Math.round(options.steps ?? 48));
  const arc = options.arc ?? 0;
  const lines = wanted.map((pair) => ({
    from: pair.from,
    to: pair.to,
    km: pair.km,
    points: greatCircle(usable[pair.from], usable[pair.to], steps, arc > 0 ? pair.km * 1000 * arc : 0)
  }));
  return { lines, dropped };
}
