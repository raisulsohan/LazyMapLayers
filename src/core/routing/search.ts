// The way from one place to another over the road graph (DECISIONS D102).
//
// Both ends snap onto the nearest road the mode may use; A* then searches from the start's place on its
// road to the end's place on its road. The cost is the time with the mode's preferences, and the
// estimate is the straight distance at the fastest speed anywhere in the graph, which never promises
// more than a road can give: the path found is the cheapest there is.

import { distanceMeters } from "../geo/greatCircle.ts";
import type { LngLat } from "../geo/mercator.ts";
import { snapCandidates, type RoadGraph, type RoadSnap } from "./graph.ts";
import { roadModeInfo, type RoadMode } from "./profiles.ts";

export type RoadUse = { ref: string; name: string; km: number };

export type RoadRoute = {
  mode: RoadMode;
  /** The route's own points, from where the start meets its road to where the end does. */
  points: LngLat[];
  km: number;
  /** Travel time without the mode's preferences, ferries' boarding included. */
  seconds: number;
  /** The roads it runs on, longest share first (unnamed stretches are only in the total). */
  roads: RoadUse[];
  /** How far each end was from its road, km. */
  snapKm: [number, number];
  /** The OpenStreetMap ways it runs on, in order. */
  wayIds: number[];
};

/** How far from a road an end may be, in km. */
export const MAX_SNAP_KM = 3;
const CANDIDATES = 12;
const TRIES = 8;

/** A tiny binary heap of vertex ids by priority; an entry that went stale is skipped when it comes out. */
function makeHeap() {
  let ids = new Int32Array(1024);
  let keys = new Float64Array(1024);
  let length = 0;
  return {
    get size() {
      return length;
    },
    push(id: number, key: number) {
      if (length === ids.length) {
        const moreIds = new Int32Array(length * 2);
        const moreKeys = new Float64Array(length * 2);
        moreIds.set(ids);
        moreKeys.set(keys);
        ids = moreIds;
        keys = moreKeys;
      }
      let i = length++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (keys[parent] <= key) break;
        ids[i] = ids[parent];
        keys[i] = keys[parent];
        i = parent;
      }
      ids[i] = id;
      keys[i] = key;
    },
    pop(): number {
      const top = ids[0];
      const lastId = ids[--length];
      const lastKey = keys[length];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= length) break;
        if (child + 1 < length && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        ids[i] = ids[child];
        keys[i] = keys[child];
        i = child;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
      return top;
    }
  };
}

/** One step of a path: a graph arc, or the piece of an edge between a snapped end and a vertex (or both ends). */
type Step = { kind: "arc"; arc: number } | { kind: "leave"; backward: boolean } | { kind: "arrive"; backward: boolean } | { kind: "direct"; backward: boolean };

/**
 * A* from a place on one edge to a place on another (or the same) edge. Returns the steps and their
 * cost, or null when the end cannot be reached that way round.
 */
export function searchBetween(graph: RoadGraph, start: RoadSnap, end: RoadSnap): { steps: Step[]; cost: number } | null {
  const S = graph.size;
  const T = graph.size + 1;
  const g = new Float64Array(graph.size + 2).fill(Infinity);
  const done = new Uint8Array(graph.size + 2);
  const previous = new Int32Array(graph.size + 2).fill(-1);
  const via: Step[] = new Array(graph.size + 2);
  const estimate = new Float64Array(graph.size + 2).fill(-1);
  const goal = end.point;
  const h = (x: number) => {
    if (x === T) return 0;
    if (estimate[x] < 0) estimate[x] = distanceMeters(x === S ? start.point : { lat: graph.lat[x], lng: graph.lng[x] }, goal) / 1000 / graph.fastest;
    return estimate[x];
  };

  const se = start.edge;
  const ee = end.edge;
  const startCost = graph.edgeCostPerKm[se];
  const endCost = graph.edgeCostPerKm[ee];
  // An end that sits on a vertex is at that vertex, whichever way its edge runs.
  const atU = (snap: RoadSnap) => snap.along <= 1e-9;
  const atV = (snap: RoadSnap) => snap.along >= graph.edgeKm[snap.edge] - 1e-9;
  // Where the path may reach the end from: its edge's u going forward, its v going backward.
  const arriveU = graph.edgeForward[ee] || atU(end) ? end.along * endCost : Infinity;
  const arriveV = graph.edgeBackward[ee] || atV(end) ? (graph.edgeKm[ee] - end.along) * endCost : Infinity;

  const heap = makeHeap();
  const relax = (x: number, y: number, cost: number, step: Step) => {
    const next = g[x] + cost;
    if (next >= g[y]) return;
    g[y] = next;
    previous[y] = x;
    via[y] = step;
    heap.push(y, next + h(y));
  };
  g[S] = 0;
  heap.push(S, h(S));
  while (heap.size) {
    const x = heap.pop();
    if (done[x]) continue;
    done[x] = 1;
    if (x === T) break;
    if (x === S) {
      if (graph.edgeBackward[se] || atU(start)) relax(S, graph.edgeU[se], start.along * startCost, { kind: "leave", backward: true });
      if (graph.edgeForward[se] || atV(start)) relax(S, graph.edgeV[se], (graph.edgeKm[se] - start.along) * startCost, { kind: "leave", backward: false });
      if (se === ee) {
        if (end.along >= start.along && graph.edgeForward[se]) relax(S, T, (end.along - start.along) * startCost, { kind: "direct", backward: false });
        if (end.along <= start.along && graph.edgeBackward[se]) relax(S, T, (start.along - end.along) * startCost, { kind: "direct", backward: true });
      }
      continue;
    }
    for (let a = graph.first[x]; a < graph.first[x + 1]; a++) relax(x, graph.arcTarget[a], graph.arcCost[a], { kind: "arc", arc: a });
    if (x === graph.edgeU[ee] && arriveU < Infinity) relax(x, T, arriveU, { kind: "arrive", backward: false });
    if (x === graph.edgeV[ee] && arriveV < Infinity) relax(x, T, arriveV, { kind: "arrive", backward: true });
  }
  if (!done[T]) return null;
  const steps: Step[] = [];
  for (let x = T; x !== S; x = previous[x]) steps.push(via[x]);
  return { steps: steps.reverse(), cost: g[T] };
}

/** The points, length and roads of a path found by searchBetween. */
function assemble(graph: RoadGraph, start: RoadSnap, end: RoadSnap, steps: Step[]): RoadRoute {
  const points: LngLat[] = [start.point];
  const wayIds: number[] = [];
  const uses = new Map<string, RoadUse>();
  let km = 0;
  let seconds = 0;
  const point = (way: number, i: number): LngLat => ({ lat: graph.ways[way].lat[i], lng: graph.ways[way].lng[i] });
  const push = (p: LngLat) => {
    const last = points[points.length - 1];
    if (last.lat !== p.lat || last.lng !== p.lng) points.push(p);
  };
  const count = (edge: number, length: number, crossed: boolean) => {
    const way = graph.ways[graph.edgeWay[edge]];
    // An end that sits on a vertex adds a piece of no length: it is not a road the route runs on.
    if (length <= 1e-9) return;
    km += length;
    seconds += length * graph.edgeSecondsPerKm[edge] + (crossed ? graph.edgeBoard[edge] : 0);
    if (wayIds[wayIds.length - 1] !== way.id) wayIds.push(way.id);
    const ref = way.tags.ref ?? "";
    const name = way.tags.name ?? way.tags["name:en"] ?? "";
    if (!ref && !name) return;
    const key = ref || name;
    const use = uses.get(key) ?? { ref, name, km: 0 };
    if (!use.name && name) use.name = name;
    use.km += length;
    uses.set(key, use);
  };
  for (const step of steps) {
    if (step.kind === "arc") {
      const e = graph.arcEdge[step.arc];
      const w = graph.edgeWay[e];
      if (graph.arcBackward[step.arc]) for (let i = graph.edgeEnd[e] - 1; i >= graph.edgeStart[e]; i--) push(point(w, i));
      else for (let i = graph.edgeStart[e] + 1; i <= graph.edgeEnd[e]; i++) push(point(w, i));
      count(e, graph.edgeKm[e], true);
    } else if (step.kind === "leave") {
      const e = start.edge;
      const w = graph.edgeWay[e];
      if (step.backward) for (let i = start.segment; i >= graph.edgeStart[e]; i--) push(point(w, i));
      else for (let i = start.segment + 1; i <= graph.edgeEnd[e]; i++) push(point(w, i));
      count(e, step.backward ? start.along : graph.edgeKm[e] - start.along, false);
    } else if (step.kind === "arrive") {
      const e = end.edge;
      const w = graph.edgeWay[e];
      if (step.backward) for (let i = graph.edgeEnd[e] - 1; i > end.segment; i--) push(point(w, i));
      else for (let i = graph.edgeStart[e] + 1; i <= end.segment; i++) push(point(w, i));
      push(end.point);
      count(e, step.backward ? graph.edgeKm[e] - end.along : end.along, false);
    } else {
      const e = start.edge;
      const w = graph.edgeWay[e];
      if (step.backward) for (let i = start.segment; i > end.segment; i--) push(point(w, i));
      else for (let i = start.segment + 1; i <= end.segment; i++) push(point(w, i));
      push(end.point);
      count(e, Math.abs(end.along - start.along), false);
    }
  }
  if (points.length === 1) points.push(end.point);
  const roads = [...uses.values()].sort((a, b) => b.km - a.km);
  return { mode: graph.mode, points, km, seconds, roads, snapKm: [start.km, end.km], wayIds };
}

/**
 * The route from one place to another on the graph's roads. Throws, in words the panel shows, when an
 * end has no road near it or the two ends are not connected by the roads at hand.
 */
export function routeOnRoads(graph: RoadGraph, from: LngLat, to: LngLat, maxSnapKm = MAX_SNAP_KM): RoadRoute {
  const words = roadModeInfo(graph.mode).words;
  const starts = snapCandidates(graph, from, maxSnapKm, CANDIDATES);
  if (!starts.length) throw new Error(`no road to travel ${words} within ${maxSnapKm} km of the start`);
  const ends = snapCandidates(graph, to, maxSnapKm, CANDIDATES);
  if (!ends.length) throw new Error(`no road to travel ${words} within ${maxSnapKm} km of the end`);
  // Pairs on connected roads, the nearest first: a stray piece of road beside the start is passed over.
  const pairs: [RoadSnap, RoadSnap][] = [];
  for (const s of starts) for (const e of ends) if (graph.component[graph.edgeU[s.edge]] === graph.component[graph.edgeU[e.edge]]) pairs.push([s, e]);
  pairs.sort((a, b) => a[0].km + a[1].km - (b[0].km + b[1].km));
  for (const [s, e] of pairs.slice(0, TRIES)) {
    const found = searchBetween(graph, s, e);
    if (found) return assemble(graph, s, e, found.steps);
  }
  throw new Error(pairs.length ? `the roads near the two ends only meet against a one-way street ${words}` : `the roads at hand do not join the two ends ${words}`);
}

/** "4 h 10 min", "25 min", for the time a route takes. */
export function durationText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** The roads a route mostly runs on, for the log: "N1 (64 %), N102 (12 %)". */
export function mainRoads(route: RoadRoute, count = 3): string {
  const total = route.km || 1;
  return route.roads
    .filter((use) => use.km / total >= 0.05)
    .slice(0, count)
    .map((use) => `${use.ref || use.name} (${Math.round((use.km / total) * 100)} %)`)
    .join(", ");
}
