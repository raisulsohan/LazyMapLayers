import { test } from "node:test";
import assert from "node:assert/strict";
import { importGeoJson } from "../../src/core/data/importLines.ts";
import { centralAngle } from "../../src/core/geo/greatCircle.ts";
import { paceKeys } from "../../src/core/geo/pace.ts";
import { prepareRouteLine } from "../../src/core/geo/routeLine.ts";
import { lineLengthKm } from "../../src/core/geo/simplify.ts";

const DEG = Math.PI / 180;

test("a long leg is cut into short pieces along the great circle, and km runs along the original", () => {
  const dhaka = { lat: 23.8, lng: 90.4 };
  const london = { lat: 51.5, lng: -0.1 };
  const prepared = prepareRouteLine([dhaka, london], { maxPoints: 300, geodesic: true });
  assert.ok(prepared.points.length > 30 && prepared.points.length < 80, `${prepared.points.length} points`);
  assert.deepEqual(prepared.points[0], dhaka);
  assert.deepEqual(prepared.points[prepared.points.length - 1], london);
  for (let i = 1; i < prepared.points.length; i++) {
    assert.ok(centralAngle(prepared.points[i - 1], prepared.points[i]) / DEG <= 2.0001, "pieces of at most 2 degrees");
    assert.ok(prepared.km[i] >= prepared.km[i - 1]);
  }
  // The great circle from Dhaka to London climbs far north of both.
  assert.ok(Math.max(...prepared.points.map((p) => p.lat)) > 52.5);
  assert.ok(Math.abs(prepared.km[prepared.km.length - 1] - lineLengthKm([dhaka, london])) < 1e-6);

  // The outline of an area stays straight on the flat map: along a parallel the latitude does not move.
  const flat = prepareRouteLine([{ lat: 49, lng: -120 }, { lat: 49, lng: -95 }], { maxPoints: 300, geodesic: false });
  assert.ok(flat.points.length > 8);
  for (const p of flat.points) assert.ok(Math.abs(p.lat - 49) < 1e-9);
});

test("a great circle across the antimeridian keeps its longitudes continuous, and what follows it too", () => {
  const prepared = prepareRouteLine([{ lat: 35.7, lng: 139.7 }, { lat: 37.6, lng: -122.4 }, { lat: 34, lng: -118.2 }], { maxPoints: 300, geodesic: true });
  for (let i = 1; i < prepared.points.length; i++) assert.ok(Math.abs(prepared.points[i].lng - prepared.points[i - 1].lng) < 5, `jump at ${i}`);
  const last = prepared.points[prepared.points.length - 1];
  assert.ok(Math.abs(last.lng - (360 - 118.2)) < 1e-9, `the line ends at ${last.lng}`);
});

test("a dense track stays within its budget and keeps its own points", () => {
  const track = Array.from({ length: 5000 }, (_, i) => ({ lat: 46 + Math.sin(i / 90) * 0.05, lng: 7 + i * 0.0002 }));
  const prepared = prepareRouteLine(track, { maxPoints: 300, geodesic: true });
  assert.ok(prepared.points.length <= 300 && prepared.points.length > 40, `${prepared.points.length} points`);
  assert.ok(prepared.points.every((p) => track.some((q) => q.lat === p.lat && q.lng === p.lng)));
});

test("the recorded pace becomes keys: slow where the recording was slow", () => {
  // 100 points along the equator: the first half takes 900 s, the second half 100 s.
  const points = Array.from({ length: 101 }, (_, i) => ({ lat: 0, lng: i * 0.01 }));
  const times = points.map((_, i) => (i <= 50 ? i * 18 : 900 + (i - 50) * 2));
  const prepared = prepareRouteLine(points, { maxPoints: 300, geodesic: true });
  const keys = paceKeys({ points, times }, prepared, { startFrame: 100, endFrame: 200 });
  assert.deepEqual(keys[0], [100, 0]);
  assert.deepEqual(keys[keys.length - 1], [200, 100]);
  // Two straight stretches need three keys: the turn is at 90 % of the time and half of the way.
  assert.equal(keys.length, 3);
  assert.equal(keys[1][0], 190);
  assert.ok(Math.abs(keys[1][1] - 50) < 0.5, `half way at the turn, got ${keys[1][1]}`);
});

test("a long stop is shortened, a short one is kept, and keys never run backwards", () => {
  const points = Array.from({ length: 61 }, (_, i) => ({ lat: 10 + i * 0.001, lng: 20 }));
  // Moving 10 s per point; an hour's rest at point 30 (recorded as a repeated position).
  const coordinates: number[][] = [];
  const stamps: string[] = [];
  let clock = Date.UTC(2026, 0, 1, 8, 0, 0);
  points.forEach((p, i) => {
    coordinates.push([p.lng, p.lat]);
    stamps.push(new Date(clock).toISOString());
    if (i === 30) {
      clock += 3600e3;
      coordinates.push([p.lng, p.lat]);
      stamps.push(new Date(clock).toISOString());
    }
    clock += 10e3;
  });
  const line = importGeoJson({ type: "Feature", properties: { name: "Hike", coordinateProperties: { times: stamps } }, geometry: { type: "LineString", coordinates } }).lines[0];
  assert.equal(line.points.length, 61);
  assert.equal(line.times![30], 300);
  assert.equal(line.leaves![30], 3900);
  assert.equal(line.times![31], 3910);

  const prepared = prepareRouteLine(line.points, { maxPoints: 300, geodesic: true });
  const short = paceKeys({ points: line.points, times: line.times!, leaves: line.leaves }, prepared, { startFrame: 0, endFrame: 1000 });
  // 600 s of moving: the rest shrinks to 2 % of that (12 s of 612), in the middle of the way.
  const rest = short.filter(([, value]) => Math.abs(value - 50) < 0.01);
  assert.equal(rest.length, 2, JSON.stringify(short));
  assert.ok(Math.abs(rest[1][0] - rest[0][0] - Math.round((12 / 612) * 1000)) <= 1, `the rest lasts ${rest[1][0] - rest[0][0]} frames`);

  const whole = paceKeys({ points: line.points, times: line.times!, leaves: line.leaves }, prepared, { startFrame: 0, endFrame: 1000, maxPauseShare: Infinity });
  const wholeRest = whole.filter(([, value]) => Math.abs(value - 50) < 0.01);
  assert.ok(wholeRest[1][0] - wholeRest[0][0] > 840, "the whole hour is kept on request");
  for (const keys of [short, whole]) {
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i][0] > keys[i - 1][0] && keys[i][1] >= keys[i - 1][1], JSON.stringify(keys));
  }
});

test("a noisy recording still gives a small number of keys", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const points = Array.from({ length: 4000 }, (_, i) => ({ lat: 45 + i * 0.0001, lng: 9 + Math.sin(i / 300) * 0.01 }));
  let clock = 0;
  const times = points.map(() => (clock += 1 + random() * 3));
  const prepared = prepareRouteLine(points, { maxPoints: 300, geodesic: true });
  const keys = paceKeys({ points, times }, prepared, { startFrame: 0, endFrame: 250 });
  assert.ok(keys.length >= 2 && keys.length <= 80, `${keys.length} keys`);
  // Without times that fit the points the line draws on evenly.
  assert.deepEqual(paceKeys({ points, times: [0, 1] }, prepared, { startFrame: 0, endFrame: 250 }), [
    [0, 0],
    [250, 100]
  ]);
});
