import { test } from "node:test";
import assert from "node:assert/strict";
import { followsTheLook, normaliseLayerStyle, NO_OVERRIDE, resolveLayerStyle } from "../../src/core/style/layerStyle.ts";
import { themeById, THEMES } from "../../src/core/style/themes.ts";

test("every look has an accent that generated layers can use", () => {
  for (const theme of THEMES) assert.match(theme.accent, /^#[0-9a-f]{6}$/, theme.id);
});

test("without an override the layers follow the look", () => {
  const midnight = resolveLayerStyle(themeById("midnight"));
  assert.equal(midnight.accent, themeById("midnight").accent);
  assert.equal(midnight.glow, true, "dark maps glow");
  assert.equal(midnight.stroke, 4);
  const paper = resolveLayerStyle(themeById("paper"));
  assert.equal(paper.accent, themeById("paper").accent);
  assert.equal(paper.glow, false, "light maps do not glow");
  assert.equal(paper.panel, "#ffffff");
  assert.notEqual(midnight.panel, paper.panel);
  assert.ok(followsTheLook(NO_OVERRIDE));
});

test("an override wins, field by field", () => {
  const style = resolveLayerStyle(themeById("midnight"), { accent: "#00ff88", stroke: null, glow: false });
  assert.equal(style.accent, "#00ff88");
  assert.equal(style.stroke, 4, "what is not overridden still follows the look");
  assert.equal(style.glow, false);
  assert.equal(followsTheLook({ accent: "#00ff88", stroke: null, glow: null }), false);
});

test("stored styles are cleaned up before they are used", () => {
  assert.deepEqual(normaliseLayerStyle(null), NO_OVERRIDE);
  assert.deepEqual(normaliseLayerStyle({ accent: "#ABCDEF", stroke: 2.55, glow: true }), { accent: "#abcdef", stroke: 2.6, glow: true });
  assert.deepEqual(normaliseLayerStyle({ accent: "red", stroke: "3", glow: 1 }), NO_OVERRIDE);
  assert.deepEqual(normaliseLayerStyle({ accent: "#fff", stroke: -5, glow: null }), { accent: null, stroke: 0, glow: null });
  assert.equal(normaliseLayerStyle({ stroke: 9999 }).stroke, 40);
});
