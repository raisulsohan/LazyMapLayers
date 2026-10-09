import { test } from "node:test";
import assert from "node:assert/strict";
import { readDataTable } from "../../src/core/data/dataTable.ts";
import { importTable, toDegrees } from "../../src/core/data/importTable.ts";
import { detectSeries } from "../../src/core/data/series.ts";

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

test("a table of numbers by year is not read as coordinates, however small its values", () => {
  // Percentages from 0 to 100 read as latitudes and longitudes just as well as places do.
  const rows = [
    ["country", "2000", "2005", "2010", "2015", "2020"],
    ["Brazil", "3", "21", "40", "59", "81"],
    ["India", "1", "2", "8", "26", "43"],
    ["Nigeria", "0", "3", "11", "25", "36"]
  ];
  const result = importTable(rows, "internet.csv");
  assert.equal(result.places.length, 0);
  assert.equal(result.lines.length, 0);
  // So the panel reads it as numbers, which animate over the years.
  const table = readDataTable(rows, "internet.csv")!;
  assert.equal(detectSeries(table)?.kind, "wide");
  // Spelled the World Bank way, or with a heading row above it.
  assert.equal(importTable([["Country Name", "YR2000", "YR2005"], ["Brazil", "3", "21"], ["India", "1", "2"]]).places.length, 0);
  assert.equal(importTable([["Internet users"], ["", "2000", "2005"], ["Brazil", "3", "21"]]).places.length, 0);
});

test("headings that name a value are not coordinates, and a year among the values is a value", () => {
  const values = [
    ["Country", "Internet users (%)", "Growth rate"],
    ["Brazil", "81", "4.2"],
    ["India", "43", "9.1"]
  ];
  assert.equal(importTable(values).places.length, 0);
  assert.equal(importTable([["Land", "Anteil", "Einwohner"], ["Brasilien", "81", "21"], ["Indien", "43", "14"]]).places.length, 0);
  // A long table, a row per place per year: the year column cannot be a coordinate.
  assert.equal(importTable([["country", "year", "share"], ["Brazil", "2000", "3"], ["Brazil", "2005", "21"]]).places.length, 0);
  // A year among the values of a headerless file is a value, not a heading.
  const dated = importTable([
    ["Tokyo", "35.68", "139.69", "2020"],
    ["Seoul", "37.57", "126.98", "2021"]
  ]);
  assert.deepEqual(dated.places[0], { name: "Tokyo", lat: 35.68, lng: 139.69 });
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
