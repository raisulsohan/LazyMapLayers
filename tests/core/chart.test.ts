import { test } from "node:test";
import assert from "node:assert/strict";
import { chartLayout, type ChartRow } from "../../src/core/style/chart.ts";

const rows: ChartRow[] = [
  { label: "India", value: 1428, color: "#0b2f5e", labelWidth: 60, valueWidth: 50 },
  { label: "China", value: 1411, color: "#2c5f9e", labelWidth: 62, valueWidth: 50 },
  { label: "Bangladesh", value: 171, color: "#7fa6d4", labelWidth: 120, valueWidth: 40 },
  { label: "Nowhere", value: 0, color: "#e7f0fa", labelWidth: 80, valueWidth: 20 }
];

test("bars are longest first, the longest fills the length, and nothing draws for no value", () => {
  const layout = chartLayout(rows, { height: 1080, title: "People", titleWidth: 90, barLength: 300 });
  assert.deepEqual(layout.bars.map((bar) => bar.label), ["India", "China", "Bangladesh"], "a value of nothing gets no bar");
  assert.equal(layout.bars[0].bar.width, 300);
  assert.ok(Math.abs(layout.bars[2].bar.width - (171 / 1428) * 300) < 0.01);
  assert.equal(layout.bars[0].valueText, "1,428");
  // Every bar starts at the same left edge, past the widest name.
  assert.equal(new Set(layout.bars.map((bar) => bar.bar.x)).size, 1);
  assert.ok(layout.bars[0].labelAt.x + 60 <= layout.bars[0].bar.x, "a name ends before its bar starts");
  assert.ok(layout.bars[0].valueAt.x >= layout.bars[0].bar.x + layout.bars[0].bar.width, "a number sits past its bar");
  // The box holds every bar and its number.
  for (const bar of layout.bars) {
    assert.ok(bar.bar.y + bar.bar.height <= layout.height - layout.padding + 0.001, JSON.stringify(bar.bar));
    assert.ok(bar.valueAt.x + 50 <= layout.width - layout.padding + 0.001, `${bar.valueAt.x} in ${layout.width}`);
  }
});

test("the bars grow one after another, and the limit keeps the longest", () => {
  const layout = chartLayout(rows, { height: 1080, title: "", titleWidth: 0, startFrame: 25, growFrames: 10, staggerFrames: 4 });
  assert.deepEqual(layout.bars.map((bar) => [bar.from, bar.to]), [[25, 35], [29, 39], [33, 43]]);
  assert.equal(layout.title.x, layout.padding, "no title still leaves the box its padding");
  const few = chartLayout(rows, { height: 1080, title: "People", titleWidth: 90, limit: 2 });
  assert.deepEqual(few.bars.map((bar) => bar.label), ["India", "China"]);
  assert.equal(few.dropped, 1);
});

test("everything scales with the comp", () => {
  const small = chartLayout(rows, { height: 1080, title: "People", titleWidth: 90 });
  const big = chartLayout(rows, { height: 2160, title: "People", titleWidth: 180 });
  assert.ok(Math.abs(big.bars[0].bar.height - small.bars[0].bar.height * 2) < 0.01);
  assert.ok(Math.abs(big.padding - small.padding * 2) < 0.01);
  assert.equal(chartLayout([], { height: 1080, title: "People", titleWidth: 90 }).bars.length, 0);
});
