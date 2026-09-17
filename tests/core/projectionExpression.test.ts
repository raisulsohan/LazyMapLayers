import { test } from "node:test";
import assert from "node:assert/strict";
import { froundSource, projectionPrelude } from "../../src/core/ae/projectionExpression.ts";
import { float32 } from "../../src/core/ae/pinExpressions.ts";
import type { View } from "../../src/core/camera/camera.ts";
import { projectPoint } from "../../src/core/camera/globe.ts";

type Controls = Record<string, number>;

function run(code: string, controls: Controls, size: { width: number; height: number }) {
  const map = {
    source: size,
    effect: (name: string) => () => {
      if (!(name in controls)) throw new Error(`no effect ${name}`);
      return { value: controls[name] };
    }
  };
  return new Function("map", `${code}`)(map);
}

let seed = 99;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

for (const projection of ["mercator", "globe"] as const) {
  test(`expression projection equals core maths (${projection})`, () => {
    const size = { width: 1920, height: 1080 };
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const raw: View = {
        center: { lng: random() * 360 - 180, lat: random() * 150 - 75 },
        zoom: i % 4 === 0 ? 7 + random() : random() * 16,
        bearing: random() * 360 - 180,
        pitch: random() * 70
      };
      // The expression sees float32 sliders, so compare against core with the same values.
      const view: View = { center: { lat: float32(raw.center.lat), lng: float32(raw.center.lng) }, zoom: float32(raw.zoom), bearing: float32(raw.bearing), pitch: float32(raw.pitch) };
      const spread = 40 / 2 ** Math.max(0, view.zoom - 1);
      const point = { lat: Math.max(-80, Math.min(80, view.center.lat + (random() - 0.5) * spread)), lng: view.center.lng + (random() - 0.5) * spread };
      const altitude = i % 3 === 0 ? random() * 200000 : 0;
      const controls: Controls = { Latitude: view.center.lat, Longitude: view.center.lng, Zoom: view.zoom, Bearing: view.bearing, Pitch: view.pitch };
      if (projection === "globe") controls.Globe = 1;
      const code = `${projectionPrelude()}return lmlProject(${point.lat}, ${point.lng}, ${altitude});`;
      const got = run(code, controls, size) as { x: number; y: number; visible: boolean };
      const expected = projectPoint(view, size, point, { projection, altitudeMeters: altitude });
      assert.equal(got.visible, expected.visible, `case ${i}: visibility`);
      if (!expected.visible) continue;
      const tolerance = 1e-6 * Math.max(1, Math.abs(expected.x) + Math.abs(expected.y));
      assert.ok(Math.abs(got.x - expected.x) < tolerance && Math.abs(got.y - expected.y) < tolerance, `case ${i}: ${got.x},${got.y} vs ${expected.x},${expected.y}`);
      checked++;
    }
    assert.ok(checked > 250, `only ${checked} visible cases`);
  });
}

test("maps without a Globe control are Mercator", () => {
  const controls: Controls = { Latitude: 10, Longitude: 20, Zoom: 3, Bearing: 0, Pitch: 0 };
  const got = run(`${projectionPrelude()}return lmlProject(12, 25, 0);`, controls, { width: 1920, height: 1080 }) as { x: number; y: number };
  const expected = projectPoint({ center: { lat: 10, lng: 20 }, zoom: 3, bearing: 0, pitch: 0 }, { width: 1920, height: 1080 }, { lat: 12, lng: 25 });
  assert.ok(Math.abs(got.x - expected.x) < 1e-9 && Math.abs(got.y - expected.y) < 1e-9);
});

test("the ES3 float32 rounding equals Math.fround", () => {
  const fround = new Function(`${froundSource()}return lmlFround;`)() as (x: number) => number;
  const values = [0, -0, 1, -1, 0.5, 2.5, 3.5, 16777217, 16777218, 16777219, 1 + 2 ** -24, 1 + 3 * 2 ** -25, 2 ** -149, 2 ** -150, 3 * 2 ** -151, 2 ** -126, 1.5 * 2 ** -127];
  values.push(3.4028234663852886e38, 3.4028235677973362e38, 3.4028235677973366e38, 1e39, -1e300, Infinity, -Infinity, 5e-324, 48.8583701, -73.9856644);
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 20000; i++) values.push((random() - 0.5) * 2 ** Math.floor(random() * 340 - 170));
  for (let i = 0; i < 2000; i++) values.push((Math.floor(random() * 2 ** 24) + 0.5) * 2 ** Math.floor(random() * 60 - 30));
  for (const x of values) assert.ok(Object.is(fround(x), Math.fround(x)), `${x}: ${fround(x)} vs ${Math.fround(x)}`);
  assert.ok(Number.isNaN(fround(NaN)));
});
