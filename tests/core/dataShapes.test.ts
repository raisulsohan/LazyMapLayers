import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DATA_FILL, normaliseDataFill } from "../../src/core/style/dataFill.ts";
import { dataShapes, MAX_DATA_SHAPES } from "../../src/core/style/dataShapes.ts";

const fill = normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "People", values: { BGD: 171, IND: 1428, JPN: 124, CHN: 1411 }, steps: 4 })!;

test("every place with a number becomes a shape, largest first, styled by its value", () => {
  const set = dataShapes(fill);
  assert.deepEqual(set.shapes.map((shape) => shape.code), ["IND", "CHN", "BGD", "JPN"]);
  assert.equal(set.most, 1428);
  assert.equal(set.least, 124);
  assert.equal(set.dropped, 0);
  // The largest is the strongest fill and the widest stroke; the smallest the weakest and thinnest.
  assert.equal(set.shapes[0].fill, 0.85);
  assert.equal(set.shapes[0].outline, 4);
  assert.equal(set.shapes[3].fill, 0.25);
  assert.equal(set.shapes[3].outline, 1);
  // In between, the share of the span decides.
  const bangladesh = set.shapes.find((shape) => shape.code === "BGD")!;
  assert.ok(bangladesh.fill > 0.25 && bangladesh.fill < 0.4, `${bangladesh.fill}`);
  // The colours are the ones the rendered layer gives, so shapes and map agree.
  assert.notEqual(set.shapes[0].color, set.shapes[3].color);
  assert.match(set.shapes[0].color, /^#[0-9a-f]{6}$/);
});

test("one colour when asked, and the largest survive a limit", () => {
  const plain = dataShapes(fill, { colorByValue: false, color: "#ff8800" });
  assert.deepEqual(new Set(plain.shapes.map((shape) => shape.color)), new Set(["#ff8800"]));
  const few = dataShapes(fill, { limit: 2 });
  assert.deepEqual(few.shapes.map((shape) => shape.code), ["IND", "CHN"]);
  assert.equal(few.dropped, 2);
  assert.ok(MAX_DATA_SHAPES >= 10);
});

test("one place, or places that share a value, come out at full strength", () => {
  const one = dataShapes(normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "x", values: { BGD: 171 } })!);
  assert.equal(one.shapes[0].fill, 0.85);
  assert.equal(one.shapes[0].outline, 4);
  const same = dataShapes(normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "x", values: { BGD: 5, IND: 5 } })!);
  assert.deepEqual(same.shapes.map((shape) => shape.outline), [4, 4]);
});
