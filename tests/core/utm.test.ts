import { test } from "node:test";
import assert from "node:assert/strict";
import { centralMeridian, lngLatFromUtm, utmFromLngLat, zoneOfEpsg, zoneOfLongitude } from "../../src/core/geo/utm.ts";

const DEG = Math.PI / 180;
const A = 6378137.0;
const F = 1 / 298.257223563;
const K0 = 0.9996;

/**
 * The same projection worked out a different way: Snyder's series in terms of the eccentricity, from
 * "Map Projections - A Working Manual". Two derivations that agree to a millimetre are worth more
 * than numbers copied from somewhere.
 */
function snyder(lat: number, lng: number, zone: number, north: boolean): { x: number; y: number } {
  const e2 = 2 * F - F * F;
  const ep2 = e2 / (1 - e2);
  const phi = lat * DEG;
  const lambda = (lng - centralMeridian(zone)) * DEG;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - e2 * sin * sin);
  const t = tan * tan;
  const c = ep2 * cos * cos;
  const a = lambda * cos;
  const m =
    A *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));
  const x = K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * a ** 5) / 120) + 500000;
  const y =
    K0 * (m + n * tan * ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * a ** 6) / 720)) +
    (north ? 0 : 10000000);
  return { x, y };
}

test("zones and their middle meridians", () => {
  assert.equal(zoneOfLongitude(-180), 1);
  assert.equal(zoneOfLongitude(-177), 1);
  assert.equal(zoneOfLongitude(0.5), 31);
  assert.equal(zoneOfLongitude(90.41), 46);
  assert.equal(zoneOfLongitude(179.9), 60);
  assert.equal(centralMeridian(1), -177);
  assert.equal(centralMeridian(31), 3);
  assert.equal(centralMeridian(46), 93);
  assert.deepEqual(zoneOfEpsg(32645), { zone: 45, north: true });
  assert.deepEqual(zoneOfEpsg(32760), { zone: 60, north: false });
  assert.equal(zoneOfEpsg(4326), null);
  assert.equal(zoneOfEpsg(32661), null);
});

test("the grid agrees with Snyder's own series across the world", () => {
  let worst = 0;
  let worstAt = "";
  for (let lat = -80; lat <= 84; lat += 4) {
    for (let offset = -3; offset <= 3; offset += 0.75) {
      const zone = zoneOfLongitude(centralMeridian(31) + offset);
      const grid = { zone, north: lat >= 0 };
      const place = { lat, lng: centralMeridian(zone) + offset };
      const mine = utmFromLngLat(place, grid);
      const theirs = snyder(place.lat, place.lng, zone, grid.north);
      const off = Math.hypot(mine.x - theirs.x, mine.y - theirs.y);
      if (off > worst) {
        worst = off;
        worstAt = `${lat}, ${place.lng}`;
      }
    }
  }
  assert.ok(worst < 0.01, `worst disagreement ${worst.toFixed(4)} m at ${worstAt}`);
});

test("on the middle meridian the grid is the meridian arc itself", () => {
  // The distance from the equator, worked out by adding up the meridian's own curve.
  const e2 = 2 * F - F * F;
  const arc = (lat: number) => {
    const steps = 200000;
    const top = lat * DEG;
    let total = 0;
    for (let i = 0; i < steps; i++) {
      const phi = (top * (i + 0.5)) / steps;
      const sin = Math.sin(phi);
      total += ((A * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5)) * (top / steps);
    }
    return total;
  };
  for (const lat of [10, 45, 60]) {
    const point = utmFromLngLat({ lat, lng: 3 }, { zone: 31, north: true });
    assert.ok(Math.abs(point.x - 500000) < 1e-6, `easting ${point.x} on the middle meridian`);
    const wanted = K0 * arc(lat);
    assert.ok(Math.abs(point.y - wanted) < 0.02, `${lat} degrees: northing ${point.y.toFixed(3)} against the arc ${wanted.toFixed(3)}`);
  }
  // 45 degrees north is the published 4,984,944.4 m of arc, 4,982,950.4 m on the grid.
  const at45 = utmFromLngLat({ lat: 45, lng: 3 }, { zone: 31, north: true });
  assert.ok(Math.abs(at45.y - 4982950.4) < 0.5, `${at45.y}`);
});

test("the two sides of the middle meridian mirror each other", () => {
  const grid = { zone: 31, north: true };
  for (const lat of [0, 30, 55]) {
    const east = utmFromLngLat({ lat, lng: centralMeridian(31) + 2.5 }, grid);
    const west = utmFromLngLat({ lat, lng: centralMeridian(31) - 2.5 }, grid);
    assert.ok(Math.abs(east.x - 500000 - (500000 - west.x)) < 1e-6, `${east.x} and ${west.x}`);
    assert.ok(Math.abs(east.y - west.y) < 1e-6);
  }
});

test("every place comes back from its grid position", () => {
  let worst = 0;
  for (let lat = -78; lat <= 78; lat += 6) {
    for (let offset = -3; offset <= 3; offset += 1.5) {
      for (const zone of [1, 18, 31, 45, 60]) {
        const grid = { zone, north: lat >= 0 };
        const place = { lat, lng: centralMeridian(zone) + offset };
        const back = lngLatFromUtm(utmFromLngLat(place, grid), grid);
        worst = Math.max(worst, Math.abs(back.lat - place.lat), Math.abs(back.lng - place.lng));
      }
    }
  }
  assert.ok(worst < 1e-8, `worst round trip off by ${worst} degrees`);
});

test("a scene may be delivered on its neighbour's grid, which still reads right", () => {
  // Sentinel-2 tile 45QZG holds ground east of zone 45, where Dhaka sits; the numbers stay usable.
  const grid = { zone: 45, north: true };
  const place = { lat: 23.8103, lng: 90.4125 };
  const point = utmFromLngLat(place, grid);
  assert.ok(point.x > 800000 && point.x < 900000, `${point.x} should be well east of the zone's middle`);
  const back = lngLatFromUtm(point, grid);
  // A third of a millimetre: the series holds a degree past the zone, which is what a scene needs.
  assert.ok(Math.abs(back.lat - place.lat) < 1e-8 && Math.abs(back.lng - place.lng) < 1e-8);
  // And the same place on its own zone is near that zone's middle instead.
  const own = utmFromLngLat(place, { zone: 46, north: true });
  assert.ok(Math.abs(own.x - 237000) < 2000, `${own.x}`);
});
