import { test } from "node:test";
import assert from "node:assert/strict";
import { historyLabelId, historyNameRecords, isHistoryLabel, yearIntervals, yearsPerFrame } from "../../src/core/history/historyLabels.ts";
import type { HistoryFeature, HistoryYear } from "../../src/core/history/historyPack.ts";
import { placeLabels, type LabelCandidate } from "../../src/core/labels/placement.ts";
import { isCountryLabel } from "../../src/core/labels/restyle.ts";

const shape = (id: string, name: string, west: number, size: number): HistoryFeature => ({
  id,
  name,
  ruler: name,
  partOf: "",
  precision: 3,
  label: [west + size / 2, size / 2],
  bounds: [west, 0, west + size, size],
  polygons: []
});

const year: HistoryYear = {
  v: 1,
  year: 1914,
  label: "1914",
  features: [shape("hb1914-0", "Empire", 0, 45), shape("hb1914-1", "Empire", 50, 1), shape("hb1914-2", "Duchy", 60, 1), shape("hb1914-3", "", 70, 5)]
};

test("one name per state, on its largest shape, ranked and zoomed by size", () => {
  const records = historyNameRecords(year);
  assert.deepEqual(records.map((r) => r.names.en), ["Empire", "Duchy"]);
  const [empire, duchy] = records;
  assert.equal(empire.id, "country:hb1914-0");
  assert.deepEqual([empire.lng, empire.lat], [22.5, 22.5]);
  assert.ok(empire.rank < duchy.rank, "the larger goes first");
  assert.ok(empire.minZoom < duchy.minZoom, "the larger shows from farther out");
  assert.equal(empire.minZoom, 0);
  assert.ok(duchy.minZoom > 3 && duchy.minZoom < 6);
  assert.ok(isCountryLabel(empire.id), "styled and set in capitals like a country");
  assert.ok(isHistoryLabel(empire.id) && !isHistoryLabel("country:IND:India"));
  assert.equal(historyLabelId("hb1947-3"), "country:hb1947-3");
});

test("the year each frame shows: the nearest to the slider", () => {
  const pack = [1914, 1920, 1945];
  assert.deepEqual(yearsPerFrame(pack, [1914, 1916, 1917, 1918, 1930, 1940, undefined], 1914), [1914, 1914, 1920, 1920, 1920, 1945, 1914]);
  assert.deepEqual(yearsPerFrame([], [1930], 1945), [1945], "no pack: the map's year");
});

test("the frames each year shows on", () => {
  const spans = yearIntervals([1914, 1914, 1920, 1920, 1914, 1945]);
  assert.deepEqual(Object.fromEntries(spans), { 1914: [[0, 2], [4, 5]], 1920: [[2, 4]], 1945: [[5, 6]] });
  assert.deepEqual(Object.fromEntries(yearIntervals([1947, 1947])), { 1947: [[0, 2]] });
});

test("a name limited to some frames is placed only there", () => {
  const view = { center: { lat: 0, lng: 0 }, zoom: 3, bearing: 0, pitch: 0 };
  const candidate = (id: string, frames?: [number, number][]): LabelCandidate => ({ id, lat: 0, lng: 0, priority: 1, width: 40, height: 10, anchor: "center", minZoom: 0, maxZoom: 22, frames });
  const tracks = placeLabels([candidate("old", [[0, 3]]), candidate("new", [[3, 6]])], Array(6).fill(view), { viewport: { width: 400, height: 300 } });
  assert.deepEqual(Object.fromEntries(tracks.map((t) => [t.id, t.intervals])), { old: [[0, 3]], new: [[3, 6]] });
});
