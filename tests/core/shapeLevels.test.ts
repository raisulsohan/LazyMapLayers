import { test } from "node:test";
import assert from "node:assert/strict";
import { lodPathExpression, SHAPE_DETAIL_ZOOM, shapeLevelExpressions, shapeRings } from "../../src/core/ae/shapeExpressions.ts";
import { simplifyFeature } from "../../src/core/geo/sharedBorders.ts";

const square = (size: number, steps: number): number[][] => {
  const ring: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    // Around the square, `steps` points in all.
    const side = Math.floor(t * 4);
    const along = t * 4 - side;
    if (side === 0) ring.push([along * size, 0]);
    else if (side === 1) ring.push([size, along * size]);
    else if (side === 2) ring.push([size - along * size, size]);
    else ring.push([0, size - along * size]);
  }
  ring.push(ring[0]);
  return ring;
};

test("a levelled path carries both point sets and switches on the map's zoom", () => {
  const coarse = shapeRings([[square(1, 8)]])[0];
  const fine = shapeRings([[square(1, 32)]])[0];
  const code = lodPathExpression(coarse, fine, 5.5);
  assert.ok(code.startsWith("// LazyMapLayers shape (generated, two levels of detail)"));
  assert.ok(code.includes("var coarse = ["), "the coarse points are baked");
  assert.ok(code.includes("var fine = ["), "the fine points are baked");
  assert.ok(code.includes("if (lmlView.zoom >= 5.5) pts = fine;"), "the switch reads the map's zoom");
  assert.ok(code.includes("createPath(out, [], [], true);"), "a shape ring is closed");
  // ES3 for the Legacy engine: no let, const, arrows or template strings.
  assert.ok(!/\b(let|const)\b|=>|`/.test(code.split("\n").slice(1).join("\n")));
});

test("rings are paired by their order, and a ring without a fine twin keeps its coarse points", () => {
  const coarse = shapeRings([[square(1, 8)], [square(0.2, 6)]]);
  const fine = shapeRings([[square(1, 32)]]);
  const paths = shapeLevelExpressions(coarse, fine);
  assert.equal(paths.length, 2);
  assert.ok(paths[0].includes("two levels of detail"));
  assert.ok(!paths[1].includes("two levels of detail"), "the second ring has no fine level to switch to");
  assert.ok(paths[0].includes(String(SHAPE_DETAIL_ZOOM)));
});

test("the coarse level is a subset of the fine level, so the switch never jumps", () => {
  // A wobbly ring with many points; thinned to two budgets from the same polygon.
  const ring: number[][] = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * 2 * Math.PI;
    const r = 1 + 0.08 * Math.sin(a * 9) + 0.03 * Math.cos(a * 23);
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  ring.push(ring[0]);
  const coarse = simplifyFeature([[ring]], 60);
  const fine = simplifyFeature([[ring]], 200);
  const coarsePoints = coarse[0][0].map((p) => p.join(","));
  const finePoints = new Set(fine[0][0].map((p) => p.join(",")));
  assert.ok(coarse[0][0].length < fine[0][0].length, `${coarse[0][0].length} against ${fine[0][0].length}`);
  const shared = coarsePoints.filter((p) => finePoints.has(p)).length;
  assert.ok(shared / coarsePoints.length > 0.95, `${shared} of ${coarsePoints.length} coarse points are in the fine ring`);
});
