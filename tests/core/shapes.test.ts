import { test } from "node:test";
import assert from "node:assert/strict";
import { shapePathExpressions, shapeRings, SHAPE_MARKER, SHAPE_MAX_RINGS } from "../../src/core/ae/shapeExpressions.ts";

const square = (w: number, s: number, e: number, n: number) => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s]
];

test("rings drop the repeated closing point and the degenerate ones", () => {
  const rings = shapeRings([
    [square(0, 0, 10, 10), square(4, 4, 6, 6)],
    [[[20, 20], [21, 20], [20, 20]]],
    [[[30, 30], [31, 30], [31, 31], [30, 31]]]
  ]);
  assert.equal(rings.length, 3, "the two-point ring is dropped, the unclosed ring is kept");
  assert.equal(rings[0].length, 4);
  assert.deepEqual(rings[0][0], [0, 0, 0, 0], "points are [lat, lng, altitude, ground]");
  assert.deepEqual(rings[0][1], [0, 10, 0, 0]);
  assert.equal(rings[1].length, 4, "the hole keeps its four corners");
  assert.equal(rings[2].length, 4, "a ring that does not repeat its first point keeps every point");
});

test("the ground under each point can be sampled while the rings are built", () => {
  const rings = shapeRings([[square(0, 0, 10, 10)]], (lng, lat) => lng * 100 + lat);
  assert.deepEqual(
    rings[0].map((p) => p[3]),
    [0, 1000, 1010, 10]
  );
});

test("a shape keeps at most sixty rings", () => {
  const islands = Array.from({ length: 80 }, (_, i) => [square(i, 0, i + 0.5, 0.5)]);
  assert.equal(shapeRings(islands).length, SHAPE_MAX_RINGS);
});

test("every ring becomes a closed path expression that names itself a shape", () => {
  const expressions = shapePathExpressions(shapeRings([[square(0, 0, 10, 10), square(4, 4, 6, 6)]]));
  assert.equal(expressions.length, 2);
  for (const code of expressions) {
    assert.ok(code.startsWith(SHAPE_MARKER), code.slice(0, 40));
    assert.ok(code.includes("createPath(out, [], [], true);"), "the path is closed");
    assert.ok(!code.includes("undefined"));
  }
  // The hole's points are in its own expression, not the outer ring's.
  assert.ok(expressions[1].includes("[4,4,0,0]"));
  assert.ok(!expressions[0].includes("[4,4,0,0]"));
});
