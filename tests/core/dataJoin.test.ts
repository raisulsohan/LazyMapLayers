import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { columnValues, readDataTable, toNumber } from "../../src/core/data/dataTable.ts";
import { buildLookup, describeJoin, joinValues, normaliseKey, type JoinTarget } from "../../src/core/data/join.ts";
import { dataFillColors, normaliseDataFill } from "../../src/core/style/dataFill.ts";
import { buildScale, colorForValue, formatValue, legendSteps, rampById, rampColors } from "../../src/core/style/valueScale.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
type CodeRow = { code: string; iso2: string | null; iso3: string | null; isoN: string | null; names: string[] };
const codeRows = (JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "country-codes.json"), "utf8")) as { countries: CodeRow[] }).countries;
const labels = JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "labels.json"), "utf8")) as { countries: { country: string; names: Record<string, string> }[] };

/** The targets the panel builds: the code table plus every bundled name of the country. */
const targets: JoinTarget[] = codeRows.map((row) => {
  const names = labels.countries.filter((entry) => entry.country === row.code).flatMap((entry) => Object.values(entry.names));
  return { code: row.code, codes: [row.iso2, row.iso3, row.isoN], names: [...row.names, ...names] };
});

test("numbers are read the way tables are written", () => {
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber("1.234,5"), 1234.5);
  assert.equal(toNumber("1 234"), 1234);
  // A comma with exactly three digits after it groups thousands; anything else is a decimal comma.
  assert.equal(toNumber("1,428"), 1428);
  assert.equal(toNumber("12,345,678"), 12345678);
  assert.equal(toNumber("52,52"), 52.52);
  assert.equal(toNumber("1,4285"), 1.4285);
  assert.equal(toNumber("45%"), 45);
  assert.equal(toNumber("(12)"), -12);
  assert.equal(toNumber("1.2e3"), 1200);
  assert.ok(Number.isNaN(toNumber("n/a")));
  assert.ok(Number.isNaN(toNumber("")));
});

test("a table of places and numbers is read, and one without numbers is not a table", () => {
  const table = readDataTable(
    [
      ["Country", "Population (millions)", "Note"],
      ["Bangladesh", "171.2", "estimate"],
      ["France", "68.1", ""],
      ["Japan", "124.5", ""]
    ],
    "people.csv"
  )!;
  assert.equal(table.keyColumn, 0);
  assert.equal(table.valueColumn, 1);
  assert.deepEqual(table.columns.map((column) => column.kind), ["text", "number", "text"]);
  assert.deepEqual(columnValues(table, 0, 1), [
    { key: "Bangladesh", value: 171.2 },
    { key: "France", value: 68.1 },
    { key: "Japan", value: 124.5 }
  ]);
  assert.equal(readDataTable([["a", "b"], ["x", "y"]]), null, "nothing to colour by");
  assert.equal(readDataTable([["1", "2"], ["3", "4"]]), null, "no headings");
  assert.equal(readDataTable([["Country", "Value"]]), null, "no rows");
});

test("keys are compared without case, accents or punctuation", () => {
  assert.equal(normaliseKey("  Côte d'Ivoire "), "cote d ivoire");
  assert.equal(normaliseKey("The Gambia"), "gambia");
  assert.equal(normaliseKey("VIET NAM"), "viet nam");
  // A script without case or accents is left as it is, so local names still match.
  assert.equal(normaliseKey(" বাংলাদেশ "), "বাংলাদেশ");
  assert.equal(normaliseKey("São Tomé & Príncipe"), "sao tome principe");
});

test("a table finds its countries by name, by code and by number", () => {
  const found = buildLookup(targets);
  const rows = [
    { key: "Bangladesh", value: 1 },
    { key: "FRA", value: 2 },
    { key: "DE", value: 3 },
    { key: "United States", value: 4 },
    { key: "Côte d'Ivoire", value: 5 },
    { key: "356", value: 6 },
    { key: "Burma", value: 7 },
    { key: "Atlantis", value: 8 }
  ];
  const result = joinValues(rows, found);
  assert.deepEqual(result.matched.map((row) => row.code), ["BGD", "FRA", "DEU", "USA", "CIV", "IND", "MMR"]);
  assert.deepEqual(result.unmatched, [{ key: "Atlantis", reason: "unknown" }]);
  assert.equal(result.repeated, 0);
  // A name in another language: the bundled labels carry them.
  const french = joinValues([{ key: "Allemagne", value: 1 }, { key: "Bangladesh", value: 2 }], found);
  assert.deepEqual(french.matched.map((row) => row.code), ["DEU", "BGD"]);
  assert.match(describeJoin(result, rows.length), /^7 of 8 rows matched a country; 1 did not: Atlantis$/);
});

test("the same country twice keeps the first row, and nothing is coloured on a guess", () => {
  const found = buildLookup(targets);
  const result = joinValues([{ key: "France", value: 1 }, { key: "FRA", value: 9 }], found);
  assert.deepEqual(result.matched, [{ code: "FRA", key: "France", value: 1 }]);
  assert.equal(result.repeated, 1);
  // Every key the lookup keeps means exactly one country.
  assert.equal(new Set([...found.lookup.values()]).size <= targets.length, true);
  assert.ok(found.lookup.size > 2000, `${found.lookup.size} keys`);
});

test("values become the colours of a ramp", () => {
  const scale = buildScale([0, 10, 20, 30, 40], { ramp: "blues", steps: 5 });
  assert.equal(scale.breaks.length, 5);
  assert.equal(scale.min, 0);
  assert.equal(scale.max, 40);
  assert.equal(colorForValue(0, scale), scale.colors[0]);
  assert.equal(colorForValue(40, scale), scale.colors[4]);
  assert.equal(colorForValue(15, scale), scale.colors[1]);
  assert.equal(colorForValue(Number.NaN, scale), null);
  // Quantile puts about as many values in each step.
  const skewed = buildScale([1, 1, 2, 2, 3, 3, 100], { steps: 3, method: "quantile" });
  assert.ok(skewed.breaks[1] < 10, `second step starts at ${skewed.breaks[1]}`);
  assert.equal(buildScale([], {}).colors.length, 0);
  assert.equal(buildScale([5, 5, 5], {}).colors.length, 1, "one value is one step");
  assert.deepEqual(rampColors(rampById("blues"), 3), ["#e7f0fa", "#5b9bd5", "#0b2f5e"]);
  assert.equal(rampById("nonsense").id, "blues");
});

test("the legend says what each step means", () => {
  const steps = legendSteps(buildScale([0, 25, 50, 75, 100], { steps: 4 }));
  assert.equal(steps.length, 4);
  assert.equal(steps[0].label, "0 - 25");
  assert.equal(steps[3].to, 100);
  assert.equal(formatValue(1234567.891), "1,234,568");
  assert.equal(formatValue(12.345), "12.3");
  assert.equal(formatValue(-0.5), "-0.5");
});

test("what a map stores is repaired before it is drawn", () => {
  assert.equal(normaliseDataFill(null), null);
  assert.equal(normaliseDataFill({ values: {} }), null);
  const fill = normaliseDataFill({ column: " GDP ", values: { fra: 10, DEU: 20, "": 5, BAD: "x" }, ramp: "nonsense", steps: 99, opacity: 5, noData: "grey" })!;
  assert.equal(fill.column, "GDP");
  assert.deepEqual(fill.values, { FRA: 10, DEU: 20 });
  assert.equal(fill.ramp, "blues");
  assert.equal(fill.steps, 9);
  assert.equal(fill.opacity, 1);
  assert.equal(fill.noData, null);
  const colours = dataFillColors(fill);
  assert.deepEqual(colours.codes.sort(), ["DEU", "FRA"]);
  assert.equal(colours.colors.FRA, colours.scale.colors[0]);
  assert.equal(colours.colors.DEU, colours.scale.colors[colours.scale.colors.length - 1]);
});

test("a dark map can turn the ramp over without changing what the steps mean", () => {
  const values = { BGD: 10, IND: 50, JPN: 90 };
  const plain = dataFillColors(normaliseDataFill({ column: "x", values, steps: 3 })!);
  const flipped = dataFillColors(normaliseDataFill({ column: "x", values, steps: 3, reverse: true })!);
  assert.deepEqual(flipped.scale.breaks, plain.scale.breaks, "the steps are the same numbers");
  assert.deepEqual(flipped.scale.colors, [...plain.scale.colors].reverse());
  assert.equal(flipped.colors.BGD, plain.colors.JPN, "the smallest now takes the colour the largest had");
  // The legend says the same ranges, in the colours the map really uses.
  assert.deepEqual(flipped.legend.map((step) => step.label), plain.legend.map((step) => step.label));
  assert.equal(flipped.legend[0].color, flipped.colors.BGD);
});

test("a fill of provinces needs the country it belongs to", () => {
  const values = { usa3521: 10, usa3522: 20 };
  assert.equal(normaliseDataFill({ column: "x", level: "province", values }), null, "no country, no fill");
  const fill = normaliseDataFill({ column: "x", level: "province", country: "usa", values })!;
  assert.equal(fill.country, "USA");
  assert.deepEqual(Object.keys(fill.values), ["usa3521", "usa3522"], "province ids keep their case");
  assert.equal(normaliseDataFill({ column: "x", values: { fra: 1 } })!.level, "country");
});
