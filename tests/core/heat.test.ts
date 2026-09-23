import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HEAT, heatColorStops, heatFeatures, heatLegendColors, heatPoints, MAX_HEAT_POINTS, normaliseHeat } from "../../src/core/style/heat.ts";

test("places with numbers become weighted points, heaviest first, and nothing warms nothing", () => {
  const points = heatPoints([
    { lat: 23.8, lng: 90.4, value: 10 },
    { lat: 28.6, lng: 77.2, value: 60 },
    { lat: 35.7, lng: 139.7 },
    { lat: 0, lng: 0, value: 0 },
    { lat: 0, lng: 0, value: -3 },
    { lat: 95, lng: 0, value: 4 },
    { lat: Number.NaN, lng: 0, value: 4 }
  ]);
  assert.deepEqual(points, [
    [77.2, 28.6, 60],
    [90.4, 23.8, 10],
    [139.7, 35.7, 1]
  ]);
  const many = heatPoints(Array.from({ length: MAX_HEAT_POINTS + 50 }, (_, i) => ({ lat: 1, lng: i / 1000, value: i + 1 })));
  assert.equal(many.length, MAX_HEAT_POINTS);
  assert.equal(many[0][2], MAX_HEAT_POINTS + 50, "the heaviest survive");
  assert.equal(heatPoints([{ lat: 1.23456789, lng: 2.98765432, value: 1 }])[0].join(), "2.9877,1.2346,1", "positions are rounded to a few metres");
});

test("a stored heat map is repaired, and one without a point is none", () => {
  assert.equal(normaliseHeat(null), null);
  assert.equal(normaliseHeat({ points: [] }), null);
  assert.equal(normaliseHeat({ points: [[0, 0, 0]] }), null, "a weight of nothing is no point");
  const heat = normaliseHeat({ column: "  Incidents ", points: [[90.4, 23.8, 5], ["bad"], [1, 2, -1], [200, 95, 3], [77.2, 28.6, "2"]], radius: 9999, intensity: 0, opacity: 2, ramp: "nope", reverse: "yes" })!;
  assert.equal(heat.column, "Incidents");
  assert.deepEqual(heat.points, [
    [90.4, 23.8, 5],
    [77.2, 28.6, 2]
  ]);
  assert.equal(heat.radius, 300);
  assert.equal(heat.intensity, 0.1);
  assert.equal(heat.opacity, 1);
  assert.equal(heat.ramp, "blues");
  assert.equal(heat.reverse, false);
  const plain = normaliseHeat({ points: [[1, 2, 3]] })!;
  assert.equal(plain.column, "Points");
  assert.equal(plain.radius, DEFAULT_HEAT.radius);
});

test("the renderer reads every point with its weight scaled to the heaviest", () => {
  const features = heatFeatures({ ...DEFAULT_HEAT, column: "x", points: [[90.4, 23.8, 50], [77.2, 28.6, 200], [1, 1, 1]] });
  assert.equal(features.type, "FeatureCollection");
  assert.deepEqual(features.features.map((f) => f.properties.w), [0.25, 1, 0.005]);
  assert.deepEqual(features.features[0].geometry, { type: "Point", coordinates: [90.4, 23.8] });
});

test("the colours run from see-through to the deep end of the ramp, or the other way round", () => {
  const stops = heatColorStops("warm", false);
  assert.equal(stops[0][0], 0);
  assert.equal(stops[0][1], "rgba(255, 241, 208, 0)");
  assert.equal(stops[stops.length - 1][1], "#7a2503");
  const turned = heatColorStops("warm", true);
  assert.equal(turned[0][1], "rgba(122, 37, 3, 0)");
  assert.equal(turned[turned.length - 1][1], "#fff1d0");
  // Densities climb, so the renderer's interpolation is valid.
  for (let i = 1; i < stops.length; i++) assert.ok(stops[i][0] > stops[i - 1][0]);
});

test("the legend of the heat has three steps, low to high, turned over with the ramp", () => {
  const steps = heatLegendColors("warm", false);
  assert.deepEqual(steps.map((s) => s.label), ["Low", "Medium", "High"]);
  assert.equal(steps[1].color, "#f0902f");
  assert.equal(steps[2].color, "#7a2503");
  assert.notEqual(steps[0].color, steps[1].color, "low sits between the pale end and the middle");
  assert.equal(heatLegendColors("warm", true)[2].color, "#fff1d0");
});
