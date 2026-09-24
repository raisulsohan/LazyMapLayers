import { test } from "node:test";
import assert from "node:assert/strict";
import { paintPass, paintSatelliteTile, type SceneSampler } from "../../src/core/imagery/satelliteTile.ts";
import { SCENE_CLASSES, pixelToSceneGrid } from "../../src/core/imagery/sentinel.ts";
import { lngLatFromUtm } from "../../src/core/geo/utm.ts";

const GRID = { zone: 45, north: true };
const SIZE = 8;
const Z = 13;
const X = 6047;
const Y = 3546;

/** A scene that answers one colour everywhere, and can call part of the ground cloud. */
function scene(colour: [number, number, number], options: { cloudy?: (x: number, y: number) => boolean; blank?: (x: number, y: number) => boolean } = {}): SceneSampler {
  const pixel = new Uint8Array(colour);
  return {
    grid: GRID,
    colour: (x, y) => (options.blank?.(x, y) ? new Uint8Array([0, 0, 0]) : pixel),
    kind: options.cloudy ? (x, y) => (options.cloudy?.(x, y) ? SCENE_CLASSES.cloudHigh : SCENE_CLASSES.vegetation) : null
  };
}

test("the clearest scene paints the tile", () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  const out = paintSatelliteTile(Z, X, Y, SIZE, [scene([10, 120, 60]), scene([200, 0, 0])], rgba);
  assert.equal(out.painted, SIZE * SIZE);
  assert.deepEqual(out.used, [0], "the second scene is never needed");
  assert.deepEqual([rgba[0], rgba[1], rgba[2], rgba[3]], [10, 120, 60, 255]);
});

test("what the first scene lost to cloud, the next one fills", () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  // The eastern half of the ground is under cloud in the first scene.
  const middle = pixelToSceneGrid(Z, X, Y, SIZE / 2, SIZE / 2, SIZE, GRID).x;
  const out = paintSatelliteTile(Z, X, Y, SIZE, [scene([10, 120, 60], { cloudy: (x) => x > middle }), scene([90, 90, 90])], rgba);
  assert.equal(out.painted, SIZE * SIZE, "every pixel ends up painted");
  assert.deepEqual(out.used, [0, 1]);
  const at = (px: number, py: number) => [rgba[(py * SIZE + px) * 4], rgba[(py * SIZE + px) * 4 + 1], rgba[(py * SIZE + px) * 4 + 2]];
  assert.deepEqual(at(0, 0), [10, 120, 60], "the clear west comes from the first scene");
  assert.deepEqual(at(SIZE - 1, 0), [90, 90, 90], "the cloudy east comes from the second");
});

test("the black edge of a scene is not a colour", () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  const middle = pixelToSceneGrid(Z, X, Y, SIZE / 2, SIZE / 2, SIZE, GRID).y;
  const out = paintSatelliteTile(Z, X, Y, SIZE, [scene([10, 120, 60], { blank: (_x, y) => y > middle }), scene([90, 90, 90])], rgba);
  assert.equal(out.painted, SIZE * SIZE);
  assert.deepEqual(out.used, [0, 1]);
});

test("a tile nothing covers stays empty, and says so", () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  const nothing: SceneSampler = { grid: GRID, colour: () => null };
  const out = paintSatelliteTile(Z, X, Y, SIZE, [nothing, nothing], rgba);
  assert.equal(out.painted, 0);
  assert.deepEqual(out.used, []);
  assert.equal(rgba[3], 0, "nothing was made up for it");
});

test("a pass only paints what is still empty, so an earlier scene is never overwritten", () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  const first = paintPass(Z, X, Y, SIZE, scene([1, 2, 3]), rgba);
  assert.equal(first, SIZE * SIZE);
  const second = paintPass(Z, X, Y, SIZE, scene([9, 9, 9]), rgba);
  assert.equal(second, 0);
  assert.deepEqual([rgba[0], rgba[1], rgba[2]], [1, 2, 3]);
});

test("every pixel of the tile is asked about the place it really stands on", () => {
  const seen: { lat: number; lng: number }[] = [];
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  paintPass(
    Z,
    X,
    Y,
    SIZE,
    {
      grid: GRID,
      colour: (x, y) => {
        seen.push(lngLatFromUtm({ x, y }, GRID));
        return new Uint8Array([1, 1, 1]);
      }
    },
    rgba
  );
  assert.equal(seen.length, SIZE * SIZE);
  // The places run west to east along a row and north to south down the tile.
  assert.ok(seen[1].lng > seen[0].lng);
  assert.ok(seen[SIZE].lat < seen[0].lat);
  // And they all sit inside the tile's own corners.
  const west = (X / Math.pow(2, Z)) * 360 - 180;
  const east = ((X + 1) / Math.pow(2, Z)) * 360 - 180;
  for (const place of seen) assert.ok(place.lng > west && place.lng < east, `${place.lng} outside ${west}..${east}`);
});
