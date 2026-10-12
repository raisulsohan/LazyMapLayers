import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoadGraph, roadWays, snapCandidates, type RoadGraph } from "../../src/core/routing/graph.ts";
import { durationText, mainRoads, routeOnRoads, searchBetween } from "../../src/core/routing/search.ts";
import type { RoadMode } from "../../src/core/routing/profiles.ts";
import { answerOf, nodeAt, road, type FixtureWay } from "./fixtures/roads.ts";

const graphOf = (ways: FixtureWay[], mode: RoadMode = "car") => buildRoadGraph(roadWays(answerOf(ways)), mode);
const place = (n: number) => ({ lat: nodeAt(n).lat, lng: nodeAt(n).lon });
const between = (a: number, b: number, t = 0.5) => ({ lat: place(a).lat + (place(b).lat - place(a).lat) * t, lng: place(a).lng + (place(b).lng - place(a).lng) * t });

/** A seeded random number generator, so a failing grid can be looked at again. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The cheapest cost between two vertices by plain Dijkstra over every arc, to hold A* to. */
function dijkstra(graph: RoadGraph, from: number, to: number): number {
  const cost = new Float64Array(graph.size).fill(Infinity);
  const done = new Uint8Array(graph.size);
  cost[from] = 0;
  for (;;) {
    let x = -1;
    for (let v = 0; v < graph.size; v++) if (!done[v] && cost[v] < Infinity && (x < 0 || cost[v] < cost[x])) x = v;
    if (x < 0) return Infinity;
    if (x === to) return cost[x];
    done[x] = 1;
    for (let a = graph.first[x]; a < graph.first[x + 1]; a++) cost[graph.arcTarget[a]] = Math.min(cost[graph.arcTarget[a]], cost[x] + graph.arcCost[a]);
  }
}

const vertexAt = (graph: RoadGraph, n: number) => {
  for (let x = 0; x < graph.size; x++) if (graph.lat[x] === nodeAt(n).lat && graph.lng[x] === nodeAt(n).lon) return x;
  throw new Error(`no vertex at node ${n}`);
};

test("A* finds the cheapest path, the same cost as Dijkstra, on random grids with one-way streets", () => {
  const classes = ["residential", "tertiary", "primary", "service", "secondary"];
  let compared = 0;
  let unreachable = 0;
  for (const seed of [1, 2, 3, 4]) {
    const next = random(seed);
    const ways: FixtureWay[] = [];
    let id = 1;
    const tags = () => road(classes[Math.floor(next() * classes.length)], next() < 0.25 ? { oneway: next() < 0.5 ? "yes" : "-1" } : {});
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        const n = r * 100 + c;
        if (c < 8) ways.push({ id: id++, nodes: [n, n + 1], tags: tags() });
        if (r < 8 && next() < 0.85) ways.push({ id: id++, nodes: [n, n + 100], tags: tags() });
      }
    const graph = graphOf(ways);
    for (let k = 0; k < 12; k++) {
      const a = Math.floor(next() * 9) * 100 + Math.floor(next() * 9);
      const b = Math.floor(next() * 9) * 100 + Math.floor(next() * 9);
      if (a === b) continue;
      const expected = dijkstra(graph, vertexAt(graph, a), vertexAt(graph, b));
      const found = searchBetween(graph, snapCandidates(graph, place(a), 0.01, 1)[0], snapCandidates(graph, place(b), 0.01, 1)[0]);
      if (expected === Infinity) {
        assert.equal(found, null, `seed ${seed}: ${a} to ${b} cannot be reached`);
        unreachable++;
        continue;
      }
      assert.ok(found, `seed ${seed}: ${a} to ${b} was not found`);
      assert.ok(Math.abs(found.cost - expected) < 1e-6 * expected, `seed ${seed}: ${a} to ${b} cost ${found.cost}, Dijkstra ${expected}`);
      compared++;
    }
  }
  assert.ok(compared >= 30, `${compared} paths compared`);
  assert.ok(unreachable < compared);
});

// A block: 0 - 1 on top (one way, east), 100 - 101 below, joined at both sides.
const block: FixtureWay[] = [
  { id: 1, nodes: [0, 1], tags: road("residential", { oneway: "yes", name: "Top Street" }) },
  { id: 2, nodes: [1, 101], tags: road("residential", { name: "East Street" }) },
  { id: 3, nodes: [101, 100], tags: road("residential", { name: "Low Street" }) },
  { id: 4, nodes: [100, 0], tags: road("residential", { name: "West Street" }) }
];

test("a car goes round the block against a one-way street; a walker does not", () => {
  const from = between(0, 1);
  const car = routeOnRoads(graphOf(block), from, place(0));
  // Half the top street east, then down, along the bottom and up: 0.0512 + 0.1112 + 0.1024 + 0.1112 km.
  assert.ok(Math.abs(car.km - 0.376) < 0.002, String(car.km));
  assert.deepEqual(car.wayIds, [1, 2, 3, 4]);
  assert.deepEqual(car.points.map((p) => [p.lat, p.lng]), [[23, 90.0005], [23, 90.001], [23.001, 90.001], [23.001, 90], [23, 90]]);
  const walk = routeOnRoads(graphOf(block, "foot"), from, place(0));
  assert.ok(Math.abs(walk.km - 0.0512) < 0.001, String(walk.km));
  assert.deepEqual(walk.points.map((p) => [p.lat, p.lng]), [[23, 90.0005], [23, 90]]);
  // At 5 km/h, 51 m take 37 seconds.
  assert.ok(Math.abs(walk.seconds - (walk.km / 5) * 3600) < 1e-6);
  // With the street's direction, the car goes straight.
  assert.ok(routeOnRoads(graphOf(block), place(0), between(0, 1)).km < 0.06);
});

test("an end beside a road starts on the road, at the nearest point", () => {
  // 30 m south of the middle of Low Street, and next to the top street's west end.
  const route = routeOnRoads(graphOf(block, "foot"), { lat: 23.00073, lng: 90.0005 }, { lat: 23.0001, lng: 89.9999 });
  assert.deepEqual([route.points[0].lat, route.points[0].lng], [23.001, 90.0005]);
  assert.ok(Math.abs(route.snapKm[0] - 0.030) < 0.001, String(route.snapKm[0]));
  assert.ok(route.snapKm[1] < 0.02);
  assert.ok(route.points.every((p) => p.lat === 23 || p.lat === 23.001 || p.lng === 90 || p.lng === 90.001), "every point lies on the block's streets");
});

test("both ends on one road: along it either way, and not against its one-way direction", () => {
  const street: FixtureWay[] = [{ id: 1, nodes: [0, 1, 2, 3, 4, 5], tags: road("residential", { name: "Long Street" }) }];
  const there = routeOnRoads(graphOf(street), between(1, 2), between(3, 4));
  assert.deepEqual(there.points.map((p) => p.lng), [90.0015, 90.002, 90.003, 90.0035]);
  assert.ok(Math.abs(there.km - 0.2047) < 0.001);
  const back = routeOnRoads(graphOf(street), between(3, 4), between(1, 2));
  assert.deepEqual(back.points.map((p) => p.lng), [90.0035, 90.003, 90.002, 90.0015]);
  // On one segment.
  const short = routeOnRoads(graphOf(street), between(1, 2, 0.2), between(1, 2, 0.8));
  assert.deepEqual(short.points.map((p) => Math.round(p.lng * 1e5) / 1e5), [90.0012, 90.0018]);
  const oneWay: FixtureWay[] = [{ id: 1, nodes: [0, 1, 2, 3, 4, 5], tags: road("residential", { oneway: "yes" }) }];
  assert.ok(routeOnRoads(graphOf(oneWay), between(1, 2), between(3, 4)).km > 0.2);
  assert.throws(() => routeOnRoads(graphOf(oneWay), between(3, 4), between(1, 2)), /one-way street by car/);
  assert.ok(routeOnRoads(graphOf(oneWay, "foot"), between(3, 4), between(1, 2)).km > 0.2, "walkers ignore it");
});

test("the faster road wins for a car, the quieter one for a bicycle when it is close", () => {
  // Straight along a residential street from 0 to 4, or round by a primary road through row 1.
  const ways: FixtureWay[] = [
    { id: 1, nodes: [0, 1, 2, 3, 4], tags: road("residential") },
    { id: 2, nodes: [0, 100], tags: road("primary_link") },
    { id: 3, nodes: [100, 101, 102, 103, 104], tags: road("primary", { ref: "N1", name: "Highway" }) },
    { id: 4, nodes: [104, 4], tags: road("primary_link") }
  ];
  const car = routeOnRoads(graphOf(ways), place(0), place(4));
  assert.deepEqual(car.wayIds, [2, 3, 4], "65 km/h round beats 25 km/h straight");
  assert.equal(car.roads[0].ref, "N1");
  assert.equal(car.roads[0].name, "Highway");
  assert.match(mainRoads(car), /^N1 \(\d+ %\)$/);
  const bicycle = routeOnRoads(graphOf(ways, "bicycle"), place(0), place(4));
  assert.deepEqual(bicycle.wayIds, [1]);
});

test("a ferry joins two shores, with time to board", () => {
  const ways: FixtureWay[] = [
    { id: 1, nodes: [0, 1], tags: road("residential") },
    { id: 2, nodes: [1, 5], tags: { route: "ferry", name: "Ferry" } },
    { id: 3, nodes: [5, 6], tags: road("residential") }
  ];
  const route = routeOnRoads(graphOf(ways), place(0), place(6));
  assert.deepEqual(route.wayIds, [1, 2, 3]);
  assert.ok(route.seconds > 900, String(route.seconds));
});

test("an end far from any road, and ends on roads that never meet, are said in words", () => {
  const ways: FixtureWay[] = [
    { id: 1, nodes: [0, 1], tags: road("residential") },
    // 4.4 km north: too far for the start to snap onto it.
    { id: 2, nodes: [4000, 4001], tags: road("residential") }
  ];
  assert.throws(() => routeOnRoads(graphOf(ways), { lat: 24, lng: 90 }, place(1)), /no road to travel by car within 3 km of the start/);
  assert.throws(() => routeOnRoads(graphOf(ways), place(0), { lat: 24, lng: 90 }), /within 3 km of the end/);
  assert.throws(() => routeOnRoads(graphOf(ways), place(0), place(4001)), /do not join the two ends by car/);
  // A road a car may not use is no road for it.
  assert.throws(() => routeOnRoads(graphOf([{ id: 1, nodes: [0, 1, 2], tags: road("footway") }]), place(0), place(2)), /no road to travel by car/);
});

test("the time a route takes, in words", () => {
  assert.equal(durationText(20), "1 min");
  assert.equal(durationText(25 * 60), "25 min");
  assert.equal(durationText(4 * 3600 + 10 * 60), "4 h 10 min");
  assert.equal(durationText(2 * 3600), "2 h");
});
