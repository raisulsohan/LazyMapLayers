import { test } from "node:test";
import assert from "node:assert/strict";
import { project, type View, type Viewport } from "../../src/core/camera/camera.ts";
import { globeRadiusPixels, globeness, projectPoint } from "../../src/core/camera/globe.ts";

const hd: Viewport = { width: 1920, height: 1080 };
const globe = { projection: "globe" as const };

test("globeness: globe to zoom 7, Mercator from 8", () => {
  assert.equal(globeness(3), 1);
  assert.equal(globeness(7), 1);
  assert.equal(globeness(7.25), 0.75);
  assert.equal(globeness(8), 0);
  assert.equal(globeness(16), 0);
  assert.equal(globeness(3, "mercator"), 0);
});

test("the view centre projects to the frame centre at any bearing and pitch", () => {
  for (const view of [
    { center: { lng: 12, lat: 41 }, zoom: 2.3, bearing: 0, pitch: 0 },
    { center: { lng: -100, lat: -35 }, zoom: 6, bearing: 70, pitch: 50 },
    { center: { lng: 139.7, lat: 35.7 }, zoom: 11.5, bearing: -30, pitch: 60 }
  ] as View[]) {
    const p = projectPoint(view, hd, view.center, globe);
    assert.ok(Math.abs(p.x - 960) < 1e-6 && Math.abs(p.y - 540) < 1e-6, `${p.x}, ${p.y}`);
    assert.ok(p.visible);
  }
});

test("east is right, north is up, bearing 90 puts east at the top", () => {
  const view: View = { center: { lng: 20, lat: 10 }, zoom: 3, bearing: 0, pitch: 0 };
  const east = projectPoint(view, hd, { lng: 25, lat: 10 }, globe);
  const north = projectPoint(view, hd, { lng: 20, lat: 15 }, globe);
  assert.ok(east.x > 960 && Math.abs(east.y - 540) < 40);
  assert.ok(north.y < 540 && Math.abs(north.x - 960) < 1e-6);
  const turned = projectPoint({ ...view, bearing: 90 }, hd, { lng: 25, lat: 10 }, globe);
  assert.ok(turned.y < 540 && Math.abs(turned.x - 960) < 40);
});

test("near the centre the globe keeps the Mercator map scale", () => {
  const view: View = { center: { lng: 2.35, lat: 48.86 }, zoom: 6.5, bearing: 0, pitch: 0 };
  const point = { lng: 2.4, lat: 48.88 };
  const round = projectPoint(view, hd, point, globe);
  const flat = project(view, hd, point);
  // About 4 km away at zoom 6.5: the two projections differ by far less than a pixel.
  assert.ok(Math.hypot(round.x - flat.x, round.y - flat.y) < 0.05, `${round.x},${round.y} vs ${flat.x},${flat.y}`);
});

test("the far side of the planet is hidden, the near limb is not", () => {
  const view: View = { center: { lng: 0, lat: 0 }, zoom: 2, bearing: 0, pitch: 0 };
  assert.equal(projectPoint(view, hd, { lng: 180, lat: 0 }, globe).visible, false);
  assert.equal(projectPoint(view, hd, { lng: 100, lat: 0 }, globe).visible, false);
  assert.equal(projectPoint(view, hd, { lng: 60, lat: 0 }, globe).visible, true);
  // The limb: the silhouette is a circle of radius D·R/sqrt((R + D)² - R²) around the centre.
  const r = globeRadiusPixels(view);
  const limbAngle = Math.acos(r / (r + 1620));
  const justInside = projectPoint(view, hd, { lng: (limbAngle / Math.PI) * 180 - 0.5, lat: 0 }, globe);
  const justOutside = projectPoint(view, hd, { lng: (limbAngle / Math.PI) * 180 + 0.5, lat: 0 }, globe);
  assert.equal(justInside.visible, true);
  assert.equal(justOutside.visible, false);
  const silhouette = (1620 * r) / Math.sqrt((r + 1620) ** 2 - r * r);
  assert.ok(Math.abs(justInside.x - 960 - silhouette) < 2, `${justInside.x - 960} vs ${silhouette}`);
  // A point high above the hidden side can still be seen over the limb.
  const high = projectPoint(view, hd, { lng: (limbAngle / Math.PI) * 180 + 3, lat: 0 }, { ...globe, altitudeMeters: 3_000_000 });
  assert.equal(high.visible, true);
});

test("from zoom 8 the globe projection is exactly Mercator; the transition is continuous", () => {
  const base: View = { center: { lng: 139.7671, lat: 35.6812 }, zoom: 8, bearing: 25, pitch: 45 };
  const point = { lng: 139.95, lat: 35.8 };
  const mercator = project(base, hd, point);
  const atEight = projectPoint(base, hd, point, globe);
  assert.ok(Math.abs(atEight.x - mercator.x) < 1e-9 && Math.abs(atEight.y - mercator.y) < 1e-9);
  let previous = projectPoint({ ...base, zoom: 6.9 }, hd, point, globe);
  for (let zoom = 6.91; zoom <= 8.1; zoom += 0.01) {
    const current = projectPoint({ ...base, zoom }, hd, point, globe);
    // Zooming by 0.01 moves this point by about 0.7 % of its distance from the centre; no jumps.
    const expectedStep = Math.hypot(current.x - 960, current.y - 540) * 0.012 + 0.5;
    assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < expectedStep, `jump at zoom ${zoom.toFixed(2)}`);
    previous = current;
  }
});

test("altitude lifts points towards the camera in both projections", () => {
  const flatView: View = { center: { lng: 2.35, lat: 48.86 }, zoom: 14, bearing: 0, pitch: 60 };
  const ground = projectPoint(flatView, hd, { lng: 2.35, lat: 48.87 });
  const lifted = projectPoint(flatView, hd, { lng: 2.35, lat: 48.87 }, { altitudeMeters: 300 });
  assert.ok(lifted.y < ground.y, "a raised point appears higher on screen");
  const roundView: View = { center: { lng: 0, lat: 0 }, zoom: 3, bearing: 0, pitch: 0 };
  const g = projectPoint(roundView, hd, { lng: 30, lat: 0 }, globe);
  const up = projectPoint(roundView, hd, { lng: 30, lat: 0 }, { ...globe, altitudeMeters: 500_000 });
  assert.ok(up.x > g.x && up.w < g.w, "a raised point moves outwards and closer");
});

test("pixels on the globe disc", async () => {
  const { pixelOnGlobe } = await import("../../src/core/camera/globe.ts");
  const view: View = { center: { lng: 0, lat: 0 }, zoom: 2, bearing: 0, pitch: 0 };
  assert.equal(pixelOnGlobe(view, hd, 960, 540), true);
  assert.equal(pixelOnGlobe(view, hd, 10, 10), false);
  const r = globeRadiusPixels(view);
  const silhouette = (1620 * r) / Math.sqrt((r + 1620) ** 2 - r * r);
  assert.equal(pixelOnGlobe(view, hd, 960 + silhouette - 2, 540), true);
  assert.equal(pixelOnGlobe(view, hd, 960 + silhouette + 2, 540), false);
  assert.equal(pixelOnGlobe({ ...view, zoom: 9 }, hd, 10, 10), true, "flat map: every pixel");
});
