import { strict as assert } from "node:assert";
import test from "node:test";
import { applyFeatureEdits, editFeature, filterFeatures, parseFilter, typedValue, type FeatureRow } from "../../src/core/data/featureList.ts";

const rows: FeatureRow[] = [
  { id: "import:0", name: "Plot 1", source: "import", props: { owner: "City", km2: 2.5 } },
  { id: "import:1", name: "Plot 2", source: "import", props: { owner: "Private", km2: 1.1 } }
];

test("typed values are numbers when they read as one", () => {
  assert.equal(typedValue(" 42 "), 42);
  assert.equal(typedValue("3.5e2"), 350);
  assert.equal(typedValue("12 km"), "12 km");
  assert.equal(typedValue("N/A"), "N/A");
});

test("an edit changes one property of one feature, and the data underneath stays as it was", () => {
  let edits = editFeature({}, "import:1", "owner", "City");
  edits = editFeature(edits, "import:1", "status", "sold");
  edits = editFeature(edits, "import:0", "km2", null);
  edits = editFeature(edits, "import:0", "name", "Riverside");
  const edited = applyFeatureEdits(rows, edits);
  assert.deepEqual(edited[1].props, { owner: "City", km2: 1.1, status: "sold" });
  assert.deepEqual(edited[0].props, { owner: "City" });
  assert.equal(edited[0].name, "Riverside");
  assert.deepEqual(rows[1].props, { owner: "Private", km2: 1.1 }, "the rows themselves are not changed");
  assert.equal(editFeature(edits, "import:0", "  ", "x"), edits, "a property needs a name");
});

test("filters and sorting see the edited values", () => {
  const edited = applyFeatureEdits(rows, editFeature({}, "import:1", "owner", "City"));
  const found = filterFeatures(edited, { filter: parseFilter("owner = City") });
  assert.equal(found.rows.length, 2);
});
