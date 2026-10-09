import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { rulerTarget, searchHistory, shapeAt, targetAt } from "../../src/core/history/historyFind.ts";
import type { HistoryFeature, HistoryYear } from "../../src/core/history/historyPack.ts";

const square = (west: number, south: number, size: number) => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south]
  ]
];

const shape = (id: string, name: string, ruler: string, west: number, size = 10): HistoryFeature => ({
  id,
  name,
  ruler,
  partOf: "",
  precision: 3,
  label: [west + size / 2, size / 2],
  bounds: [west, 0, west + size, size],
  polygons: [square(west, 0, size)]
});

const year: HistoryYear = {
  v: 1,
  year: 1914,
  label: "1914",
  features: [
    shape("hb1914-0", "Empire", "Empire", 0, 20),
    shape("hb1914-1", "Far Colony", "Empire", 30),
    shape("hb1914-2", "Empire Coast", "Empire", 50, 2),
    shape("hb1914-3", "Kingdom of Empirea", "Kingdom of Empirea", 60),
    shape("hb1914-4", "", "", 80)
  ]
};

test("the shape under a click; nothing over the sea or land nobody held", () => {
  assert.equal(shapeAt(year, { lat: 5, lng: 35 })?.name, "Far Colony");
  assert.equal(shapeAt(year, { lat: 5, lng: 25 }), null, "between the shapes");
  assert.equal(shapeAt(year, { lat: 5, lng: 85 }), null, "unclaimed land");
});

test("a click picks a shape, or with the whole power every land of it", () => {
  const one = targetAt(year, { lat: 5, lng: 35 }, false)!;
  assert.deepEqual([one.id, one.kind, one.name, one.detail], ["hb1914x1", "shape", "Far Colony", "1914 · Empire"]);
  const all = targetAt(year, { lat: 5, lng: 35 }, true)!;
  assert.equal(all.kind, "ruler");
  assert.equal(all.name, "Empire and its lands");
  assert.equal(all.detail, "1914 · 3 lands");
  assert.equal(all.polygons.length, 3);
  assert.deepEqual(all.bounds, [0, 0, 52, 20]);
  assert.deepEqual(all.label, [10, 10], "the name sits on the largest land");
  assert.match(all.id, /^hb1914r[0-9a-f]{8}$/);
  // What normaliseHighlights accepts as an area code.
  for (const id of [one.id, all.id]) assert.match(`area:${id}`, /^area:[a-z0-9]{4,24}$/i);
  assert.equal(rulerTarget(year, "Empire")!.id, all.id, "the same power gets the same id");
  assert.equal(targetAt(year, { lat: 5, lng: 65 }, false)!.detail, "1914 · independent");
  assert.equal(rulerTarget(year, "Nobody"), null);
  assert.equal(rulerTarget(year, "Kingdom of Empirea")!.name, "Kingdom of Empirea", "a power of one land is named as it is");
});

test("search: exact, then a prefix, then a word; a power with several lands as a whole", () => {
  const names = searchHistory(year, "empire", 10).map((t) => `${t.kind}:${t.name}`);
  assert.deepEqual(names, ["ruler:Empire and its lands", "shape:Empire", "shape:Empire Coast", "shape:Kingdom of Empirea"]);
  assert.deepEqual(searchHistory(year, "colony").map((t) => t.name), ["Far Colony"]);
  assert.deepEqual(searchHistory(year, "e"), [], "too short");
  assert.equal(searchHistory(year, "empire", 2).length, 2);
});

// The real pack, when tools/build-history-pack.ts has built it.
const built = path.resolve(import.meta.dirname, "..", "..", ".cache", "history", "pack", "history", "1914.json");
test("the British Raj in 1914, found by click and by name", { skip: !fs.existsSync(built) && "the pack is not built" }, () => {
  const real = JSON.parse(fs.readFileSync(built, "utf8")) as HistoryYear;
  assert.equal(targetAt(real, { lat: 21, lng: 78 }, false)?.name, "British Raj");
  const empire = targetAt(real, { lat: 21, lng: 78 }, true)!;
  assert.equal(empire.name, "United Kingdom and its lands");
  assert.ok(empire.polygons.length > 20, `the British Empire holds ${empire.polygons.length} polygons`);
  const found = searchHistory(real, "british raj");
  assert.equal(found[0]?.name, "British Raj");
  assert.ok(searchHistory(real, "united kingdom").some((t) => t.kind === "ruler"));
});
