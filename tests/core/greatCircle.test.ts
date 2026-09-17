import { test } from "node:test";
import assert from "node:assert/strict";
import { centralAngle, distanceMeters, greatCircle } from "../../src/core/geo/greatCircle.ts";

const paris = { lat: 48.8566, lng: 2.3522 };
const tokyo = { lat: 35.6762, lng: 139.6503 };

test("great-circle distance Paris to Tokyo", () => {
  const km = distanceMeters(paris, tokyo) / 1000;
  assert.ok(Math.abs(km - 9712) < 15, `${km} km`);
  assert.ok(Math.abs(centralAngle(paris, paris)) < 1e-12);
});

test("route points are evenly spaced, start and end exactly, and arc upwards", () => {
  const route = greatCircle(paris, tokyo, 65, 0.1);
  assert.equal(route.length, 65);
  assert.deepEqual(route[0], { ...paris, altitude: 0 });
  assert.ok(Math.abs(route[64].lat - tokyo.lat) < 1e-9 && Math.abs(route[64].lng - tokyo.lng) < 1e-9);
  assert.equal(route[64].altitude, 0);
  const step = distanceMeters(route[0], route[1]);
  for (let i = 1; i < 64; i++) assert.ok(Math.abs(distanceMeters(route[i], route[i + 1]) - step) < 1, "even spacing");
  const middle = route[32];
  assert.ok(Math.abs(middle.altitude - 0.1 * distanceMeters(paris, tokyo)) < 1);
  // The shortest route from Paris to Tokyo passes north of both cities.
  assert.ok(middle.lat > 60, `middle latitude ${middle.lat}`);
});

test("longitudes stay continuous across the antimeridian", () => {
  const route = greatCircle({ lat: 35.5, lng: 139.8 }, { lat: 37.6, lng: -122.4 }, 50);
  for (let i = 1; i < route.length; i++) assert.ok(Math.abs(route[i].lng - route[i - 1].lng) < 10);
  assert.ok(Math.abs(route[49].lng - 237.6) < 1e-6);
});
