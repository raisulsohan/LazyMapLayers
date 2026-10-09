import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsArea, historyBorders, historyMix, historyPalette, historyWeights, normaliseHistory, preferredSlot, rulerColours, rulerMap, sliderYearLabel, yearsForRange } from "../../src/core/history/historyStyle.ts";
import { themeById } from "../../src/core/style/themes.ts";

const square = (west: number, south: number, size: number) => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south]
  ]
];

// A row of three, an island, and land nobody held east of the row:
//   Empire [0,10] | Colony (ruled by Empire) [10,20] | Kingdom [20,30] | unclaimed [30,40]
const shapes = [
  { name: "Empire", ruler: "Empire", polygons: [square(0, 0, 10)] },
  { name: "Colony", ruler: "Empire", polygons: [square(10, 0, 10)] },
  { name: "Kingdom", ruler: "Kingdom", polygons: [square(20, 0, 10)] },
  { name: "", ruler: "", polygons: [square(30, 0, 10)] },
  { name: "Isle", ruler: "Isle", polygons: [square(50, 0, 2)] }
];

test("a map's history setting: a year, never 0 or a fraction", () => {
  assert.deepEqual(normaliseHistory({ year: 1947 }), { year: 1947 });
  assert.deepEqual(normaliseHistory({ year: -323 }), { year: -323 });
  assert.equal(normaliseHistory({ year: 0 }), null);
  assert.equal(normaliseHistory({ year: 1947.5 }), null);
  assert.equal(normaliseHistory("1947"), null);
  assert.equal(normaliseHistory(null), null);
});

test("palettes: a look's own country colours, else colours mixed into its land", () => {
  const atlas = themeById("atlas");
  assert.deepEqual(historyPalette(atlas), atlas.countryFills);
  const midnight = historyPalette(themeById("midnight"));
  assert.equal(midnight.length, 10);
  assert.equal(new Set(midnight).size, 10);
  assert.ok(midnight.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test("a ruler asks for the same slot every time", () => {
  assert.equal(preferredSlot("United Kingdom", 7), preferredSlot("United Kingdom", 7));
  assert.ok(preferredSlot("France", 10) >= 0 && preferredSlot("France", 10) < 10);
});

test("rulers: the largest first, neighbours across shapes, unclaimed land left out", () => {
  const map = rulerMap(shapes);
  assert.deepEqual(map.order, ["Empire", "Kingdom", "Isle"]);
  assert.deepEqual([...map.neighbours.get("Empire")!], ["Kingdom"], "the colony's neighbour is the empire's");
  assert.deepEqual([...map.neighbours.get("Kingdom")!], ["Empire"], "unclaimed land is no neighbour");
  assert.deepEqual([...map.neighbours.get("Isle")!], []);
});

test("colours: neighbours never share one, even when their names ask for the same slot", () => {
  // A one-colour palette cannot keep them apart; a two-colour one must.
  const two = ["#111111", "#222222"];
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const clashing = names.filter((n) => preferredSlot(n, 2) === preferredSlot("A", 2)).slice(0, 2);
  assert.equal(clashing.length, 2);
  const [big, small] = clashing;
  const map = rulerMap([
    // The larger by an island of its own; the two share the whole edge at lng 10.
    { name: big, ruler: big, polygons: [square(0, 0, 10), square(40, 0, 3)] },
    { name: small, ruler: small, polygons: [square(10, 0, 10)] }
  ]);
  const colours = rulerColours(map, two);
  assert.equal(colours.get(big), two[preferredSlot(big, 2)], "the larger keeps its own slot");
  assert.notEqual(colours.get(small), colours.get(big));
  const one = rulerColours(map, ["#333333"]);
  assert.equal(one.get(small), "#333333");
});

test("colours: a colony takes its ruler's colour; the same rulers get the same colours again", () => {
  const map = rulerMap(shapes);
  const palette = historyPalette(themeById("midnight"));
  const first = rulerColours(map, palette);
  assert.deepEqual([...first.keys()].sort(), ["Empire", "Isle", "Kingdom"]);
  assert.notEqual(first.get("Empire"), first.get("Kingdom"));
  assert.deepEqual(rulerColours(rulerMap(shapes), palette), first);
});

test("borders: between powers, within one, and no coasts", () => {
  const borders = historyBorders(shapes);
  const xs = (lines: number[][][]) => [...new Set(lines.flat().map((p) => p[0]))].sort((a, b) => a - b);
  // Empire|Colony at lng 10 is inside one power; Colony|Kingdom at 20 and Kingdom|unclaimed at 30 are between.
  assert.deepEqual(xs(borders.within), [10]);
  assert.deepEqual(xs(borders.between), [20, 30]);
  assert.ok(borders.between.flat().every((p) => p[0] === 20 || p[0] === 30), "no coast is drawn as a border");
  assert.deepEqual(historyBorders([]), { between: [], within: [] });
});

test("bounds area orders names by size", () => {
  assert.ok(boundsArea([0, 0, 10, 10]) > boundsArea([0, 0, 2, 2]));
  assert.ok(boundsArea([0, 60, 10, 70]) < boundsArea([0, 0, 10, 10]), "narrower towards the poles");
  assert.equal(boundsArea([10, 0, 0, 10]), 0);
});

test("a slider's range: the snapshots it passes, held at the ends of the pack", () => {
  const pack = [1900, 1914, 1920, 1945, 1960];
  assert.deepEqual(yearsForRange(pack, 1914, 1945), [1914, 1920, 1945]);
  assert.deepEqual(yearsForRange(pack, 1945, 1914), [1914, 1920, 1945], "either direction");
  assert.deepEqual(yearsForRange(pack, 1915, 1944), [1914, 1920, 1945], "between snapshots: the ones around");
  assert.deepEqual(yearsForRange(pack, 1930, 1930), [1920, 1945]);
  assert.deepEqual(yearsForRange(pack, 1920, 1920), [1920]);
  assert.deepEqual(yearsForRange(pack, 1700, 1800), [1900], "before the pack: its first year");
  assert.deepEqual(yearsForRange(pack, 2000, 2020), [1960]);
  assert.deepEqual(yearsForRange([], 1, 2), []);
});

test("a slider value between two years", () => {
  const years = [1914, 1920, 1945];
  assert.deepEqual(historyMix(years, 1914), { from: 1914, to: 1914, w: 0 });
  assert.deepEqual(historyMix(years, 1917), { from: 1914, to: 1920, w: 0.5 });
  assert.deepEqual(historyMix(years, 1920), { from: 1920, to: 1920, w: 0 });
  assert.deepEqual(historyMix(years, 1932.5), { from: 1920, to: 1945, w: 0.5 });
  assert.deepEqual(historyMix(years, 1800), { from: 1914, to: 1914, w: 0 });
  assert.deepEqual(historyMix(years, 2000), { from: 1945, to: 1945, w: 0 });
  assert.deepEqual(historyMix([-500, -323], -411.5), { from: -500, to: -323, w: 0.5 });
});

test("weights: the earlier year's fills stay whole, the later one's come in, lines cross-fade", () => {
  const years = [1914, 1920, 1945];
  const at = (t: number) => Object.fromEntries([...historyWeights(years, t)].map(([y, w]) => [y, [w.fill, w.line]]));
  assert.deepEqual(at(1917), { 1914: [1, 0.5], 1920: [0.5, 0.5], 1945: [0, 0] });
  assert.deepEqual(at(1920), { 1914: [0, 0], 1920: [1, 1], 1945: [0, 0] });
  assert.deepEqual(at(1945), { 1914: [0, 0], 1920: [0, 0], 1945: [1, 1] });
});

test("the year a slider reads as", () => {
  assert.equal(sliderYearLabel(1947.6), "1947");
  assert.equal(sliderYearLabel(-322.5), "323 BC");
  assert.equal(sliderYearLabel(99.99999), "AD 100");
  assert.equal(sliderYearLabel(0.5), "0");
});
