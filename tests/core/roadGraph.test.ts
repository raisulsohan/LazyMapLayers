import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoadGraph, mergeRoadWays, roadWays, snapCandidates } from "../../src/core/routing/graph.ts";
import { accessFor, maxspeedKmh, onewayFor, tierClasses, wayUse } from "../../src/core/routing/profiles.ts";
import { answerOf, road } from "./fixtures/roads.ts";

test("the ways of an answer keep their node ids and points, and break where a point is missing", () => {
  const ways = roadWays(answerOf([{ id: 7, nodes: [1, 2, 3], tags: road("primary", { ref: "N1" }) }]));
  assert.equal(ways.length, 1);
  assert.deepEqual(ways[0].nodes, ["1", "2", "3"]);
  assert.equal(ways[0].lat.length, 3);
  assert.equal(ways[0].tags.ref, "N1");
  // A gap in the points cuts the way into pieces with their own keys.
  const gappy = roadWays({ elements: [{ type: "way", id: 9, nodes: [1, 2, 3, 4, 5], geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, null, { lat: 1, lon: 4 }, { lat: 1, lon: 5 }], tags: road("residential") }] });
  assert.deepEqual(gappy.map((way) => way.key), ["9", "9:2"]);
  // Without node ids the points themselves join the ways.
  const bare = roadWays({ elements: [{ type: "way", id: 1, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }], tags: road("residential") }] });
  assert.equal(bare[0].nodes[1], "1.0000000,2.0000000");
  assert.equal(roadWays(null).length, 0);
  assert.equal(roadWays({ elements: [{ type: "node", id: 1, lat: 1, lon: 1 }] }).length, 0);
});

test("ways that came in two answers are taken once", () => {
  const a = roadWays(answerOf([{ id: 1, nodes: [1, 2], tags: road("primary") }]));
  const b = roadWays(answerOf([{ id: 1, nodes: [1, 2], tags: road("primary") }, { id: 2, nodes: [2, 3], tags: road("primary") }]));
  assert.deepEqual(mergeRoadWays([a, b]).map((way) => way.id), [1, 2]);
});

test("vertices sit where ways meet or end; the points between stay in the edges", () => {
  // A runs 1-2-3-4 along a row, B leaves it at 3 and runs 103-203.
  const graph = buildRoadGraph(roadWays(answerOf([{ id: 1, nodes: [1, 2, 3, 4], tags: road("residential") }, { id: 2, nodes: [3, 103, 203], tags: road("residential") }])), "car");
  assert.equal(graph.size, 4, "nodes 1, 3, 4 and 203");
  assert.equal(graph.edges, 3);
  const first = [...graph.edgeStart.slice(0, 2)];
  assert.deepEqual(first, [0, 2], "way A is cut at its third point");
  // Every edge is two-way: six arcs.
  assert.equal(graph.first[graph.size], 6);
  // Lengths are the ground distance: 0.002 degrees of longitude at 23 N is about 205 m.
  assert.ok(Math.abs(graph.edgeKm[0] - 0.2048) < 0.002, String(graph.edgeKm[0]));
  // The A* speed is the fastest edge's.
  assert.ok(Math.abs(graph.fastest - 25 / 3600) < 1e-12);
});

test("one-way streets, roundabouts and motorways are one way for a car, never for a walker", () => {
  const tags = [road("residential", { oneway: "yes" }), road("primary", { junction: "roundabout" }), road("motorway"), road("residential", { oneway: "-1" })];
  assert.deepEqual(tags.map((t) => onewayFor(t, "car")), [1, 1, 1, -1]);
  assert.deepEqual(tags.map((t) => onewayFor(t, "foot")), [0, 0, 0, 0]);
  assert.equal(onewayFor(road("residential", { oneway: "yes", "oneway:bicycle": "no" }), "bicycle"), 0);
  assert.equal(onewayFor(road("residential", { oneway: "yes", cycleway: "opposite_lane" }), "bicycle"), 0, "a contraflow lane");
  assert.equal(onewayFor(road("residential", { oneway: "yes", cycleway: "opposite_lane" }), "car"), 1);
  assert.equal(onewayFor(road("residential", { oneway: "reversible" }), "car"), null);
  assert.equal(onewayFor(road("motorway", { oneway: "no" }), "car"), 0);
  // The graph has one arc for a one-way edge, laid the right way round.
  const graph = buildRoadGraph(roadWays(answerOf([{ id: 1, nodes: [1, 2, 3], tags: road("residential", { oneway: "-1" }) }])), "car");
  assert.equal(graph.first[graph.size], 1);
  assert.equal(graph.arcBackward[0], 1);
  assert.equal(graph.arcTarget[0], graph.edgeU[0]);
});

test("access tags: the most specific one for the mode decides", () => {
  assert.equal(accessFor(road("service", { access: "private" }), "car"), "closed");
  assert.equal(accessFor(road("service", { access: "no", foot: "yes" }), "foot"), "open");
  assert.equal(accessFor(road("service", { access: "no", foot: "yes" }), "car"), "closed");
  assert.equal(accessFor(road("residential", { access: "yes", motor_vehicle: "no" }), "car"), "closed");
  assert.equal(accessFor(road("residential", { motor_vehicle: "no", motorcar: "yes" }), "car"), "open");
  assert.equal(accessFor(road("residential", { motor_vehicle: "destination" }), "car"), "costly");
  assert.equal(accessFor(road("residential", { access: "bus;no" }), "car"), "default", "a vehicle type says nothing about cars");
  assert.equal(wayUse(road("service", { access: "private" }), "car"), null);
  assert.equal(wayUse(road("residential", { motor_vehicle: "destination" }), "car")?.factor, 3);
  // A road whose walkers have a path of its own alongside stays open, a little dearer: the path wins where it was asked for too.
  assert.equal(accessFor(road("primary", { foot: "use_sidepath" }), "foot"), "sidepath");
  assert.ok(Math.abs((wayUse(road("primary", { foot: "use_sidepath" }), "foot")?.factor ?? 0) - 1.8) < 1e-9);
  // Classes the mode may use only when its tag opens them.
  assert.equal(wayUse(road("track"), "car"), null);
  assert.ok(wayUse(road("track", { motor_vehicle: "yes" }), "car"));
  assert.equal(wayUse(road("footway"), "bicycle"), null);
  assert.ok(wayUse(road("footway", { bicycle: "designated" }), "bicycle"));
  // Motorways and motorroads are for motor vehicles only.
  assert.equal(wayUse(road("motorway"), "foot"), null);
  assert.equal(wayUse(road("motorway"), "bicycle"), null);
  assert.equal(wayUse(road("trunk", { motorroad: "yes" }), "bicycle"), null);
  assert.ok(wayUse(road("trunk"), "foot"));
  assert.equal(wayUse(road("footway"), "car"), null);
  assert.equal(wayUse(road("steps"), "foot")?.kmh, 3);
  assert.equal(wayUse({ building: "yes" }, "foot"), null);
  // A pedestrian square drawn as an area is walked round, never ridden.
  assert.ok(wayUse(road("pedestrian", { area: "yes" }), "foot"));
  assert.equal(wayUse(road("pedestrian", { area: "yes", bicycle: "yes" }), "bicycle"), null);
});

test("speeds by class, held under a signed limit, slower off the tarmac", () => {
  assert.equal(maxspeedKmh("50"), 50);
  assert.ok(Math.abs((maxspeedKmh("30 mph") ?? 0) - 48.28) < 0.01);
  assert.equal(maxspeedKmh("none"), Infinity);
  assert.equal(maxspeedKmh("walk"), 6);
  assert.equal(maxspeedKmh("DE:urban"), null);
  assert.equal(maxspeedKmh("60;80"), 60);
  assert.equal(wayUse(road("primary"), "car")?.kmh, 65);
  assert.equal(wayUse(road("primary", { maxspeed: "40" }), "car")?.kmh, 34);
  assert.equal(wayUse(road("motorway", { maxspeed: "none" }), "car")?.kmh, 130);
  assert.equal(wayUse(road("residential", { maxspeed: "50" }), "car")?.kmh, 32.5, "a limit never makes a street faster than its kind");
  assert.ok(Math.abs((wayUse(road("primary", { surface: "dirt" }), "car")?.kmh ?? 0) - 39) < 1e-9);
  assert.equal(wayUse(road("primary"), "bicycle")?.factor, 1.3, "busy roads cost a bicycle more");
  const ferry = wayUse({ route: "ferry" }, "car");
  assert.equal(ferry?.board, 900);
  assert.equal(wayUse({ route: "ferry", motor_vehicle: "no" }, "car"), null);
});

test("the classes asked for: every road the mode may use near the ends, fewer in between", () => {
  assert.ok(tierClasses("car", "all").includes("residential"));
  assert.ok(!tierClasses("car", "all").includes("footway"));
  assert.ok(!tierClasses("car", "all").includes("ferry"), "ferries are asked for on their own");
  assert.ok(tierClasses("foot", "all").includes("steps"));
  assert.ok(!tierClasses("foot", "all").includes("motorway"));
  assert.ok(!tierClasses("bicycle", "major").includes("motorway"));
  assert.deepEqual(tierClasses("car", "trunk"), ["motorway", "motorway_link", "trunk", "trunk_link"]);
  assert.ok(!tierClasses("car", "major").includes("secondary"));
  assert.ok(tierClasses("car", "linking").includes("tertiary"));
});

test("the network falls into pieces that never meet, and roads near a place are found nearest first", () => {
  const graph = buildRoadGraph(
    roadWays(
      answerOf([
        { id: 1, nodes: [1, 2, 3], tags: road("residential") },
        { id: 2, nodes: [3, 4], tags: road("residential") },
        { id: 3, nodes: [301, 302, 303], tags: road("residential") },
        { id: 4, nodes: [501, 502], tags: { route: "ferry" } }
      ])
    ),
    "car"
  );
  const pieces = new Set(graph.component);
  assert.equal(pieces.size, 3);
  // 0.0004 degrees north of the middle of way 1: about 44 m away, on the segment between nodes 1 and 2.
  const near = snapCandidates(graph, { lat: 23.0004, lng: 90.0015 }, 3, 5);
  assert.equal(graph.ways[graph.edgeWay[near[0].edge]].id, 1);
  assert.ok(Math.abs(near[0].km - 0.0445) < 0.001, String(near[0].km));
  assert.ok(Math.abs(near[0].point.lng - 90.0015) < 1e-9 && near[0].point.lat === 23);
  assert.ok(Math.abs(near[0].along - 0.0512) < 0.001, String(near[0].along));
  assert.ok(near.every((snap, i) => i === 0 || snap.km >= near[i - 1].km));
  // Too far, and never onto a ferry.
  assert.equal(snapCandidates(graph, { lat: 23.5, lng: 90.0 }, 3, 5).length, 0);
  assert.ok(snapCandidates(graph, { lat: 23.005, lng: 90.0015 }, 3, 9).every((snap) => graph.ways[graph.edgeWay[snap.edge]].id !== 4));
});
