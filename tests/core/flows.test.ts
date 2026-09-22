import { test } from "node:test";
import assert from "node:assert/strict";
import { readDataTable } from "../../src/core/data/dataTable.ts";
import { flowPlaceNames, flowRows, flowWidths, guessFlowColumns } from "../../src/core/data/flows.ts";

const table = readDataTable(
  [
    ["Origin", "Destination", "Passengers", "Note"],
    ["Dhaka", "Chittagong", "1,200", "daily"],
    ["Dhaka", "Sylhet", "300", ""],
    ["Chittagong", "Cox's Bazar", "0", "none"],
    ["", "Khulna", "50", "no origin"],
    ["Dhaka", "Rajshahi", "n/a", "unknown"]
  ],
  "flights.csv"
)!;

test("the from, to and value columns are found by their names", () => {
  assert.deepEqual(guessFlowColumns(table), { from: 0, to: 1, value: 2 });
  // Without helpful names the first two text columns and the first number column are taken.
  const plain = readDataTable([["a", "b", "c"], ["x", "y", "1"]], "t.csv")!;
  assert.deepEqual(guessFlowColumns(plain), { from: 0, to: 1, value: 2 });
  // One text column is not a flow.
  const single = readDataTable([["Country", "People"], ["France", "68"]], "p.csv")!;
  assert.equal(guessFlowColumns(single), null);
});

test("rows without a place or a positive value are left out", () => {
  const rows = flowRows(table, 0, 1, 2);
  assert.deepEqual(rows, [
    { from: "Dhaka", to: "Chittagong", value: 1200, row: 0 },
    { from: "Dhaka", to: "Sylhet", value: 300, row: 1 }
  ]);
  assert.deepEqual(flowPlaceNames(rows), ["Dhaka", "Chittagong", "Sylhet"]);
});

test("widths follow the values, the largest gets the widest line, nothing thinner than the floor", () => {
  const widths = flowWidths([1200, 300, 3], { minWidth: 2, maxWidth: 12 });
  assert.equal(widths.widthFor(1200), 12);
  assert.equal(widths.widthFor(300), 3);
  assert.equal(widths.widthFor(3), 2, "a tiny flow still shows");
  assert.equal(widths.widthFor(0), 2);
  assert.deepEqual(widths.legend.map((step) => step.label), ["1,200", "600", "300"]);
  assert.deepEqual(widths.legend.map((step) => step.width), [12, 6, 3]);
  assert.deepEqual(flowWidths([]).legend, []);
});
