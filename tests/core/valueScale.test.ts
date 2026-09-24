import { test } from "node:test";
import assert from "node:assert/strict";
import { formatShort } from "../../src/core/style/valueScale.ts";

test("a short number fits a label", () => {
  assert.equal(formatShort(940), "940");
  assert.equal(formatShort(8_906), "8.9K");
  assert.equal(formatShort(14_787_000), "14.8M");
  assert.equal(formatShort(2_000_000), "2M", "a whole number keeps no decimal");
  assert.equal(formatShort(1_428_000_000), "1.4B");
  assert.equal(formatShort(123_400_000), "123M", "three digits need no decimal");
  assert.equal(formatShort(-8_906), "-8.9K");
  assert.equal(formatShort(Number.NaN), "");
});
