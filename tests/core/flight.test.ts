import { test } from "node:test";
import assert from "node:assert/strict";
import { cubicBezier, easyEase, flightKeys } from "../../src/core/camera/flight.ts";
import type { View } from "../../src/core/camera/camera.ts";

const hd = { width: 1920, height: 1080 };

test("cubic Bézier easing: endpoints, symmetry, linear case", () => {
  assert.equal(easyEase(0), 0);
  assert.equal(easyEase(1), 1);
  assert.ok(Math.abs(easyEase(0.5) - 0.5) < 1e-6);
  assert.ok(Math.abs(easyEase(0.2) + easyEase(0.8) - 1) < 1e-6);
  assert.ok(easyEase(0.1) < 0.1, "starts slowly");
  const linear = cubicBezier(0.25, 0.25, 0.75, 0.75);
  for (const x of [0.1, 0.37, 0.9]) assert.ok(Math.abs(linear(x) - x) < 1e-6);
  let previous = 0;
  for (let x = 0; x <= 1; x += 0.01) {
    const y = easyEase(x);
    assert.ok(y >= previous - 1e-12, "monotonic");
    previous = y;
  }
});

test("a flight starts and lands exactly, one key per frame", () => {
  const paris: View = { center: { lat: 48.8584, lng: 2.2945 }, zoom: 15, bearing: 30, pitch: 55 };
  const tokyo: View = { center: { lat: 35.6586, lng: 139.7454 }, zoom: 14.5, bearing: -20, pitch: 50 };
  const keys = flightKeys(paris, tokyo, hd, { duration: 10, frameRate: 25, startTime: 3 });
  assert.equal(keys.length, 251);
  assert.equal(keys[0].time, 3);
  assert.ok(Math.abs(keys[250].time - 13) < 1e-9);
  assert.deepEqual(keys[0].view.center, paris.center);
  assert.equal(keys[0].view.pitch, 55);
  const last = keys[250].view;
  assert.ok(Math.abs(last.center.lat - tokyo.center.lat) < 1e-9 && Math.abs(last.center.lng - tokyo.center.lng) < 1e-9);
  assert.equal(last.zoom, 14.5);
  assert.equal(last.pitch, 50);
  // Bearing takes the short way (30 -> -20 is -50 degrees).
  assert.ok(Math.abs(last.bearing - -20) < 1e-9);
  // The flight climbs to a globe view and flattens the pitch on the way.
  const top = keys.reduce((a, b) => (b.view.zoom < a.view.zoom ? b : a));
  assert.ok(top.view.zoom < 4, `top zoom ${top.view.zoom}`);
  assert.ok(top.view.pitch < 1, `pitch at the top ${top.view.pitch}`);
  // No longitude jumps between frames.
  for (let i = 1; i < keys.length; i++) assert.ok(Math.abs(keys[i].view.center.lng - keys[i - 1].view.center.lng) < 10);
});

test("across the antimeridian the longitude stays continuous", () => {
  const a: View = { center: { lat: 35, lng: 170 }, zoom: 5, bearing: 0, pitch: 0 };
  const b: View = { center: { lat: 21, lng: -157 }, zoom: 6, bearing: 0, pitch: 0 };
  const keys = flightKeys(a, b, hd, { duration: 4, frameRate: 30 });
  for (let i = 1; i < keys.length; i++) assert.ok(Math.abs(keys[i].view.center.lng - keys[i - 1].view.center.lng) < 5);
  assert.ok(Math.abs(keys[keys.length - 1].view.center.lng - 203) < 1e-6, "lands on -157 unwrapped to 203");
});
