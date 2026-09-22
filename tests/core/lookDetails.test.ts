import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLookDetails, DEFAULT_DETAILS, describeDetails, normaliseDetails, plainDetails } from "../../src/core/style/lookDetails.ts";

const style = {
  layers: [
    { id: "border", type: "line", metadata: { "lml:group": "boundaries" }, paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 8, 2.4] } },
    { id: "river", type: "line", metadata: { "lml:group": "water" }, paint: { "line-color": "#123456" } },
    { id: "lake", type: "fill", metadata: { "lml:group": "water" }, paint: { "fill-color": "#123456" } },
    { id: "road", type: "line", metadata: { "lml:group": "roads" }, paint: { "line-width": 3, "line-gap-width": 1 } },
    { id: "names", type: "symbol", metadata: { "lml:group": "labels" }, minzoom: 3, layout: { "text-field": ["get", "name"] } },
    { id: "pin", type: "circle", metadata: { "lml:group": "overlay" }, paint: { "circle-radius": 4 } }
  ]
};

test("stored details are repaired, and plain ones leave the style alone", () => {
  assert.deepEqual(normaliseDetails(null), DEFAULT_DETAILS);
  assert.deepEqual(normaliseDetails({ lines: 99, roads: "x", labels: "lots" }), { lines: 3, roads: 1, labels: "normal" });
  assert.deepEqual(normaliseDetails({ lines: 0.1, roads: 1.333, labels: "more" }), { lines: 0.25, roads: 1.33, labels: "more" });
  assert.ok(plainDetails(DEFAULT_DETAILS));
  assert.equal(applyLookDetails(style, DEFAULT_DETAILS), style, "nothing to do returns the style itself");
  assert.equal(describeDetails(DEFAULT_DETAILS), "");
  assert.equal(describeDetails({ lines: 2, roads: 0.5, labels: "fewer" }), "lines 2x, roads 0.5x, fewer names");
});

test("lines and roads are scaled in their own groups, whatever form the width has", () => {
  const heavy = applyLookDetails(style, { lines: 2, roads: 0.5, labels: "normal" });
  const of = (id: string) => heavy.layers.find((layer) => (layer as { id: string }).id === id) as { paint?: Record<string, unknown>; layout?: Record<string, unknown>; minzoom?: number };
  assert.deepEqual(of("border").paint!["line-width"], ["interpolate", ["linear"], ["zoom"], 1, 1.2, 8, 4.8]);
  assert.equal(of("river").paint!["line-width"], 2, "a line without a width was one pixel wide");
  assert.equal(of("lake").paint!["fill-color"], "#123456", "fills are not lines");
  assert.equal(of("road").paint!["line-width"], 1.5);
  assert.equal(of("road").paint!["line-gap-width"], 0.5);
  assert.equal(of("pin").paint!["circle-radius"], 4, "other groups are left alone");
  assert.equal(of("names").layout!["text-padding"], undefined);
  assert.equal((style.layers[0].paint!["line-width"] as unknown[])[4], 0.6, "the style given is not changed");
});

test("fewer names keep more room and start later; more names the other way round", () => {
  const fewer = applyLookDetails(style, { lines: 1, roads: 1, labels: "fewer" });
  const names = fewer.layers[4] as { layout: Record<string, unknown>; minzoom: number };
  assert.equal(names.layout["text-padding"], 24);
  assert.equal(names.minzoom, 4);
  assert.equal((names.layout["text-field"] as unknown[])[1], "name", "the rest of the layout stays");
  const more = applyLookDetails(style, { lines: 1, roads: 1, labels: "more" });
  const crowd = more.layers[4] as { layout: Record<string, unknown>; minzoom: number };
  assert.equal(crowd.layout["text-padding"], 0);
  assert.equal(crowd.minzoom, 2);
});
