import { test } from "node:test";
import assert from "node:assert/strict";
import { flyPath } from "../../src/core/camera/flyPath.ts";
import type { View, Viewport } from "../../src/core/camera/camera.ts";
import { lngLatToWorld } from "../../src/core/geo/mercator.ts";

const close = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

const hd: Viewport = { width: 1920, height: 1080 };
const bangladesh: View = { center: { lng: 90.3, lat: 23.7 }, zoom: 6, bearing: 0, pitch: 0 };
const dhaka: View = { center: { lng: 90.4125, lat: 23.8103 }, zoom: 12, bearing: 20, pitch: 45 };
const london: View = { center: { lng: -0.1276, lat: 51.5072 }, zoom: 10, bearing: 0, pitch: 0 };

test("path starts and ends exactly on the given views", () => {
  const path = flyPath(bangladesh, dhaka, hd);
  const start = path.at(0);
  close(start.center.lng, bangladesh.center.lng, 1e-9);
  close(start.center.lat, bangladesh.center.lat, 1e-9);
  close(start.zoom, 6, 1e-9);
  const end = path.at(1);
  assert.deepEqual(end.center, dhaka.center);
  assert.equal(end.zoom, 12);
  assert.equal(end.pitch, 45);
  close(end.bearing, 20);
});

test("a long flight zooms out in the middle, then back in", () => {
  const path = flyPath(dhaka, london, hd);
  assert.ok(path.minZoomReached < 10 - 3, `min zoom ${path.minZoomReached}`);
  const mid = path.at(0.5);
  assert.ok(mid.zoom < 10 && mid.zoom < 12);
  assert.ok(path.length > 0);
});

test("the view keeps moving: no held-position phase", () => {
  // Screen-space distance of the centre between consecutive samples never collapses to zero.
  const path = flyPath(dhaka, london, hd);
  const steps = 200;
  let previous = path.at(0);
  for (let i = 1; i <= steps; i++) {
    const current = path.at(i / steps);
    const a = lngLatToWorld(previous.center, current.zoom);
    const b = lngLatToWorld(current.center, current.zoom);
    const moved = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(current.zoom - previous.zoom) * 100;
    assert.ok(moved > 0.5, `stalled at step ${i}`);
    previous = current;
  }
});

test("minZoom caps how far the path zooms out", () => {
  const path = flyPath(dhaka, london, hd, { minZoom: 5 });
  assert.ok(Math.abs(path.minZoomReached - 5) < 0.05, `min zoom ${path.minZoomReached}`);
});

test("pure zoom has no pan and is monotonic", () => {
  const near: View = { ...dhaka, zoom: 16, bearing: 0, pitch: 0 };
  const far: View = { ...dhaka, zoom: 8, bearing: 0, pitch: 0 };
  const path = flyPath(near, far, hd);
  let lastZoom = Infinity;
  for (let i = 0; i <= 50; i++) {
    const v = path.at(i / 50);
    close(v.center.lng, dhaka.center.lng, 1e-9);
    assert.ok(v.zoom <= lastZoom + 1e-9);
    lastZoom = v.zoom;
  }
});

test("crossing the antimeridian takes the short way", () => {
  const fiji: View = { center: { lng: 178.4, lat: -18.1 }, zoom: 7, bearing: 0, pitch: 0 };
  const samoa: View = { center: { lng: -171.8, lat: -13.8 }, zoom: 7, bearing: 0, pitch: 0 };
  const path = flyPath(fiji, samoa, hd);
  for (let i = 0; i <= 20; i++) {
    const lng = path.at(i / 20).center.lng;
    assert.ok(lng >= 178.4 - 1e-9 && lng <= 188.2 + 1e-9, `lng ${lng}`);
  }
});

test("bearing turns the short way round", () => {
  const a: View = { ...bangladesh, bearing: 350 };
  const b: View = { ...bangladesh, zoom: 7, bearing: 10 };
  const mid = flyPath(a, b, hd).at(0.5);
  close(mid.bearing, 360);
});
