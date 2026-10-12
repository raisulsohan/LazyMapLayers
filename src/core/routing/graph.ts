// The road graph a route is searched on, built from the ways Overpass returned (DECISIONS D102).
//
// A vertex is where ways meet (they share a node) or where a way ends; an edge is the stretch of one
// way between two vertices and keeps that way's points, so the route found is drawn on the road
// itself. Arcs are the directions a mode may travel an edge; they are stored per vertex in flat arrays
// (compressed rows), because a band across a country holds hundreds of thousands of them.

import { distanceMeters } from "../geo/greatCircle.ts";
import type { LngLat } from "../geo/mercator.ts";
import { wayUse, type RoadMode, type Tags } from "./profiles.ts";

export type RoadWay = {
  /** Unique within an answer, and the same in two answers for the same way. */
  key: string;
  /** The OpenStreetMap way id. */
  id: number;
  tags: Tags;
  /** One node key per point: the node id, or the point itself when the answer carries no ids. */
  nodes: string[];
  lat: number[];
  lng: number[];
};

type OverpassWay = { type?: string; id?: number; tags?: Tags; nodes?: number[]; geometry?: ({ lat: number; lon: number } | null)[] };

const pointKey = (lat: number, lng: number) => `${lat.toFixed(7)},${lng.toFixed(7)}`;

/**
 * The ways of an Overpass answer asked for with "out geom" (each way with its node ids and its points).
 * A way whose points have gaps (a node outside a clipped answer) is kept as the pieces between them.
 */
export function roadWays(answer: unknown): RoadWay[] {
  const elements = ((answer ?? {}) as { elements?: OverpassWay[] }).elements ?? [];
  const ways: RoadWay[] = [];
  for (const element of elements) {
    if (element.type !== "way" || !Array.isArray(element.geometry) || typeof element.id !== "number") continue;
    const ids = Array.isArray(element.nodes) && element.nodes.length === element.geometry.length ? element.nodes : null;
    let piece: RoadWay | null = null;
    let pieces = 0;
    const close = () => {
      if (piece && piece.lat.length > 1) ways.push(piece);
      piece = null;
    };
    element.geometry.forEach((point, i) => {
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
        close();
        return;
      }
      if (!piece) piece = { key: pieces++ ? `${element.id}:${pieces}` : String(element.id), id: element.id!, tags: element.tags ?? {}, nodes: [], lat: [], lng: [] };
      piece.nodes.push(ids ? String(ids[i]) : pointKey(point.lat, point.lon));
      piece.lat.push(point.lat);
      piece.lng.push(point.lon);
    });
    close();
  }
  return ways;
}

/** The ways of several answers, each way once (areas overlap, and a long road comes back in each). */
export function mergeRoadWays(lists: RoadWay[][]): RoadWay[] {
  const seen = new Map<string, RoadWay>();
  for (const list of lists) for (const way of list) if (!seen.has(way.key)) seen.set(way.key, way);
  return [...seen.values()];
}

export type RoadGraph = {
  mode: RoadMode;
  /** The ways the mode may use, which the edges point into. */
  ways: RoadWay[];
  /** Vertices. */
  size: number;
  lat: Float64Array;
  lng: Float64Array;
  /** Edges: the stretch of a way from point `start` (vertex u) to point `end` (vertex v), start < end. */
  edges: number;
  edgeWay: Int32Array;
  edgeStart: Int32Array;
  edgeEnd: Int32Array;
  edgeU: Int32Array;
  edgeV: Int32Array;
  /** 1 when the mode may travel u to v (forward) and v to u (backward). */
  edgeForward: Uint8Array;
  edgeBackward: Uint8Array;
  edgeKm: Float64Array;
  /** Cost seconds and real seconds per km on the edge, and seconds added to cross it (a ferry). */
  edgeCostPerKm: Float64Array;
  edgeSecondsPerKm: Float64Array;
  edgeBoard: Float64Array;
  /** Arcs leaving vertex x are first[x] to first[x + 1] - 1. */
  first: Int32Array;
  arcTarget: Int32Array;
  arcEdge: Int32Array;
  /** 1 when the arc runs the edge from v to u. */
  arcBackward: Uint8Array;
  arcCost: Float64Array;
  /** The undirected piece of the network each vertex belongs to: two ends in different pieces never meet. */
  component: Int32Array;
  /** The most km one cost second buys anywhere in the graph: the A* estimate's speed. */
  fastest: number;
};

/** The graph a mode travels on, from the merged ways of every area. */
export function buildRoadGraph(ways: RoadWay[], mode: RoadMode): RoadGraph {
  const usable: RoadWay[] = [];
  const uses: NonNullable<ReturnType<typeof wayUse>>[] = [];
  for (const way of ways) {
    const use = wayUse(way.tags, mode);
    if (!use || (!use.forward && !use.backward)) continue;
    usable.push(way);
    uses.push(use);
  }

  // A node used twice (by two ways, or twice by one way) is where roads meet.
  const count = new Map<string, number>();
  for (const way of usable) for (const node of way.nodes) count.set(node, (count.get(node) ?? 0) + 1);
  const vertexOf = new Map<string, number>();
  const lats: number[] = [];
  const lngs: number[] = [];
  const vertex = (way: RoadWay, i: number) => {
    const node = way.nodes[i];
    let id = vertexOf.get(node);
    if (id === undefined) {
      id = lats.length;
      vertexOf.set(node, id);
      lats.push(way.lat[i]);
      lngs.push(way.lng[i]);
    }
    return id;
  };

  const eWay: number[] = [];
  const eStart: number[] = [];
  const eEnd: number[] = [];
  const eU: number[] = [];
  const eV: number[] = [];
  const eKm: number[] = [];
  usable.forEach((way, w) => {
    const last = way.lat.length - 1;
    let from = 0;
    let km = 0;
    let u = vertex(way, 0);
    for (let i = 1; i <= last; i++) {
      km += distanceMeters({ lat: way.lat[i - 1], lng: way.lng[i - 1] }, { lat: way.lat[i], lng: way.lng[i] }) / 1000;
      if (i < last && (count.get(way.nodes[i]) ?? 0) < 2) continue;
      const v = vertex(way, i);
      eWay.push(w);
      eStart.push(from);
      eEnd.push(i);
      eU.push(u);
      eV.push(v);
      eKm.push(km);
      from = i;
      km = 0;
      u = v;
    }
  });

  const size = lats.length;
  const edges = eWay.length;
  const graph: RoadGraph = {
    mode,
    ways: usable,
    size,
    lat: Float64Array.from(lats),
    lng: Float64Array.from(lngs),
    edges,
    edgeWay: Int32Array.from(eWay),
    edgeStart: Int32Array.from(eStart),
    edgeEnd: Int32Array.from(eEnd),
    edgeU: Int32Array.from(eU),
    edgeV: Int32Array.from(eV),
    edgeForward: new Uint8Array(edges),
    edgeBackward: new Uint8Array(edges),
    edgeKm: Float64Array.from(eKm),
    edgeCostPerKm: new Float64Array(edges),
    edgeSecondsPerKm: new Float64Array(edges),
    edgeBoard: new Float64Array(edges),
    first: new Int32Array(size + 1),
    arcTarget: new Int32Array(0),
    arcEdge: new Int32Array(0),
    arcBackward: new Uint8Array(0),
    arcCost: new Float64Array(0),
    component: new Int32Array(size),
    fastest: 0
  };

  // Arcs, counted per vertex first and then laid out in rows.
  let fastest = 0;
  for (let e = 0; e < edges; e++) {
    const use = uses[graph.edgeWay[e]];
    graph.edgeForward[e] = use.forward ? 1 : 0;
    graph.edgeBackward[e] = use.backward ? 1 : 0;
    graph.edgeSecondsPerKm[e] = 3600 / use.kmh;
    graph.edgeCostPerKm[e] = (3600 / use.kmh) * use.factor;
    graph.edgeBoard[e] = use.board;
    fastest = Math.max(fastest, 1 / graph.edgeCostPerKm[e]);
    if (use.forward) graph.first[graph.edgeU[e] + 1]++;
    if (use.backward) graph.first[graph.edgeV[e] + 1]++;
  }
  for (let x = 0; x < size; x++) graph.first[x + 1] += graph.first[x];
  const arcs = graph.first[size];
  graph.arcTarget = new Int32Array(arcs);
  graph.arcEdge = new Int32Array(arcs);
  graph.arcBackward = new Uint8Array(arcs);
  graph.arcCost = new Float64Array(arcs);
  const fill = graph.first.slice(0, size);
  const addArc = (from: number, to: number, e: number, backward: boolean) => {
    const at = fill[from]++;
    graph.arcTarget[at] = to;
    graph.arcEdge[at] = e;
    graph.arcBackward[at] = backward ? 1 : 0;
    graph.arcCost[at] = graph.edgeKm[e] * graph.edgeCostPerKm[e] + graph.edgeBoard[e];
  };
  for (let e = 0; e < edges; e++) {
    if (graph.edgeForward[e]) addArc(graph.edgeU[e], graph.edgeV[e], e, false);
    if (graph.edgeBackward[e]) addArc(graph.edgeV[e], graph.edgeU[e], e, true);
  }
  graph.fastest = fastest || 1;

  // Pieces of the network, ignoring direction (union-find).
  const parent = new Int32Array(size);
  for (let x = 0; x < size; x++) parent[x] = x;
  const root = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let e = 0; e < edges; e++) {
    const a = root(graph.edgeU[e]);
    const b = root(graph.edgeV[e]);
    if (a !== b) parent[a] = b;
  }
  for (let x = 0; x < size; x++) graph.component[x] = root(x);
  return graph;
}

/** A place on an edge: on segment `segment` (from point `segment` to the next) at fraction `t`. */
export type RoadSnap = {
  edge: number;
  segment: number;
  t: number;
  point: LngLat;
  /** From the place asked for to the road, km. */
  km: number;
  /** Along the edge from its vertex u to the point, km. */
  along: number;
};

/**
 * The roads nearest to a place, one place per edge, nearest first: at most `count`, none further than
 * `maxKm`. Ferries are never a place to start or end.
 */
export function snapCandidates(graph: RoadGraph, place: LngLat, maxKm: number, count: number): RoadSnap[] {
  const cos = Math.cos((place.lat * Math.PI) / 180);
  const kx = 111.32 * cos;
  const ky = 111.32;
  const reachLat = maxKm / ky;
  const reachLng = maxKm / Math.max(1e-6, kx);
  const best: { edge: number; segment: number; t: number; d2: number }[] = [];
  for (let e = 0; e < graph.edges; e++) {
    if (graph.edgeBoard[e] > 0) continue;
    const way = graph.ways[graph.edgeWay[e]];
    let found: { segment: number; t: number; d2: number } | null = null;
    for (let i = graph.edgeStart[e]; i < graph.edgeEnd[e]; i++) {
      const lat0 = way.lat[i];
      const lng0 = way.lng[i];
      const lat1 = way.lat[i + 1];
      const lng1 = way.lng[i + 1];
      if (Math.min(lat0, lat1) > place.lat + reachLat || Math.max(lat0, lat1) < place.lat - reachLat) continue;
      if (Math.min(lng0, lng1) > place.lng + reachLng || Math.max(lng0, lng1) < place.lng - reachLng) continue;
      const ax = (lng0 - place.lng) * kx;
      const ay = (lat0 - place.lat) * ky;
      const bx = (lng1 - place.lng) * kx;
      const by = (lat1 - place.lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const d2 = x * x + y * y;
      if (!found || d2 < found.d2) found = { segment: i, t, d2 };
    }
    if (found && found.d2 <= maxKm * maxKm) best.push({ edge: e, ...found });
  }
  best.sort((a, b) => a.d2 - b.d2);
  return best.slice(0, count).map((hit) => {
    const way = graph.ways[graph.edgeWay[hit.edge]];
    const i = hit.segment;
    const point = { lat: way.lat[i] + (way.lat[i + 1] - way.lat[i]) * hit.t, lng: way.lng[i] + (way.lng[i + 1] - way.lng[i]) * hit.t };
    let along = 0;
    for (let k = graph.edgeStart[hit.edge]; k < i; k++) along += distanceMeters({ lat: way.lat[k], lng: way.lng[k] }, { lat: way.lat[k + 1], lng: way.lng[k + 1] }) / 1000;
    along += (distanceMeters({ lat: way.lat[i], lng: way.lng[i] }, { lat: way.lat[i + 1], lng: way.lng[i + 1] }) / 1000) * hit.t;
    return { edge: hit.edge, segment: i, t: hit.t, point, km: Math.sqrt(hit.d2), along: Math.min(along, graph.edgeKm[hit.edge]) };
  });
}
