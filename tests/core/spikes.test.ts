import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_HEIGHT, DEFAULT_SPIKE_WIDTH, spikeSet, type SpikePlace } from "../../src/core/style/spikes.ts";

const places: SpikePlace[] = [
  { id: "a", name: "A", lat: 0, lng: 0, value: 100 },
  { id: "b", name: "B", lat: 1, lng: 1, value: 50 },
  { id: "c", name: "C", lat: 2, lng: 2, value: 1 },
  { id: "d", name: "D", lat: 3, lng: 3, value: 0 },
  { id: "e", name: "E", lat: 4, lng: 4, value: -5 }
];

test("the height of a spike stands for its value, read straight", () => {
  const set = spikeSet(places, { minHeight: 0 });
  assert.deepEqual(set.spikes.map((spike) => spike.id), ["a", "b", "c"], "nothing and less than nothing draw no spike");
  assert.equal(set.top, 100);
  assert.equal(set.spikes[0].height, DEFAULT_MAX_HEIGHT);
  // Half the value is half the height, not the square root of it.
  assert.ok(Math.abs(set.spikes[1].height - DEFAULT_MAX_HEIGHT / 2) < 0.02, `${set.spikes[1].height}`);
  assert.ok(Math.abs(set.spikes[2].height - DEFAULT_MAX_HEIGHT / 100) < 0.02, `${set.spikes[2].height}`);
  assert.equal(set.width, DEFAULT_SPIKE_WIDTH);
});

test("a tiny value still shows, and the biggest ones are kept first", () => {
  const set = spikeSet(places, { minHeight: 4 });
  assert.equal(set.spikes[2].height, 4);
  const many = spikeSet(
    Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, lat: 0, lng: i, value: i + 1 })),
    { limit: 10 }
  );
  assert.equal(many.spikes.length, 10);
  assert.equal(many.dropped, 70);
  assert.deepEqual(many.spikes.map((spike) => spike.value).slice(0, 3), [80, 79, 78], "largest first");
});

test("the heights and the base scale with the comp", () => {
  const small = spikeSet(places, {});
  const big = spikeSet(places, { height: 2160 });
  assert.ok(Math.abs(big.spikes[0].height - small.spikes[0].height * 2) < 0.02);
  assert.ok(Math.abs(big.width - small.width * 2) < 0.02);
});

test("the legend shows three heights, and says what they are worth", () => {
  const set = spikeSet(places, { minHeight: 0, maxHeight: 200 });
  assert.deepEqual(set.legend.map((step) => step.label), ["100", "50", "25"]);
  assert.deepEqual(set.legend.map((step) => step.height), [200, 100, 50]);
  assert.deepEqual(spikeSet([], {}).legend, []);
});
