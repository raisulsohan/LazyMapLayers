import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraToCenterDistance,
  horizonY,
  project,
  projectWorldOffset,
  unproject,
  type View,
  type Viewport
} from "../../src/core/camera/camera.ts";
import { MAX_LATITUDE, lngLatToWorld } from "../../src/core/geo/mercator.ts";

const close = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

const hd: Viewport = { width: 1920, height: 1080 };
const dhaka: View = { center: { lng: 90.4125, lat: 23.8103 }, zoom: 9, bearing: 0, pitch: 0 };

test("camera distance matches MapLibre's default field of view", () => {
  // tan(fov / 2) = 0.75 / 2 ... MapLibre's default fov gives distance = 1.5 * height.
  close(cameraToCenterDistance(hd), 1620, 1e-9);
});

test("centre projects to the middle of the frame", () => {
  const p = project({ ...dhaka, bearing: 33, pitch: 50 }, hd, dhaka.center);
  close(p.x, 960);
  close(p.y, 540);
  close(p.scale, 1);
});

test("flat, north-up view is a plain scale and translate", () => {
  const offset = project(dhaka, hd, { lng: 90.5, lat: 23.7 });
  const c = lngLatToWorld(dhaka.center, dhaka.zoom);
  const t = lngLatToWorld({ lng: 90.5, lat: 23.7 }, dhaka.zoom);
  close(offset.x, 960 + (t.x - c.x));
  close(offset.y, 540 + (t.y - c.y));
});

test("bearing 90 puts east at the top of the frame", () => {
  const p = projectWorldOffset({ ...dhaka, bearing: 90 }, hd, 100, 0);
  close(p.x, 960);
  close(p.y, 440);
});

test("pitch makes northern points farther and smaller", () => {
  const north = projectWorldOffset({ ...dhaka, pitch: 60 }, hd, 0, -300);
  const south = projectWorldOffset({ ...dhaka, pitch: 60 }, hd, 0, 300);
  assert.ok(north.scale < 1 && south.scale > 1);
  assert.ok(north.y < 540 && south.y > 540);
  assert.ok(540 - north.y < south.y - 540);
});

test("unproject inverts project for random views", () => {
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  let checked = 0;
  for (let i = 0; i < 500; i++) {
    const view: View = {
      center: { lng: random() * 360 - 180, lat: random() * 140 - 70 },
      zoom: random() * 18,
      bearing: random() * 360 - 180,
      pitch: random() * 80
    };
    const screen = { x: random() * hd.width, y: random() * hd.height };
    const ground = unproject(view, hd, screen);
    if (!ground) {
      assert.ok(screen.y <= horizonY(view, hd) + 1e-6, "null only above the horizon");
      continue;
    }
    // At low zoom a pixel can fall outside the mercator world (beyond the polar limit) or on
    // another world copy more than half a turn away; project() rightly maps those elsewhere.
    if (Math.abs(ground.lat) >= MAX_LATITUDE || Math.abs(ground.lng - view.center.lng) > 180) continue;
    const back = project(view, hd, ground);
    assert.ok(Math.abs(back.x - screen.x) < 1e-3 && Math.abs(back.y - screen.y) < 1e-3, `view ${i}`);
    checked++;
  }
  assert.ok(checked > 350, `only ${checked} views checked`);
});

test("horizon position", () => {
  assert.equal(horizonY(dhaka, hd), -Infinity);
  close(horizonY({ ...dhaka, pitch: 80 }, hd), 540 - 1620 / Math.tan((80 * Math.PI) / 180));
});
