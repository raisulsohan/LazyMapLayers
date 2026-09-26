import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { lineChartLayout, niceCeiling, yearTicks } from "../../src/core/style/lineChart.ts";
import { chartTimeRemapExpression, growingLineExpression, lineHeadExpression, lineLabelExpression, lineValueExpression } from "../../src/core/ae/chartExpressions.ts";

const envSource = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "tools", "expression-env.js"), "utf8");
const fake = new Function(`${envSource}\nreturn lmlRunExpression;`)() as (code: string, env: unknown) => unknown;
const run = (code: string, time: number, dataTime = 0) =>
  fake(code, { own: { Map: "MAP" }, map: { width: 100, height: 100, scale: 1, controls: { "Data Time": dataTime }, toComp: [1, 0, 0, 0, 1, 0] }, comp: { width: 100, height: 100 }, value: null, time });

test("the value axis tops out at a round number, and the years under it are round too", () => {
  assert.equal(niceCeiling(164.7), 200);
  assert.equal(niceCeiling(0.83), 1);
  assert.equal(niceCeiling(2400), 2500);
  assert.deepEqual(yearTicks([2000, 2005, 2010, 2015, 2020]), [2000, 2005, 2010, 2015, 2020]);
  assert.deepEqual(yearTicks(Array.from({ length: 64 }, (_, i) => 1960 + i)), [1960, 1980, 2000, 2023]);
});

test("the largest place at the last year comes first, and the axes span the plot", () => {
  const layout = lineChartLayout(
    [
      { label: "Nepal", color: "#000000", values: [24, null, 29], labelWidth: 60 },
      { label: "Bangladesh", color: "#000000", values: [129, 148, 165], labelWidth: 90 },
      { label: "Bhutan", color: "#000000", values: [0.6, 0.7, 0.8], labelWidth: 60 }
    ],
    { height: 1080, times: [2000, 2010, 2020], title: "Population", titleWidth: 140, limit: 2 }
  );
  assert.deepEqual(layout.lines.map((l) => l.label), ["Bangladesh", "Nepal"]);
  assert.equal(layout.dropped, 1);
  const bd = layout.lines[0];
  assert.equal(bd.points[0][0], layout.plot.x);
  assert.equal(bd.points[2][0], layout.plot.x + layout.plot.width);
  // 200 is the top of the axis, so 165 sits a little under it.
  assert.ok(Math.abs(bd.points[2][1] - (layout.plot.y + layout.plot.height * (1 - 165 / 200))) < 1e-6);
  // Nepal's missing year is filled straight between its neighbours.
  assert.equal(layout.lines[1].values[1], 26.5);
  assert.deepEqual(layout.yTicks.map((t) => t.text), ["0", "100", "200"]);
});

test("a line grows to the precomp's year and no further", () => {
  const points: [number, number][] = [[0, 100], [50, 50], [100, 0]];
  const times = [2000, 2010, 2020];
  const start = run(growingLineExpression(points, times, 4), 0) as { points: number[][] };
  assert.equal(start.points.length, 2, "a line at its first year still has two points to draw");
  const half = run(growingLineExpression(points, times, 4), 1) as { points: number[][] };
  // A quarter of the way: 2005, halfway to the second point.
  assert.deepEqual(half.points[half.points.length - 1], [25, 75]);
  const end = run(growingLineExpression(points, times, 4), 4) as { points: number[][] };
  assert.deepEqual(end.points, points);
  const area = run(growingLineExpression(points, times, 4, { baseline: 120 }), 4) as { points: number[][]; closed: boolean };
  assert.equal(area.closed, true);
  assert.deepEqual(area.points.slice(-2), [[100, 120], [0, 120]]);
  assert.deepEqual(run(lineHeadExpression(points, times, 4), 2), [50, 50]);
});

test("the number at the head is written like the legend, with the place's name", () => {
  const times = [2000, 2010, 2020];
  assert.equal(run(lineValueExpression([1000, 2000, 3000], times, 4, "Dhaka  "), 3), "Dhaka  2,500");
  assert.equal(run(lineValueExpression([1.25, 1.5, 2], times, 4), 0), "1.25");
});

test("the chart's time follows the map's Data Time slider, clamped to the years", () => {
  const code = chartTimeRemapExpression([2000, 2020], 3.96);
  assert.equal(run(code, 0, 2000), 0);
  assert.equal(run(code, 0, 2010), 1.98);
  assert.equal(run(code, 0, 2030), 3.96);
  assert.equal(run(code, 0, 1990), 0);
});

test("two lines that meet keep their labels apart, the higher-ranked one where it belongs", () => {
  const times = [2000, 2020];
  const a: [number, number][] = [[0, 50], [100, 50]];
  const b: [number, number][] = [[0, 52], [100, 52]];
  assert.deepEqual(run(lineLabelExpression([a, b], 0, times, 4, 10, 5, 18), 4), [110, 55]);
  assert.deepEqual(run(lineLabelExpression([a, b], 1, times, 4, 10, 5, 18), 4), [110, 73]);
});
