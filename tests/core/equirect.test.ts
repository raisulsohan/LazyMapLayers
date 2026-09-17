import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMips, levelForZoom, modeOf, reliefToOverlay, sampleTile, type Raster } from "../../src/core/imagery/equirect.ts";

/** A world where red is the longitude (0 to 255 from west to east) and green the latitude (north to south). */
function world(width: number, height: number): Raster {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      data[o] = Math.round((x / (width - 1)) * 255);
      data[o + 1] = Math.round((y / (height - 1)) * 255);
      data[o + 2] = 7;
    }
  return { width, height, channels: 3, data };
}

test("mips halve the image and keep its averages", () => {
  const levels = buildMips(world(2048, 1024));
  assert.deepEqual(
    levels.map((l) => l.width),
    [2048, 1024, 512, 256]
  );
  const small = levels[3];
  const middle = (64 * small.width + 128) * 3;
  assert.ok(Math.abs(small.data[middle] - 128) <= 2 && Math.abs(small.data[middle + 1] - 128) <= 2);
  assert.equal(small.data[middle + 2], 7);
  assert.equal(levelForZoom(levels, 0).width, 512);
  assert.equal(levelForZoom(levels, 1).width, 1024);
  assert.equal(levelForZoom(levels, 5).width, 2048, "never above the source");
});

test("tiles follow the Mercator rows and the straight columns", () => {
  const level = world(4096, 2048);
  const size = 256;
  const out = new Uint8Array(size * size * 3);
  sampleTile(level, 0, 0, 0, size, out);
  const at = (i: number, j: number) => [out[(j * size + i) * 3], out[(j * size + i) * 3 + 1]];
  // Centre of the world tile: longitude 0 (red 128), equator (green 128).
  assert.ok(Math.abs(at(128, 128)[0] - 128) <= 1 && Math.abs(at(128, 128)[1] - 128) <= 1);
  // The top row is latitude 85.05: (90 - 85.05) / 180 of the height.
  assert.ok(Math.abs(at(10, 0)[1] - Math.round((4.95 / 180) * 255)) <= 1, `top row green ${at(10, 0)[1]}`);
  // A quarter down the Mercator tile is latitude 66.51, not 45.
  assert.ok(Math.abs(at(10, 64)[1] - Math.round(((90 - 66.51) / 180) * 255)) <= 1, `quarter row green ${at(10, 64)[1]}`);
  // Zoom 1, tile (1, 0): the north-east quarter starts at longitude 0 and latitude 85.05.
  sampleTile(level, 1, 1, 0, size, out);
  assert.ok(Math.abs(at(0, 0)[0] - 128) <= 1, `west edge red ${at(0, 0)[0]}`);
  assert.ok(at(255, 0)[0] >= 253);
  assert.ok(Math.abs(at(0, 255)[1] - 127) <= 1, "bottom row is the equator");
});

test("relief becomes shadows and highlights around the flat grey", () => {
  const gray = new Uint8Array([200, 200, 100, 255, 200, 190]);
  assert.equal(modeOf({ width: 6, height: 1, channels: 1, data: gray }, 1), 200);
  const rgba = new Uint8Array(24);
  reliefToOverlay(gray, 200, rgba, { gain: 1, deadZone: 0, alphaLevels: 256 });
  assert.deepEqual(Array.from(rgba.slice(0, 4)), [0, 0, 0, 0], "flat is fully transparent");
  assert.deepEqual(Array.from(rgba.slice(8, 12)), [0, 0, 0, 128], "a shadow is black with alpha");
  assert.deepEqual(Array.from(rgba.slice(12, 16)), [255, 255, 255, 255], "the brightest highlight is solid white");
  assert.equal(rgba[23], 13, "a faint shadow is faint");
  // Defaults: faint shading is dropped and the alpha moves in 32 steps.
  reliefToOverlay(new Uint8Array([195, 100]), 200, rgba);
  assert.equal(rgba[3], 0, "inside the dead zone");
  assert.equal(rgba[7], Math.round(Math.round((255 * 0.8) / (255 / 31)) * (255 / 31)), "quantised alpha");
});
