import { strict as assert } from "node:assert";
import test from "node:test";
import { categoryColours, CATEGORY_PALETTES, OTHER_COLOUR } from "../../src/core/style/categories.ts";
import { dataFillColors, normaliseDataFill, seriesMatchAt, dataFillScale } from "../../src/core/style/dataFill.ts";
import { readDataTable } from "../../src/core/data/dataTable.ts";
import { detectSeries, readSeries, valueAt, yearOf } from "../../src/core/data/series.ts";

test("categories get colours in the order of how common they are, and a legend row each", () => {
  const colours = categoryColours({ FRA: "EU", DEU: "EU", ITA: "EU", GBR: "Not in the EU", NOR: "Not in the EU", CHE: "Associated" }, "safe");
  const safe = CATEGORY_PALETTES[0].colours;
  assert.deepEqual(colours.order, ["EU", "Not in the EU", "Associated"]);
  assert.equal(colours.colors.FRA, safe[0]);
  assert.equal(colours.colors.GBR, safe[1]);
  assert.equal(colours.colors.CHE, safe[2]);
  assert.deepEqual(colours.legend.map((row) => row.label), ["EU", "Not in the EU", "Associated"]);
});

test("more categories than colours: the rest share one quiet colour and one legend row", () => {
  const places: Record<string, string> = {};
  for (let i = 0; i < 12; i++) places[`C${String(i).padStart(2, "0")}`] = `Kind ${i}`;
  const colours = categoryColours(places, "safe");
  assert.equal(colours.legend.length, 9);
  assert.equal(colours.legend[8].label, "Other (4)");
  // All as common: alphabetical, so "Kind 9" is among the last and shares the quiet colour.
  assert.equal(colours.colors.C09, OTHER_COLOUR);
});

test("a colour of the user's own for a category wins", () => {
  const colours = categoryColours({ USA: "Republican", MEX: "Morena" }, "bold", { Republican: "#cc0000" });
  assert.equal(colours.colors.USA, "#cc0000");
});

test("a table of names and parties is a table to colour by", () => {
  const table = readDataTable([["State", "Winner"], ["Texas", "Republican"], ["Ohio", "Republican"], ["California", "Democratic"], ["Oregon", "Democratic"]], "election.csv");
  assert.ok(table, "a table with only text columns was refused");
  assert.equal(table!.headings[table!.keyColumn], "State");
  assert.equal(table!.headings[table!.valueColumn], "Winner");
});

test("a fill of categories colours by category and has no amounts", () => {
  const fill = normaliseDataFill({ column: "Winner", level: "country", values: {}, categories: { usa: "Republican", mex: "Morena", can: "Liberal", CUB: "Communist" }, palette: "soft" })!;
  assert.ok(fill, "the fill was refused");
  assert.deepEqual(Object.keys(fill.values), []);
  assert.equal(fill.categories!.USA, "Republican");
  const colours = dataFillColors(fill);
  assert.equal(colours.codes.length, 4);
  assert.equal(colours.legend.length, 4);
});

test("years are found in headings and cells, however they are written", () => {
  assert.equal(yearOf("1990"), 1990);
  assert.equal(yearOf("1990.0"), 1990);
  assert.equal(yearOf("YR2015"), 2015);
  assert.equal(yearOf("[2001]"), 2001);
  assert.equal(yearOf("Population"), null);
  assert.equal(yearOf("12345"), null);
});

test("a wide table (a column per year) is read as a series", () => {
  const table = readDataTable(
    [
      ["Country Name", "Country Code", "2000", "2010", "2020"],
      ["Bangladesh", "BGD", "129.2", "147.6", "164.7"],
      ["Nepal", "NPL", "23.9", "", "29.1"]
    ],
    "population.csv"
  )!;
  const shape = detectSeries(table)!;
  assert.equal(shape.kind, "wide");
  const series = readSeries(table, shape, table.keyColumn, table.valueColumn);
  assert.deepEqual(series.times, [2000, 2010, 2020]);
  assert.deepEqual(series.rows.find((r) => r.key === "Nepal")!.values, [23.9, null, 29.1]);
});

test("a long table (a row per place per year) is read as the same series", () => {
  const table = readDataTable(
    [
      ["Entity", "Year", "Emissions"],
      ["India", "2000", "1.0"],
      ["India", "2010", "1.7"],
      ["India", "2020", "2.4"],
      ["Chile", "2010", "4.4"],
      ["Chile", "2020", "4.1"]
    ],
    "co2.csv"
  )!;
  const shape = detectSeries(table)!;
  assert.equal(shape.kind, "long");
  const series = readSeries(table, shape, 0, 2);
  assert.deepEqual(series.times, [2000, 2010, 2020]);
  assert.deepEqual(series.rows.find((r) => r.key === "Chile")!.values, [null, 4.4, 4.1]);
});

test("a value between years is straight between them, and held beyond the known years", () => {
  const times = [2000, 2010, 2020];
  assert.equal(valueAt(times, [10, 20, 40], 2005), 15);
  assert.equal(valueAt(times, [10, 20, 40], 2015), 30);
  assert.equal(valueAt(times, [null, 20, 40], 2003), 20);
  assert.equal(valueAt(times, [10, null, 40], 2010), 25);
  assert.equal(valueAt(times, [10, 20, null], 2030), 20);
  assert.equal(valueAt(times, [null, null, null], 2010), null);
});

test("a series fill uses one scale for every year, and colours any moment", () => {
  const fill = normaliseDataFill({ column: "Population", level: "country", values: {}, series: { times: [2000, 2020], values: { BGD: [100, 200], NPL: [10, 20] } }, steps: 5 })!;
  assert.ok(fill.series);
  // Before it moves, the map shows the first year.
  assert.deepEqual(fill.values, { BGD: 100, NPL: 10 });
  const scale = dataFillScale(fill);
  assert.equal(scale.min, 10);
  assert.equal(scale.max, 200);
  const first = dataFillColors(fill, 2000);
  const last = dataFillColors(fill, 2020);
  assert.notEqual(first.colors.BGD, last.colors.BGD, "Bangladesh keeps its colour as it doubles");
  const match = seriesMatchAt({ times: fill.series!.times, values: fill.series!.values, scale, noData: null, key: ["get", "adm0_a3"] }, 2020) as unknown[];
  assert.equal(match[0], "match");
  assert.equal(match[match.indexOf("BGD") + 1], last.colors.BGD);
});
