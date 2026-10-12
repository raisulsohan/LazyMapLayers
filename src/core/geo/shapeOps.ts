// What a designer does to shapes once they are picked: break a multi-part outline into its parts,
// cut one area out of another, count the points that fall inside an area, draw the lines between
// a set of places, and draw the borders a set of areas shares. Everything here is plain geometry, so
// the panel can show the result before it builds a single layer.

import { areaKm2, cleanPolygons, centreOf, type Polygons } from "./combine.ts";
import { distanceMeters, greatCircle, type RoutePoint } from "./greatCircle.ts";
import { pointInPolygons } from "./pointInPolygon.ts";
import { difference, intersection } from "polyclip-ts";
import { mesh } from "topojson-client";
import { topology } from "topojson-server";

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
  /**
   * The place (its index in the list) every line starts from: flights out of a hub, offices from a
   * head office. Each other place is joined to it once and to nothing else; `neighbours` is not used.
   */
  hub?: number;
};

export type MeshLine = { from: number; to: number; km: number; points: RoutePoint[] };

/** More lines than this and a scene is a cobweb, not a map. */
export const MAX_MESH_LINES = 200;

/**
 * The lines between a set of places: every pair, each place to its nearest neighbours, or every place
 * from one hub. Pairs come shortest first, so the cap keeps the links that read as neighbours rather
 * than the ones that cross the frame. A hub's lines start at the hub, so they draw on outwards.
 */
export function connectionMesh(places: LngLat[], options: MeshOptions = {}): { lines: MeshLine[]; dropped: number } {
  const usable = places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  const hubPlace = options.hub !== undefined ? places[options.hub] : undefined;
  const hub = hubPlace ? usable.indexOf(hubPlace) : -1;
  const pairs: { from: number; to: number; km: number }[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (hub >= 0 && i !== hub && j !== hub) continue;
      const from = j === hub ? j : i;
      pairs.push({ from, to: from === i ? j : i, km: distanceMeters(usable[i], usable[j]) / 1000 });
    }
  }
  pairs.sort((a, b) => a.km - b.km);
  const maxKm = options.maxKm ?? Infinity;
  const neighbours = hub >= 0 ? undefined : options.neighbours;
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

/**
 * Lines that meet end to end joined into longer ones ([line][point][lng, lat]), turning one round
 * where needed: fewer, longer lines are fewer paths in After Effects, and each draws on as one stroke.
 * Where three or more lines meet, one walk goes on through and the others start there.
 */
export function joinLines(lines: number[][][]): number[][][] {
  const usable = lines.filter((line) => line.length >= 2);
  const key = (point: number[]) => `${point[0]},${point[1]}`;
  const ends = new Map<string, number[]>();
  usable.forEach((line, i) => {
    for (const point of [line[0], line[line.length - 1]]) {
      const list = ends.get(key(point)) ?? [];
      list.push(i);
      ends.set(key(point), list);
    }
  });
  const used = new Uint8Array(usable.length);
  /** Extends a line at its last point with unused lines that start or end there. */
  const extend = (line: number[][]) => {
    for (;;) {
      const tail = line[line.length - 1];
      const next = (ends.get(key(tail)) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const piece = usable[next];
      const forward = key(piece[0]) === key(tail);
      const points = forward ? piece : piece.slice().reverse();
      for (let i = 1; i < points.length; i++) line.push(points[i]);
    }
  };
  const out: number[][][] = [];
  for (let start = 0; start < usable.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const line = usable[start].map((point) => [point[0], point[1]]);
    extend(line);
    line.reverse();
    extend(line);
    out.push(line);
  }
  return out;
}

/**
 * The borders a set of areas shares, as lines ([line][point][lng, lat]): the border between two
 * neighbours once, the outer edge of the set and its coasts left out. The lines between a country's
 * provinces over one plain fill, or the borders inside a region of countries.
 *
 * A border is shared where the two outlines run through the same points, as neighbours from one set
 * do: the countries, provinces and districts of this build are thinned together (D24, D27, D30), so their
 * borders match point for point. Areas from different sets rarely do.
 */
export function bordersBetween(list: Polygons[]): number[][][] {
  const features = list
    .map((polygons, i) => ({ type: "Feature" as const, id: i, properties: {}, geometry: { type: "MultiPolygon" as const, coordinates: cleanPolygons(polygons) } }))
    .filter((feature) => feature.geometry.coordinates.length > 0);
  if (features.length < 2) return [];
  // A fine grid keeps the points neighbours share as one arc between them.
  const topo = topology({ areas: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection }, 1e6);
  const shared = mesh(topo, topo.objects.areas, (a, b) => a !== b);
  return joinLines(shared.coordinates.map((line) => line.map((point) => [point[0], point[1]])));
}
