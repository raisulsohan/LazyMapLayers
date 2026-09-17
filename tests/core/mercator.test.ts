import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LATITUDE,
  TILE_SIZE,
  latFromMercatorY,
  lngLatToWorld,
  mercatorYFromLat,
  metersPerPixel,
  unwrapLongitudeNear,
  worldToLngLat,
  wrapLongitude
} from "../../src/core/geo/mercator.ts";

const close = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

test("world corners at zoom 0", () => {
  const nw = lngLatToWorld({ lng: -180, lat: MAX_LATITUDE }, 0);
  close(nw.x, 0);
  close(nw.y, 0, 1e-6);
  const se = lngLatToWorld({ lng: 180, lat: -MAX_LATITUDE }, 0);
  close(se.x, TILE_SIZE);
  close(se.y, TILE_SIZE, 1e-6);
  const origin = lngLatToWorld({ lng: 0, lat: 0 }, 3);
  close(origin.x, TILE_SIZE * 4);
  close(origin.y, TILE_SIZE * 4);
});

test("lngLat round trip (Dhaka, Reykjavik, Wellington)", () => {
  for (const p of [
    { lng: 90.4125, lat: 23.8103 },
    { lng: -21.8174, lat: 64.1265 },
    { lng: 174.7762, lat: -41.2865 }
  ]) {
    for (const zoom of [0, 7.3, 18]) {
      const back = worldToLngLat(lngLatToWorld(p, zoom), zoom);
      close(back.lng, p.lng, 1e-9);
      close(back.lat, p.lat, 1e-9);
    }
  }
});

test("mercator y is symmetric and inverts", () => {
  close(mercatorYFromLat(0), 0.5);
  close(mercatorYFromLat(40) + mercatorYFromLat(-40), 1);
  close(latFromMercatorY(mercatorYFromLat(51.5)), 51.5, 1e-10);
});

test("longitude wrapping", () => {
  close(wrapLongitude(190), -170);
  close(wrapLongitude(-190), 170);
  close(wrapLongitude(180), -180);
  close(wrapLongitude(540), -180);
  close(unwrapLongitudeNear(-170, 175), 190);
  close(unwrapLongitudeNear(170, -175), -190);
  close(unwrapLongitudeNear(10, 20), 10);
});

test("ground resolution", () => {
  // 40075016.686 m / 512 px at the equator, zoom 0.
  close(metersPerPixel(0, 0), 78271.51696402048, 1e-6);
  close(metersPerPixel(60, 1), 78271.51696402048 / 4, 1e-6);
});
