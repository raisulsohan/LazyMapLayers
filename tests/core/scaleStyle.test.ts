import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleStyleSizes, scaleValue } from "../../src/core/style/scaleStyle.ts";

test("sizes scale in every form a style uses", () => {
  assert.equal(scaleValue(2, 4), 8);
  assert.deepEqual(scaleValue(["interpolate", ["linear"], ["zoom"], 1, 10, 6, 16], 2), ["interpolate", ["linear"], ["zoom"], 1, 20, 6, 32]);
  assert.deepEqual(scaleValue(["step", ["zoom"], 1, 5, 2, 10, 3], 3), ["step", ["zoom"], 3, 5, 6, 10, 9]);
  assert.deepEqual(scaleValue(["match", ["get", "kind"], "locality", 16, "macrohood", 13, 11], 2), ["match", ["get", "kind"], "locality", 32, "macrohood", 26, 22]);
  assert.deepEqual(scaleValue(["case", ["has", "a"], 4, ["has", "b"], 2, 1], 2), ["case", ["has", "a"], 8, ["has", "b"], 4, 2]);
  // Outputs inside a zoom interpolation may be expressions themselves.
  assert.deepEqual(scaleValue(["interpolate", ["exponential", 1.8], ["zoom"], 8, ["match", ["get", "kind"], "river", 0.8, 0.4], 12, 4], 5), [
    "interpolate",
    ["exponential", 1.8],
    ["zoom"],
    8,
    ["match", ["get", "kind"], "river", 4, 2],
    12,
    20
  ]);
  assert.deepEqual(scaleValue(["get", "radius"], 2), ["*", 2, ["get", "radius"]]);
  assert.deepEqual(scaleValue({ stops: [[3, 1], [8, 2]] }, 2), { stops: [[3, 2], [8, 4]] });
  // A zoom expression in an unknown wrapper is left alone rather than broken.
  const odd = ["+", 1, ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 2]];
  assert.deepEqual(scaleValue(odd, 2), odd);
});

test("a style's text, lines and circles scale; everything else stays", () => {
  const style = {
    version: 8,
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#000" } },
      { id: "line", type: "line", paint: { "line-color": "#fff", "line-width": 1.5, "line-dasharray": [2, 2] } },
      { id: "thin", type: "line", paint: { "line-color": "#fff" } },
      { id: "text", type: "symbol", layout: { "text-field": "x", "text-size": 12, "text-max-width": 8 }, paint: { "text-halo-width": 1 } },
      { id: "dot", type: "circle", paint: { "circle-radius": ["get", "radius"] } }
    ]
  };
  const scaled = scaleStyleSizes(style, 4) as typeof style;
  assert.equal(scaled.layers[0], style.layers[0]);
  assert.deepEqual(scaled.layers[1].paint, { "line-color": "#fff", "line-width": 6, "line-dasharray": [2, 2] });
  assert.equal((scaled.layers[2].paint as Record<string, unknown>)["line-width"], 4);
  assert.deepEqual(scaled.layers[3].layout, { "text-field": "x", "text-size": 48, "text-max-width": 8 });
  assert.deepEqual(scaled.layers[3].paint, { "text-halo-width": 4 });
  assert.deepEqual((scaled.layers[4].paint as Record<string, unknown>)["circle-radius"], ["*", 4, ["get", "radius"]]);
  assert.equal(scaleStyleSizes(style, 1), style);
  // The input is never changed.
  assert.equal(style.layers[1].paint!["line-width"], 1.5);
});
