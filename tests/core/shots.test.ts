import { test } from "node:test";
import assert from "node:assert/strict";
import { project, type View } from "../../src/core/camera/camera.ts";
import { EASING_IDS, EASING_PRESETS, easingBezier, easingFunction } from "../../src/core/camera/easing.ts";
import { fitBounds, fitPoints } from "../../src/core/camera/fit.ts";
import { Polyline, routeMove } from "../../src/core/camera/routeMove.ts";
import { bakeShots, buildTimeline, normaliseShotList, suggestedMoveSeconds, viewAtFrame, type Shot, type ShotList } from "../../src/core/camera/shots.ts";
import { greatCircle } from "../../src/core/geo/greatCircle.ts";

const hd = { width: 1920, height: 1080 };
const paris: View = { center: { lat: 48.8584, lng: 2.2945 }, zoom: 15, bearing: 30, pitch: 55 };
const tokyo: View = { center: { lat: 35.6586, lng: 139.7454 }, zoom: 14.5, bearing: -20, pitch: 50 };
const globe: View = { center: { lat: 24, lng: -32 }, zoom: 1.6, bearing: 0, pitch: 0 };

const shot = (id: string, view: View, extra: Partial<Shot> = {}): Shot => ({
  id,
  name: id,
  view,
  hold: 2,
  move: { kind: "fly", seconds: 6, easing: { id: "smooth" }, height: "normal", pitchDip: true },
  ...extra
});

test("easing presets: exact ends, monotonic, and linear is the identity", () => {
  for (const id of EASING_IDS) {
    if (id === "custom") continue;
    const ease = easingFunction({ id });
    assert.equal(ease(0), 0, id);
    assert.equal(ease(1), 1, id);
    let previous = 0;
    for (let x = 0; x <= 1.0001; x += 0.005) {
      const y = ease(Math.min(1, x));
      assert.ok(y >= previous - 1e-9, `${id} is monotonic at ${x}`);
      previous = y;
    }
    assert.ok(EASING_PRESETS[id].label.length > 0);
  }
  const linear = easingFunction({ id: "linear" });
  for (const x of [0.13, 0.5, 0.91]) assert.ok(Math.abs(linear(x) - x) < 1e-12);
  assert.ok(easingFunction({ id: "cinematic" })(0.15) < easingFunction({ id: "smooth" })(0.15), "cinematic starts more gently than smooth");
  assert.ok(easingFunction({ id: "softLanding" })(0.3) > 0.3, "soft landing leaves at speed");
});

test("custom easing: control points are clamped to a valid curve", () => {
  assert.deepEqual(easingBezier({ id: "custom", bezier: [-1, 0.2, 3, Number.NaN] }), [0, 0.2, 1, 1]);
  const ease = easingFunction({ id: "custom", bezier: [0.9, 0, 0.1, 1] });
  assert.ok(Math.abs(ease(0.5) - 0.5) < 1e-6);
  assert.deepEqual(easingBezier({ id: "custom" }), easingBezier({ id: "smooth" }));
});

test("fitBounds frames a box with the margin, straight down", () => {
  const france = { west: -5.1, south: 42.3, east: 8.2, north: 51.1 };
  const view = fitBounds(france, hd, { padding: 0.1 });
  const pad = 108;
  let touches = false;
  for (const corner of [
    { lng: france.west, lat: france.south },
    { lng: france.east, lat: france.north },
    { lng: france.west, lat: france.north },
    { lng: france.east, lat: france.south }
  ]) {
    const p = project(view, hd, corner);
    assert.ok(p.x >= pad - 0.01 && p.x <= hd.width - pad + 0.01 && p.y >= pad - 0.01 && p.y <= hd.height - pad + 0.01, `corner inside: ${p.x}, ${p.y}`);
    if (Math.abs(p.y - pad) < 0.5 || Math.abs(p.y - (hd.height - pad)) < 0.5 || Math.abs(p.x - pad) < 0.5 || Math.abs(p.x - (hd.width - pad)) < 0.5) touches = true;
  }
  assert.ok(touches, "the box reaches the margin on at least one side (closest fit)");
  assert.ok(view.zoom > 4.5 && view.zoom < 6.5, `zoom ${view.zoom}`);
});

test("fitBounds works with pitch and bearing, and across the antimeridian", () => {
  const box = { west: 2.22, south: 48.81, east: 2.47, north: 48.91 };
  const view = fitBounds(box, hd, { bearing: 40, pitch: 60, padding: 0.08 });
  assert.equal(view.bearing, 40);
  assert.equal(view.pitch, 60);
  const pad = 0.08 * 1080;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const lng of [box.west, box.east])
    for (const lat of [box.south, box.north]) {
      const p = project(view, hd, { lng, lat });
      assert.ok(p.visible);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
  assert.ok(left >= pad - 0.5 && right <= hd.width - pad + 0.5 && top >= pad - 0.5 && bottom <= hd.height - pad + 0.5);
  assert.ok(Math.abs((left + right) / 2 - hd.width / 2) < 2 && Math.abs((top + bottom) / 2 - hd.height / 2) < 2, "centred on screen");

  const fiji = fitBounds({ west: 176, south: -20, east: -178, north: -15 }, hd);
  assert.ok(Math.abs(fiji.center.lng - 179) < 0.5, `centre ${fiji.center.lng}`);
  assert.ok(fiji.zoom > 6, `zoom ${fiji.zoom}`);
});

test("fitPoints: a single point uses the maximum zoom", () => {
  const view = fitPoints([{ lat: 10, lng: 20 }], hd, { maxZoom: 14 });
  assert.equal(view.zoom, 14);
  assert.ok(Math.abs(view.center.lat - 10) < 1e-6 && Math.abs(view.center.lng - 20) < 1e-6);
});

test("polyline: points by fraction and headings", () => {
  const line = new Polyline([
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 5, lng: 10 }
  ]);
  assert.ok(Math.abs(line.headingAt(0.2, 0.05) - 90) < 1e-6, "east");
  assert.ok(Math.abs(line.headingAt(0.9, 0.05) - 0) < 1e-6, "north");
  const corner = line.headingAt(10 / 15.02, 0.2);
  assert.ok(corner > 5 && corner < 85, `the corner is rounded: ${corner}`);
});

test("route move: starts and lands exactly, follows the line, turns smoothly", () => {
  const line = greatCircle(paris.center, tokyo.center, 128).map((p) => ({ lat: p.lat, lng: p.lng }));
  const move = routeMove(line, paris, tokyo, hd, {});
  assert.deepEqual(move.at(0), paris);
  const end = move.at(1);
  assert.ok(Math.abs(end.center.lat - tokyo.center.lat) < 1e-9 && Math.abs(end.center.lng - tokyo.center.lng) < 1e-9);
  assert.equal(end.zoom, tokyo.zoom);
  assert.equal(end.pitch, tokyo.pitch);
  assert.ok(Math.abs((((end.bearing - tokyo.bearing) % 360) + 360) % 360) < 1e-9, "lands on the bearing (any turn count)");
  assert.ok(move.topZoom < 4, `climbs: ${move.topZoom}`);
  // The great circle from Paris to Tokyo passes north of 60 degrees; a straight mercator line does not.
  const middle = move.at(0.5);
  assert.ok(middle.center.lat > 60, `follows the great circle: ${middle.center.lat}`);
  let previous = move.at(0);
  for (let i = 1; i <= 400; i++) {
    const v = move.at(i / 400);
    assert.ok(Math.abs(v.bearing - previous.bearing) < 6, `bearing step at ${i}: ${v.bearing - previous.bearing}`);
    assert.ok(Math.abs(v.center.lng - previous.center.lng) < 8, "longitude is continuous");
    previous = v;
  }
});

test("route move: level keeps the zoom between the ends and glides onto an offset line", () => {
  const a: View = { center: { lat: 48.85, lng: 2.29 }, zoom: 14, bearing: 0, pitch: 40 };
  const b: View = { center: { lat: 48.87, lng: 2.36 }, zoom: 15, bearing: 0, pitch: 40 };
  const line = [
    { lat: 48.853, lng: 2.3 },
    { lat: 48.86, lng: 2.32 },
    { lat: 48.868, lng: 2.35 }
  ];
  const move = routeMove(line, a, b, hd, { zoom: "level", followBearing: false });
  assert.deepEqual(move.at(0), a);
  for (let i = 0; i <= 50; i++) {
    const v = move.at(i / 50);
    assert.ok(v.zoom >= 14 - 1e-9 && v.zoom <= 15 + 1e-9);
    assert.equal(v.bearing, 0);
  }
  assert.equal(move.topZoom, 14);
});

test("shot list timeline: frames, continuity and exact shots", () => {
  const list: ShotList = {
    v: 1,
    start: 1,
    shots: [shot("globe", globe, { hold: 3, spin: 30, holdEasing: { id: "linear" } }), shot("paris", paris, { hold: 4, orbit: 40 }), shot("tokyo", tokyo, { move: { kind: "fly", seconds: 10, easing: { id: "cinematic" }, height: "high", pitchDip: true } })]
  };
  const timeline = buildTimeline(list, hd, 25);
  assert.equal(timeline.startFrame, 25);
  assert.deepEqual(
    timeline.shots.map((s) => [s.arriveFrame, s.leaveFrame]),
    [
      [25, 100],
      [250, 350],
      [600, 650]
    ]
  );
  assert.equal(timeline.endFrame, 650);
  // The globe spins evenly during its hold.
  assert.ok(Math.abs(viewAtFrame(timeline, 25 + 25)!.center.lng - (globe.center.lng + 10)) < 1e-9);
  // Shots are hit exactly.
  const onParis = viewAtFrame(timeline, 250)!;
  assert.ok(Math.abs(onParis.center.lat - paris.center.lat) < 1e-12 && onParis.zoom === paris.zoom && onParis.pitch === paris.pitch);
  assert.ok(Math.abs(viewAtFrame(timeline, 350)!.bearing - (paris.bearing + 40)) < 1e-9, "the orbit ends 40 degrees on");
  const onTokyo = viewAtFrame(timeline, 600)!;
  assert.equal(onTokyo.zoom, tokyo.zoom);
  // The flight out of Paris starts from the orbit's end, and nothing jumps between frames.
  let previous = viewAtFrame(timeline, 25)!;
  for (let f = 26; f <= 650; f++) {
    const v = viewAtFrame(timeline, f)!;
    assert.ok(Math.abs(v.bearing - previous.bearing) < 4, `bearing jump at ${f}`);
    // A wrap would jump by about 360 degrees; the fastest real motion is a few degrees per frame, high up.
    assert.ok(Math.abs(v.center.lng - previous.center.lng) < 40, `longitude jump at ${f}`);
    assert.ok(Math.abs(v.zoom - previous.zoom) < 1, `zoom jump at ${f}`);
    previous = v;
  }
  // Before the first shot and after the last the camera holds.
  assert.deepEqual(viewAtFrame(timeline, 0), viewAtFrame(timeline, 25));
  assert.deepEqual(viewAtFrame(timeline, 9999), viewAtFrame(timeline, 650));
});

test("baking: still holds need two keys, moves one key per frame, cuts hold their last frame", () => {
  const list: ShotList = {
    v: 1,
    start: 0,
    shots: [shot("a", paris, { hold: 2 }), shot("b", tokyo, { hold: 2, move: { kind: "cut", seconds: 0, easing: { id: "linear" } } }), shot("c", globe, { hold: 1, move: { kind: "fly", seconds: 4, easing: { id: "smooth" } } })]
  };
  const baked = bakeShots(list, hd, 30);
  assert.equal(baked.frames, 60 + 60 + 120 + 30 + 1);
  const zoom = baked.controls.find((c) => c.key === "zoom")!;
  // Shot a: frames 0, 59 (hold key) and the segment end 60 belongs to the cut's new view.
  assert.deepEqual(
    zoom.times.slice(0, 4).map((t) => Math.round(t * 30)),
    [0, 59, 60, 120]
  );
  assert.deepEqual(zoom.values.slice(0, 4), [15, 15, 14.5, 14.5]);
  assert.deepEqual(
    baked.holdTimes.map((t) => Math.round(t * 30)),
    [59]
  );
  assert.ok(baked.keyCount < baked.denseKeyCount * 0.7, `${baked.keyCount} of ${baked.denseKeyCount}`);
  assert.deepEqual(
    baked.markers.map((m) => [m.name, Math.round(m.time * 30)]),
    [
      ["a", 0],
      ["b", 60],
      ["c", 240]
    ]
  );
  for (const control of baked.controls) {
    for (let i = 1; i < control.times.length; i++) assert.ok(control.times[i] > control.times[i - 1], "times increase");
    assert.equal(control.times[control.times.length - 1], baked.endTime);
  }
});

test("stored shot lists are repaired instead of trusted", () => {
  const list = normaliseShotList({
    start: -4,
    shots: [{ view: { center: { lat: 200, lng: 10 }, zoom: 99, pitch: 120 }, hold: "x", move: { kind: "teleport", seconds: -1 } }, { id: "s1", name: "  Two  ", view: paris, move: { kind: "route", seconds: 5, easing: { id: "custom", bezier: [1, 2] }, route: { waypoints: [[1, 2], "bad", [3, 4]] } } }, null]
  });
  assert.equal(list.start, 0);
  assert.equal(list.shots.length, 3);
  assert.equal(list.shots[0].view.zoom, 22);
  assert.equal(list.shots[0].view.pitch, 85);
  assert.ok(list.shots[0].view.center.lat < 85.06);
  assert.equal(list.shots[0].move.kind, "fly");
  assert.equal(list.shots[0].move.seconds, 0);
  assert.equal(list.shots[1].id, "s1x", "duplicate ids are made unique");
  assert.equal(list.shots[1].name, "Two");
  assert.deepEqual(list.shots[1].move.route!.waypoints, [
    [1, 2],
    [3, 4]
  ]);
  assert.deepEqual(list.shots[1].move.easing, { id: "custom", bezier: [1 / 3, 0, 2 / 3, 1] });
  assert.doesNotThrow(() => bakeShots(list, hd, 25));
  assert.equal(bakeShots({ v: 1, start: 0, shots: [] }, hd, 25).keyCount, 0);
});

test("suggested durations grow with the distance", () => {
  const near: View = { ...paris, center: { lat: 48.87, lng: 2.33 } };
  const short = suggestedMoveSeconds(paris, near, hd);
  const long = suggestedMoveSeconds(paris, tokyo, hd);
  assert.ok(short >= 2 && short <= 6, `short ${short}`);
  assert.ok(long > short && long <= 20, `long ${long}`);
});
