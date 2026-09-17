import { test } from "node:test";
import assert from "node:assert/strict";
import { importTable, toDegrees } from "../../src/core/data/importTable.ts";

test("coordinates are read in the usual spellings", () => {
  assert.equal(toDegrees("48.85"), 48.85);
  assert.equal(toDegrees(" 48,85 "), 48.85);
  assert.equal(toDegrees("-33.9°"), -33.9);
  assert.equal(toDegrees("33.9 S"), -33.9);
  assert.equal(toDegrees("W74"), -74);
  assert.ok(Number.isNaN(toDegrees("Dhaka")));
  assert.ok(Number.isNaN(toDegrees("")));
});

test("a table with headings gives named places and the journey through them", () => {
  const result = importTable(
    [
      ["City", "Latitude", "Longitude", "Note"],
      ["Dhaka", "23.81", "90.41", "start"],
      ["Dubai", "25.20", "55.27", ""],
      ["", "", "", ""],
      ["London", "51.51", "-0.13", "end"],
      ["Nowhere", "north", "east", ""]
    ],
    "tour.csv"
  );
  assert.deepEqual(
    result.places.map((p) => p.name),
    ["Dhaka", "Dubai", "London"]
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].name, "tour (rows in order)");
  assert.equal(result.lines[0].points.length, 3);
  assert.equal(result.lines[0].closed, false);
  assert.ok(result.lines[0].lengthKm > 8000);
  assert.equal(result.lines[0].times, undefined);
});

test("headings in any order, with units, semicolon files with decimal commas", () => {
  const result = importTable(
    [
      ["Lon (deg)", "Lat (deg)", "Name"],
      ["13,40", "52,52", "Berlin"],
      ["2,35", "48,86", "Paris"]
    ],
    "staedte.csv"
  );
  assert.deepEqual(result.places, [
    { name: "Berlin", lat: 52.52, lng: 13.4 },
    { name: "Paris", lat: 48.86, lng: 2.35 }
  ]);
});

test("a table without headings is latitude, longitude and a name; unknown headings are stepped over", () => {
  const plain = importTable([
    ["35.68", "139.69", "Tokyo"],
    ["37.57", "126.98", "Seoul"]
  ]);
  assert.deepEqual(plain.places[1], { name: "Seoul", lat: 37.57, lng: 126.98 });
  const lngFirst = importTable([
    ["139.69", "35.68"],
    ["126.98", "37.57"]
  ]);
  assert.deepEqual(lngFirst.places[0], { name: "Table 1", lat: 35.68, lng: 139.69 });
  const unknown = importTable([
    ["Ort", "Nord", "Ost"],
    ["Wien", "48.21", "16.37"],
    ["Graz", "47.07", "15.44"]
  ]);
  assert.deepEqual(
    unknown.places.map((p) => p.name),
    ["Wien", "Graz"]
  );
  assert.equal(importTable([["a", "b"], ["c", "d"]]).places.length, 0);
  assert.equal(importTable([]).skipped, 0);
});

test("a flight log (one position column, a time column, no names) is a track with its recorded pace", () => {
  const rows = [["Timestamp", "UTC", "Callsign", "Position", "Altitude"]];
  for (let i = 0; i < 40; i++) rows.push([String(1760000000 + i * 60), `2025-10-09T08:${String(i).padStart(2, "0")}:00Z`, "BG201", `${(23.8 + i * 0.2).toFixed(4)},${(90.4 - i * 0.5).toFixed(4)}`, "35000"]);
  // The aircraft stands still for the last two rows.
  rows.push([String(1760000000 + 40 * 60), "", "BG201", rows[40][3], "0"]);
  const result = importTable(rows, "BG201.csv");
  assert.equal(result.places.length, 0);
  assert.equal(result.lines.length, 1);
  const line = result.lines[0];
  assert.equal(line.name, "BG201");
  assert.equal(line.points.length, 40);
  assert.equal(line.times![39], 39 * 60);
  assert.equal(line.leaves![39], 40 * 60);
});

test("very long tables are cut", () => {
  const rows = [["lat", "lng"]];
  for (let i = 0; i < 50010; i++) rows.push([String((i % 100) / 10), String(i / 1000)]);
  const result = importTable(rows, "big.csv");
  assert.equal(result.skipped, 10);
  assert.equal(result.lines[0].points.length, 50000);
});
