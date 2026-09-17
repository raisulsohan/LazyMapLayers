import { test } from "node:test";
import assert from "node:assert/strict";
import { composePasses, groupVisibleIn, isPassId, rendersFor } from "../../src/core/render/passes.ts";
import { DEFAULT_HIGHLIGHT, HIGHLIGHT_COLORS, normaliseHighlights, toggleHighlight } from "../../src/core/style/highlights.ts";

test("highlights toggle, take fresh colours and keep the last style", () => {
  let list = toggleHighlight([], "BGD", "Bangladesh");
  assert.deepEqual(list, [{ code: "BGD", name: "Bangladesh", color: HIGHLIGHT_COLORS[0], fill: DEFAULT_HIGHLIGHT.fill, outline: DEFAULT_HIGHLIGHT.outline }]);
  list = list.map((h) => ({ ...h, fill: 0.2, outline: 6 }));
  list = toggleHighlight(list, "IND", "India");
  assert.equal(list[1].color, HIGHLIGHT_COLORS[1], "the next free colour");
  assert.deepEqual([list[1].fill, list[1].outline], [0.2, 6], "new highlights follow the style in use");
  list = toggleHighlight(list, "BGD", "Bangladesh");
  assert.deepEqual(list.map((h) => h.code), ["IND"]);
});

test("stored highlights are repaired", () => {
  const list = normaliseHighlights([{ code: "FRA", name: "France", color: "#ABCDEF", fill: 7, outline: -2 }, { code: "FRA" }, { code: "x y" }, null, { code: "DEU", color: "red" }]);
  assert.deepEqual(list, [
    { code: "FRA", name: "France", color: "#abcdef", fill: 1, outline: 0 },
    { code: "DEU", name: "DEU", color: DEFAULT_HIGHLIGHT.color, fill: DEFAULT_HIGHLIGHT.fill, outline: DEFAULT_HIGHLIGHT.outline }
  ]);
  assert.deepEqual(normaliseHighlights("nope"), []);
});

test("the highlight pass is its own render, outside the base pass and the user's pass list", () => {
  assert.ok(!groupVisibleIn("base", "highlight", { labels: true }));
  assert.ok(groupVisibleIn("highlight", "highlight", { labels: false }) && !groupVisibleIn("highlight", "land", { labels: false }));
  assert.ok(!isPassId("highlight"), "not a pass the user switches on");
  assert.deepEqual(rendersFor(["base", "highlight"], false), ["base", "highlight"]);
  assert.deepEqual(rendersFor(["highlight"], true), ["buildings", "highlight"]);
  const highlight = new Uint8Array([255, 157, 46, 255, 0, 0, 0, 0]);
  const out = composePasses({ base: new Uint8Array(8), highlight }, ["base", "highlight"], 2);
  assert.deepEqual(Array.from(out.highlight!), Array.from(highlight));
});
