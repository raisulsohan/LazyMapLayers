import { test } from "node:test";
import assert from "node:assert/strict";
import { dataFillColors, DEFAULT_DATA_FILL, describeDataFill, normaliseDataFill } from "../../src/core/style/dataFill.ts";

test("a stored fill is repaired, and one without a usable number is none", () => {
  assert.equal(normaliseDataFill(null), null);
  assert.equal(normaliseDataFill({ values: {} }), null);
  assert.equal(normaliseDataFill({ level: "province", values: { x: 1 } }), null, "provinces need their country");
  const fill = normaliseDataFill({ column: " People ", values: { bgd: 171, IND: "no", CHN: 1411 }, steps: 99, method: "odd", opacity: 3 })!;
  assert.equal(fill.level, "country");
  assert.deepEqual(fill.values, { BGD: 171, CHN: 1411 }, "country codes are upper-cased, non-numbers dropped");
  assert.equal(fill.steps, 9);
  assert.equal(fill.method, "equal");
  assert.equal(fill.opacity, 1);
});

test("districts are a level of their own, keyed by the long ids of downloaded units", () => {
  const fill = normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "Households", level: "district", country: "bgd", values: { gbbgd77600989823530: 9, gbbgd23463827258150: 5 } })!;
  assert.equal(fill.level, "district");
  assert.equal(fill.country, "BGD");
  assert.deepEqual(Object.keys(fill.values), ["gbbgd77600989823530", "gbbgd23463827258150"], "unit ids keep their case and length");
  assert.equal(normaliseDataFill({ level: "district", values: { gbbgd77600989823530: 9 } }), null, "districts need their country");
  assert.match(describeDataFill(fill, dataFillColors(fill)), /^2 districts coloured by Households/);
});
