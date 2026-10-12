import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeLineExpressions, shapeLines, shapePathExpressions, shapeRings, SHAPE_MARKER, SHAPE_MAX_RINGS } from "../../src/core/ae/shapeExpressions.ts";

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

test("border lines keep the longest first, share their points by length and stay open", () => {
  // A line of `km` that bows north on a smooth curve, so thinning keeps more points the more it may.
  const along = (lng: number, lat: number, km: number, n: number) => Array.from({ length: n }, (_, i) => [lng + (i * km) / 111 / (n - 1), lat + (km / 400) * Math.sin((Math.PI * 3 * i) / (n - 1))]);
  const lines = [along(0, 0, 10, 50), along(0, 5, 1000, 400), along(0, 10, 100, 200), along(0, 15, 1, 2)];
  const kept = shapeLines(lines, 300, 3);
  assert.equal(kept.lines.length, 3);
  assert.equal(kept.dropped, 1, "the shortest is left out");
  assert.ok(kept.lines.reduce((n, line) => n + line.length, 0) <= 300 + 3 * 2);
  // [lat, lng, altitude, ground]; the 1000 km line first, with most of the points.
  assert.equal(kept.lines[0][0].length, 4);
  assert.ok(Math.abs(kept.lines[0][0][0] - 5) < 1e-9);
  assert.ok(kept.lines[0].length > kept.lines[1].length && kept.lines[1].length >= kept.lines[2].length);
  assert.ok(kept.lines.every((line) => line.length >= 2));
  const expressions = shapeLineExpressions(kept.lines);
  assert.equal(expressions.length, 3);
  for (const code of expressions) {
    assert.ok(code.startsWith(SHAPE_MARKER));
    assert.ok(code.includes("createPath(out, [], [], false);"), "a border is an open path");
  }
  assert.deepEqual(shapeLines([[[1, 1]]]), { lines: [], dropped: 0 });
});
