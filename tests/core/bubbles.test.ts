import { test } from "node:test";
import assert from "node:assert/strict";
import { bubbleSet, DEFAULT_MAX_RADIUS, type BubblePlace } from "../../src/core/style/bubbles.ts";

const places: BubblePlace[] = [
  { id: "a", name: "A", lat: 0, lng: 0, value: 100 },
  { id: "b", name: "B", lat: 1, lng: 1, value: 25 },
  { id: "c", name: "C", lat: 2, lng: 2, value: 1 },
  { id: "d", name: "D", lat: 3, lng: 3, value: 0 },
  { id: "e", name: "E", lat: 4, lng: 4, value: -5 }
];

test("the area of a bubble stands for its value", () => {
  const set = bubbleSet(places, { minRadius: 0 });
  assert.deepEqual(set.bubbles.map((bubble) => bubble.id), ["a", "b", "c"], "nothing and less than nothing draw no circle");
  assert.equal(set.top, 100);
  assert.equal(set.bubbles[0].radius, DEFAULT_MAX_RADIUS);
  // A quarter of the value is half the width.
  assert.ok(Math.abs(set.bubbles[1].radius - DEFAULT_MAX_RADIUS / 2) < 0.02, `${set.bubbles[1].radius}`);
  assert.ok(Math.abs(set.bubbles[2].radius - DEFAULT_MAX_RADIUS / 10) < 0.02, `${set.bubbles[2].radius}`);
});

test("a tiny value still shows, and the biggest ones are kept first", () => {
  const set = bubbleSet(places, { minRadius: 6 });
  assert.equal(set.bubbles[2].radius, 6);
  const many = bubbleSet(
    Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, lat: 0, lng: i, value: i + 1 })),
    { limit: 10 }
  );
  assert.equal(many.bubbles.length, 10);
  assert.equal(many.dropped, 70);
  assert.deepEqual(many.bubbles.map((bubble) => bubble.value).slice(0, 3), [80, 79, 78], "largest first");
});

test("the radii scale with the comp", () => {
  const small = bubbleSet(places, {});
  const big = bubbleSet(places, { height: 2160 });
  assert.ok(Math.abs(big.bubbles[0].radius - small.bubbles[0].radius * 2) < 0.02);
});

test("the legend shows three sizes, and says what they are worth", () => {
  const set = bubbleSet(places, { minRadius: 0 });
  assert.deepEqual(set.legend.map((step) => step.label), ["100", "25", "6.25"]);
  assert.equal(set.legend[0].radius, DEFAULT_MAX_RADIUS);
  assert.ok(Math.abs(set.legend[1].radius - DEFAULT_MAX_RADIUS / 2) < 0.02);
  assert.ok(Math.abs(set.legend[2].radius - DEFAULT_MAX_RADIUS / 4) < 0.02);
  assert.deepEqual(bubbleSet([], {}).legend, []);
});
