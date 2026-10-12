import { test } from "node:test";
import assert from "node:assert/strict";
import { importGeoJson, joinLaps } from "../../src/core/data/importLines.ts";

/** A lap as togeojson's tcx() gives it: one LineString, its times in coordinateProperties. */
const lap = (start: number, count: number, seconds: number, props: Record<string, unknown> = {}) => ({
  type: "Feature",
  properties: {
    totalTimeSeconds: count * 10,
    distanceMeters: count * 30,
    ...props,
    coordinateProperties: { times: Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 12, 6, 0, seconds + i * 10)).toISOString()) }
  },
  geometry: { type: "LineString", coordinates: Array.from({ length: count }, (_, i) => [90.4 + (start + i) * 0.001, 23.8]) }
});

test("the laps of a TCX activity become one track with one time per point", () => {
  const joined = joinLaps({ type: "FeatureCollection", features: [lap(0, 5, 0), lap(5, 4, 50), lap(9, 3, 90)] }) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][] } }[] };
  assert.equal(joined.features.length, 1);
  const [track] = joined.features;
  assert.equal(track.geometry.type, "LineString");
  assert.equal(track.geometry.coordinates.length, 12);
  assert.equal(track.properties.laps, 3);
  assert.equal(track.properties.distanceMeters, 360);
  assert.equal(track.properties.totalTimeSeconds, 120);
  assert.equal((track.properties.coordinateProperties as { times: string[] }).times.length, 12);
  // Through the importer it is one timed line, named after the file.
  const imported = importGeoJson(joined, "Morning run.tcx");
  assert.equal(imported.lines.length, 1);
  assert.equal(imported.lines[0].name, "Morning run");
  assert.equal(imported.lines[0].points.length, 12);
  assert.ok(imported.lines[0].times, "the recorded pace is offered");
  assert.equal(imported.lines[0].times![11], 110);
});

test("a lap without its times keeps the track but drops the pace; one lap stays as it came", () => {
  const untimed = lap(5, 4, 50);
  delete (untimed.properties as Record<string, unknown>).coordinateProperties;
  const joined = joinLaps({ type: "FeatureCollection", features: [lap(0, 5, 0, { name: "Loop" }), untimed] }) as { features: { properties: Record<string, unknown>; geometry: { coordinates: number[][] } }[] };
  assert.equal(joined.features[0].geometry.coordinates.length, 9);
  assert.equal(joined.features[0].properties.coordinateProperties, undefined);
  assert.equal(importGeoJson(joined, "x.tcx").lines[0].name, "Loop", "a course keeps its name");
  const single = { type: "FeatureCollection", features: [lap(0, 5, 0)] };
  assert.equal(joinLaps(single), single);
  assert.equal(joinLaps(null), null);
});

test("a lap recorded in parts joins its parts in order", () => {
  const parts = {
    type: "Feature",
    properties: { coordinateProperties: { times: [["2026-10-12T06:00:00Z", "2026-10-12T06:00:10Z"], ["2026-10-12T06:00:30Z", "2026-10-12T06:00:40Z"]] } },
    geometry: { type: "MultiLineString", coordinates: [[[0, 0], [0, 0.001]], [[0, 0.002], [0, 0.003]]] }
  };
  const joined = joinLaps({ type: "FeatureCollection", features: [parts, lap(10, 2, 60)] }) as { features: { geometry: { coordinates: number[][] }; properties: Record<string, unknown> }[] };
  assert.equal(joined.features[0].geometry.coordinates.length, 6);
  assert.equal((joined.features[0].properties.coordinateProperties as { times: string[] }).times.length, 6);
});
