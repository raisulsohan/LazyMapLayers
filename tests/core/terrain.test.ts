import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleTerrarium, terrariumAt, tileOf } from "../../src/core/geo/terrarium.ts";
import { hillshadeIndex, normaliseTerrain } from "../../src/core/style/terrain.ts";

test("terrain settings are normalised and clamped", () => {
  assert.equal(normaliseTerrain(null), null);
  assert.equal(normaliseTerrain({ pack: "Bad Name" }), null);
  assert.deepEqual(normaliseTerrain({ pack: "everest" }), { pack: "everest", shade: 0.55, height: 0, ground: 0 });
  assert.deepEqual(normaliseTerrain({ pack: "everest", shade: 7, height: 9, ground: 99999 }), { pack: "everest", shade: 1, height: 4, ground: 9000 });
  assert.deepEqual(normaliseTerrain({ pack: "alps", shade: 0.333, height: 1.25, ground: 1234.6 }), { pack: "alps", shade: 0.33, height: 1.25, ground: 1235 });
});

test("shaded slopes go above the ground's colours and below what is drawn on it", () => {
  assert.equal(hillshadeIndex(["background", "land", "imagery", "water", "boundaries", "roads"]), 3);
  assert.equal(hillshadeIndex(["background", "land", "water", "land", "roads", "labels"]), 4);
  assert.equal(hillshadeIndex(["overlay"]), 0);
});

test("terrarium pixels decode to metres and sample bilinearly", () => {
  // A 2 x 2 tile: 0 m, 100 m; 1000 m, -50.5 m.
  const px = (m: number) => {
    const v = m + 32768;
    const r = Math.floor(v / 256);
    const g = Math.floor(v - r * 256);
    const b = Math.round((v - r * 256 - g) * 256);
    return [r, g, b, 255];
  };
  const rgba = new Uint8ClampedArray([...px(0), ...px(100), ...px(1000), ...px(-50.5)]);
  assert.equal(terrariumAt(rgba, 2, 0, 0), 0);
  assert.equal(terrariumAt(rgba, 2, 1, 0), 100);
  assert.equal(terrariumAt(rgba, 2, 0, 1), 1000);
  assert.ok(Math.abs(terrariumAt(rgba, 2, 1, 1) - -50.5) < 0.01);
  // Pixel centres lie at 0.25 and 0.75 of the tile: half way between them the values blend evenly.
  assert.ok(Math.abs(sampleTerrarium(rgba, 2, 0.5, 0.25) - 50) < 1e-9);
  assert.ok(Math.abs(sampleTerrarium(rgba, 2, 0.25, 0.5) - 500) < 1e-9);
  assert.equal(sampleTerrarium(rgba, 2, 0.1, 0.1), 0);
  assert.ok(Math.abs(sampleTerrarium(rgba, 2, 0.9, 0.9) - -50.5) < 0.01);
});

test("a position finds its tile and its place inside it", () => {
  const t = tileOf(27.9881, 86.925, 12);
  assert.deepEqual([t.z, t.x, t.y], [12, 3037, 1716]);
  assert.ok(t.fx >= 0 && t.fx < 1 && t.fy >= 0 && t.fy < 1);
  const origin = tileOf(0, -180, 0);
  assert.deepEqual([origin.x, origin.y], [0, 0]);
  assert.ok(Math.abs(origin.fx) < 1e-9 && Math.abs(origin.fy - 0.5) < 1e-9);
  assert.equal(tileOf(80, 179.9999999, 1).x, 1);
});
