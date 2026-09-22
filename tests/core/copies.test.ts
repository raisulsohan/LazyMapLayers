import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFactors, MIN_COPY_FACTOR, type CopyPlace } from "../../src/core/style/copies.ts";

const places: CopyPlace[] = [
  { id: "a", name: "A", lat: 0, lng: 0, value: 100 },
  { id: "b", name: "B", lat: 1, lng: 1, value: 25 },
  { id: "c", name: "C", lat: 2, lng: 2, value: 1 },
  { id: "d", name: "D", lat: 3, lng: 3, value: 0 },
  { id: "e", name: "E", lat: Number.NaN, lng: 4, value: 50 }
];

test("copies are sized by area: a quarter of the value is half the size, and tiny ones keep a floor", () => {
  const set = copyFactors(places);
  assert.deepEqual(set.copies.map((copy) => copy.id), ["a", "b", "c"], "nothing gets no copy, and a place without a position none");
  assert.equal(set.top, 100);
  assert.deepEqual(set.copies.map((copy) => copy.factor), [1, 0.5, MIN_COPY_FACTOR]);
});

test("not sized, every placed row gets a full-size copy, and the largest survive a limit", () => {
  const plain = copyFactors(places, { byValue: false });
  assert.deepEqual(plain.copies.map((copy) => [copy.id, copy.factor]), [["a", 1], ["b", 1], ["c", 1], ["d", 1]]);
  assert.equal(plain.top, 0);
  const many = copyFactors(
    Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, lat: 0, lng: i, value: i + 1 })),
    { limit: 5 }
  );
  assert.equal(many.copies.length, 5);
  assert.equal(many.dropped, 25);
  assert.equal(many.copies[0].value, 30);
});
