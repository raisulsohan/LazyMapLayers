import { test } from "node:test";
import assert from "node:assert/strict";
import { float32, pinExpressions, EXPRESSION_MARKER } from "../../src/core/ae/pinExpressions.ts";
import { project, type View, type Viewport } from "../../src/core/camera/camera.ts";

type Effects = Record<string, number>;

/** Evaluates an expression the way AE's JavaScript engine does: the last statement is the result. */
function evaluate(code: string, env: { pinEffects: Effects; mapEffects: Effects; value: unknown; comp: Viewport; toComp?: (p: number[]) => number[] }) {
  const effect = (name: string) => (index: number) => {
    assert.equal(index, 1);
    if (name === "Map") {
      return {
        source: { width: env.comp.width, height: env.comp.height },
        effect: (n: string) => () => ({ value: env.mapEffects[n] }),
        toComp: env.toComp ?? ((p: number[]) => [p[0], p[1], 0])
      };
    }
    if (!(name in env.pinEffects)) throw new Error(`unknown pin effect ${name}`);
    return { value: env.pinEffects[name] };
  };
  const run = new Function("effect", "value", "return eval(arguments[2]);");
  return run(effect, env.value, code);
}

const hd: Viewport = { width: 1920, height: 1080 };
const mapEffectsFor = (view: View): Effects => ({
  Latitude: float32(view.center.lat),
  Longitude: float32(view.center.lng),
  Zoom: float32(view.zoom),
  Bearing: float32(view.bearing),
  Pitch: float32(view.pitch)
});
const viewFromEffects = (e: Effects): View => ({
  center: { lat: e.Latitude, lng: e.Longitude },
  zoom: e.Zoom,
  bearing: e.Bearing,
  pitch: e.Pitch
});

test("expressions carry the marker and stay free of non-ASCII text", () => {
  const e = pinExpressions(48.8583701, 2.2944813);
  for (const code of Object.values(e)) {
    assert.ok(code.startsWith(EXPRESSION_MARKER));
    assert.ok(![...code].some((c) => c.charCodeAt(0) > 126));
  }
});

test("position matches core projection for random views and pins", () => {
  let seed = 11;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 300; i++) {
    const view: View = {
      center: { lng: random() * 340 - 170, lat: random() * 140 - 70 },
      zoom: random() * 19,
      bearing: random() * 360 - 180,
      pitch: random() * 80
    };
    const pinLat = view.center.lat + (random() - 0.5) * 20 / 2 ** view.zoom;
    const pinLng = view.center.lng + (random() - 0.5) * 30 / 2 ** view.zoom;
    const mapEffects = mapEffectsFor(view);
    const code = pinExpressions(pinLat, pinLng).position;
    const result = evaluate(code, {
      pinEffects: { Latitude: float32(pinLat), Longitude: float32(pinLng) },
      mapEffects,
      value: [0, 0],
      comp: hd
    }) as number[];
    // Core maths with the exact pin coordinates and the (float32) camera the renderer also sees.
    const expected = project(viewFromEffects(mapEffects), hd, { lat: pinLat, lng: pinLng });
    assert.equal(result.length, 2);
    assert.ok(Math.abs(result[0] - expected.x) < 1e-6 && Math.abs(result[1] - expected.y) < 1e-6, `case ${i}: ${result} vs ${expected.x},${expected.y}`);
  }
});

test("exact coordinates beat float32 slider rounding at street zoom", () => {
  const view: View = { center: { lat: 48.8583701, lng: 2.2944813 }, zoom: 20, bearing: 0, pitch: 0 };
  const pinLat = 48.8584123;
  const pinLng = 2.2945777;
  const withExact = evaluate(pinExpressions(pinLat, pinLng).position, {
    pinEffects: { Latitude: float32(pinLat), Longitude: float32(pinLng) },
    mapEffects: mapEffectsFor(view),
    value: [0, 0],
    comp: hd
  }) as number[];
  const expected = project(viewFromEffects(mapEffectsFor(view)), hd, { lat: pinLat, lng: pinLng });
  const sliderOnly = project(viewFromEffects(mapEffectsFor(view)), hd, { lat: float32(pinLat), lng: float32(pinLng) });
  assert.ok(Math.hypot(withExact[0] - expected.x, withExact[1] - expected.y) < 1e-6);
  assert.ok(Math.hypot(sliderOnly.x - expected.x, sliderOnly.y - expected.y) > 0.5, "float32 alone would be off by more than half a pixel");
});

test("a changed slider value takes over from the baked coordinates", () => {
  const view: View = { center: { lat: 10, lng: 20 }, zoom: 6, bearing: 0, pitch: 0 };
  const moved = evaluate(pinExpressions(10, 20).position, {
    pinEffects: { Latitude: float32(11), Longitude: float32(20) },
    mapEffects: mapEffectsFor(view),
    value: [0, 0],
    comp: hd
  }) as number[];
  const expected = project(view, hd, { lat: 11, lng: 20 });
  assert.ok(Math.abs(moved[1] - expected.y) < 1e-3);
});

test("3D position keeps z, and the map layer transform is applied", () => {
  const view: View = { center: { lat: 0, lng: 0 }, zoom: 3, bearing: 0, pitch: 0 };
  const result = evaluate(pinExpressions(0, 0).position, {
    pinEffects: { Latitude: 0, Longitude: 0 },
    mapEffects: mapEffectsFor(view),
    value: [1, 2, -50],
    comp: hd,
    toComp: (p) => [p[0] * 0.5 + 100, p[1] * 0.5 + 10, 0]
  }) as number[];
  assert.deepEqual(result, [960 * 0.5 + 100, 540 * 0.5 + 10, -50]);
});

test("scale, rotation and opacity follow the map", () => {
  const view: View = { center: { lat: 30, lng: 30 }, zoom: 8, bearing: 40, pitch: 0 };
  const env = {
    pinEffects: { Latitude: float32(30), Longitude: float32(30), "Scale with Map": 1, "Rotate with Map": 1, "Reference Zoom": 7 },
    mapEffects: mapEffectsFor(view),
    comp: hd
  };
  const e = pinExpressions(30, 30);
  assert.deepEqual(evaluate(e.scale, { ...env, value: [100, 100] }), [200, 200]);
  assert.equal(evaluate(e.rotation, { ...env, value: 5 }), 5 - float32(40));
  assert.equal(evaluate(e.opacity, { ...env, value: 80 }), 80);
  const off = { ...env, pinEffects: { ...env.pinEffects, "Scale with Map": 0, "Rotate with Map": 0 } };
  assert.deepEqual(evaluate(e.scale, { ...off, value: [100, 100] }), [100, 100]);
  assert.equal(evaluate(e.rotation, { ...off, value: 5 }), 5);
});

test("a pin behind the camera is hidden, one far ahead stays visible", () => {
  // Pitched north: points to the south pass under and behind the camera; points to the north only
  // get farther away and converge on the horizon.
  const view: View = { center: { lat: 0, lng: 0 }, zoom: 10, bearing: 0, pitch: 80 };
  const opacity = (lat: number) =>
    evaluate(pinExpressions(lat, 0).opacity, {
      pinEffects: { Latitude: float32(lat), Longitude: 0 },
      mapEffects: mapEffectsFor(view),
      value: 100,
      comp: hd
    });
  assert.equal(opacity(-5), 0);
  assert.equal(opacity(5), 100);
});
