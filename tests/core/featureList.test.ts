import { test } from "node:test";
import assert from "node:assert/strict";
import { featureKeys, filterFeatures, matchesFilter, parseFilter, type FeatureRow } from "../../src/core/data/featureList.ts";

const rows: FeatureRow[] = [
  { id: "country:IND", name: "India", source: "country", props: { code: "IND", population: 1428627663, kind: "country" } },
  { id: "country:BGD", name: "Bangladesh", source: "country", props: { code: "BGD", population: 172954319, kind: "country" } },
  { id: "country:JPN", name: "Japan", source: "country", props: { code: "JPN", population: 124516650, kind: "country" } },
  { id: "province:BGD-3", name: "Dhaka", source: "province", country: "BGD", props: { code: "BGD-3", kind: "division" } },
  { id: "import:2", name: "Delta site", source: "import", props: { owner: "Survey", area: "12.5" } }
];

test("a filter is read from one written line", () => {
  assert.deepEqual(parseFilter("population > 200000000"), { key: "population", op: ">", value: 200000000 });
  assert.deepEqual(parseFilter("population>=1,000,000"), { key: "population", op: ">=", value: 1000000 });
  assert.deepEqual(parseFilter("kind = country"), { key: "kind", op: "=", value: "country" });
  assert.deepEqual(parseFilter("owner != Survey"), { key: "owner", op: "!=", value: "Survey" });
  assert.deepEqual(parseFilter("name has delta"), { key: "name", op: "has", value: "delta" });
  // Nothing to compare, or a word compared with more-than: not a filter.
  assert.equal(parseFilter("India"), null);
  assert.equal(parseFilter("population >"), null);
  assert.equal(parseFilter("kind > country"), null);
  assert.equal(parseFilter(""), null);
});

test("a filter keeps only the features that carry the property and pass the test", () => {
  const big = parseFilter("population > 200000000");
  assert.ok(big);
  assert.deepEqual(filterFeatures(rows, { filter: big }).rows.map((row) => row.name), ["India"]);
  // A feature without the property never passes, whatever the test.
  assert.equal(matchesFilter(rows[4], { key: "population", op: "<", value: 1 }), false);
  // A number written as text still compares as a number.
  assert.equal(matchesFilter(rows[4], { key: "area", op: ">", value: 10 }), true);
  assert.deepEqual(filterFeatures(rows, { filter: { key: "kind", op: "=", value: "COUNTRY" } }).rows.length, 3, "a value is matched whatever its capitals");
  assert.deepEqual(filterFeatures(rows, { filter: { key: "name", op: "has", value: "dha" } }).rows.map((row) => row.name), ["Dhaka"]);
});

test("the text box searches the name and every property", () => {
  assert.deepEqual(filterFeatures(rows, { text: "ban" }).rows.map((row) => row.name), ["Bangladesh"]);
  assert.deepEqual(filterFeatures(rows, { text: "survey" }).rows.map((row) => row.name), ["Delta site"]);
  // Two words must both be there, in any order and in any field.
  assert.deepEqual(filterFeatures(rows, { text: "dhaka division" }).rows.map((row) => row.name), ["Dhaka"]);
  assert.equal(filterFeatures(rows, { text: "dhaka japan" }).rows.length, 0);
  assert.equal(filterFeatures(rows, {}).total, rows.length);
});

test("sorting puts numbers in order and features without the property last", () => {
  const byPeople = filterFeatures(rows, { sort: { key: "population", descending: true } });
  assert.deepEqual(byPeople.rows.slice(0, 3).map((row) => row.name), ["India", "Bangladesh", "Japan"]);
  assert.deepEqual(byPeople.rows.slice(3).map((row) => row.props.population), [undefined, undefined]);
  assert.deepEqual(filterFeatures(rows, { sort: { key: "name" } }).rows.map((row) => row.name), ["Bangladesh", "Delta site", "Dhaka", "India", "Japan"]);
});

test("the limit counts what it leaves out, and the keys are the menu of properties", () => {
  const few = filterFeatures(rows, { limit: 2, sort: { key: "name" } });
  assert.deepEqual(few.rows.map((row) => row.name), ["Bangladesh", "Delta site"]);
  assert.equal(few.total, 5);
  assert.equal(few.hidden, 3);
  assert.deepEqual(featureKeys(rows), ["code", "kind", "population", "area", "owner"]);
});
