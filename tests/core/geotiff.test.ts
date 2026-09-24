import { test } from "node:test";
import assert from "node:assert/strict";
import { zlibSync } from "fflate";
import { COMPRESSION, decodeTile, directoryForResolution, groundOf, pixelOf, readTiff, tileRange, TIFF_TAGS } from "../../src/core/image/geotiff.ts";

type Tag = { tag: number; type: number; values: number[] };

/** Writes a small tiled TIFF, the way a cloud-optimised one is laid out, to read back. */
function makeTiff(options: {
  levels: { width: number; height: number; tileWidth: number; tileHeight: number; samples: number; scale: number; compression: number; predictor: number; tiles: Uint8Array[] }[];
  origin?: { x: number; y: number };
  epsg?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 8;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    at += bytes.length;
    while (at % 2) {
      parts.push(new Uint8Array(1));
      at += 1;
    }
  };
  // Every level's tile data first, so the directories can point at it.
  const tileSpots = options.levels.map((level) =>
    level.tiles.map((tile) => {
      const spot = at;
      push(tile);
      return { offset: spot, bytes: tile.length };
    })
  );
  const directories: { tags: Tag[]; extra: { tag: number; bytes: Uint8Array }[] }[] = options.levels.map((level, i) => {
    const tags: Tag[] = [
      { tag: TIFF_TAGS.width, type: 4, values: [level.width] },
      { tag: TIFF_TAGS.height, type: 4, values: [level.height] },
      { tag: TIFF_TAGS.bitsPerSample, type: 3, values: Array.from({ length: level.samples }, () => 8) },
      { tag: TIFF_TAGS.compression, type: 3, values: [level.compression] },
      { tag: TIFF_TAGS.photometric, type: 3, values: [level.samples >= 3 ? 2 : 1] },
      { tag: TIFF_TAGS.samplesPerPixel, type: 3, values: [level.samples] },
      { tag: TIFF_TAGS.predictor, type: 3, values: [level.predictor] },
      { tag: TIFF_TAGS.tileWidth, type: 4, values: [level.tileWidth] },
      { tag: TIFF_TAGS.tileHeight, type: 4, values: [level.tileHeight] },
      { tag: TIFF_TAGS.tileOffsets, type: 4, values: tileSpots[i].map((t) => t.offset) },
      { tag: TIFF_TAGS.tileByteCounts, type: 4, values: tileSpots[i].map((t) => t.bytes) },
      ...(level.scale > 0
        ? [
            { tag: TIFF_TAGS.pixelScale, type: 12, values: [level.scale, level.scale, 0] },
            { tag: TIFF_TAGS.tiePoint, type: 12, values: [0, 0, 0, options.origin?.x ?? 300000, options.origin?.y ?? 2700000, 0] },
            { tag: TIFF_TAGS.geoKeys, type: 3, values: [1, 1, 0, 1, 3072, 0, 1, options.epsg ?? 32646] }
          ]
        : [])
    ];
    return { tags, extra: [] };
  });

  // Each directory: its entries, then the values too big to sit inside an entry.
  const directorySpots: number[] = [];
  const blocks: Uint8Array[] = [];
  for (const directory of directories) {
    directorySpots.push(at);
    const count = directory.tags.length;
    const header = new Uint8Array(2 + count * 12 + 4);
    const view = new DataView(header.buffer);
    view.setUint16(0, count, true);
    let valueAt = at + header.length;
    const values: Uint8Array[] = [];
    directory.tags.forEach((entry, i) => {
      const size = entry.type === 3 ? 2 : entry.type === 12 ? 8 : 4;
      const bytes = new Uint8Array(size * entry.values.length);
      const valueView = new DataView(bytes.buffer);
      entry.values.forEach((value, k) => {
        if (entry.type === 3) valueView.setUint16(k * 2, value, true);
        else if (entry.type === 12) valueView.setFloat64(k * 8, value, true);
        else valueView.setUint32(k * 4, value, true);
      });
      const p = 2 + i * 12;
      view.setUint16(p, entry.tag, true);
      view.setUint16(p + 2, entry.type, true);
      view.setUint32(p + 4, entry.values.length, true);
      if (bytes.length <= 4) header.set(bytes, p + 8);
      else {
        view.setUint32(p + 8, valueAt, true);
        values.push(bytes);
        valueAt += bytes.length + (bytes.length % 2);
      }
    });
    push(header);
    for (const bytes of values) push(bytes);
    blocks.push(header);
  }
  // Point each directory at the next.
  const file = new Uint8Array(at);
  const head = new DataView(file.buffer);
  head.setUint8(0, 0x49);
  head.setUint8(1, 0x49);
  head.setUint16(2, 42, true);
  head.setUint32(4, directorySpots[0], true);
  let cursor = 8;
  for (const part of parts) {
    file.set(part, cursor);
    cursor += part.length;
  }
  for (let i = 0; i < directorySpots.length; i++) {
    const spot = directorySpots[i];
    const count = new DataView(file.buffer).getUint16(spot, true);
    new DataView(file.buffer).setUint32(spot + 2 + count * 12, i + 1 < directorySpots.length ? directorySpots[i + 1] : 0, true);
  }
  return file;
}

/** A tile of three-sample pixels, packed the way a scene packs them. */
function tile(width: number, height: number, samples: number, paint: (x: number, y: number, s: number) => number, predictor: number, compression: number): Uint8Array {
  const raw = new Uint8Array(width * height * samples);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let s = 0; s < samples; s++) raw[(y * width + x) * samples + s] = paint(x, y, s) & 255;
    }
  }
  const packed = raw.slice();
  if (predictor === 2) {
    for (let y = 0; y < height; y++) {
      const start = y * width * samples;
      for (let x = width * samples - 1; x >= samples; x--) packed[start + x] = (raw[start + x] - raw[start + x - samples]) & 255;
    }
  }
  return compression === COMPRESSION.none ? packed : zlibSync(packed);
}

test("a tiled TIFF is read back with its tiles, its grid and its projection", () => {
  const paint = (x: number, y: number, s: number) => x * 3 + y * 5 + s * 7;
  const bytes = makeTiff({
    origin: { x: 600000, y: 2650000 },
    epsg: 32645,
    levels: [
      { width: 8, height: 8, tileWidth: 4, tileHeight: 4, samples: 3, scale: 10, compression: COMPRESSION.deflate, predictor: 2, tiles: [0, 1, 2, 3].map(() => tile(4, 4, 3, paint, 2, COMPRESSION.deflate)) },
      { width: 4, height: 4, tileWidth: 4, tileHeight: 4, samples: 3, scale: 20, compression: COMPRESSION.deflate, predictor: 1, tiles: [tile(4, 4, 3, paint, 1, COMPRESSION.deflate)] }
    ]
  });
  const tiff = readTiff(bytes);
  assert.equal(tiff.little, true);
  assert.equal(tiff.directories.length, 2);
  const full = tiff.directories[0];
  assert.equal(full.width, 8);
  assert.equal(full.tilesAcross, 2);
  assert.equal(full.tilesDown, 2);
  assert.equal(full.samples, 3);
  assert.equal(full.compression, COMPRESSION.deflate);
  assert.equal(full.predictor, 2);
  assert.equal(full.epsg, 32645);
  assert.deepEqual(full.scale, { x: 10, y: 10 });
  assert.deepEqual(full.origin, { x: 600000, y: 2650000 });

  // Every tile decodes to the pixels that were painted, predictor undone.
  const range = tileRange(full, 1, 1);
  assert.ok(range && range.bytes > 0);
  const pixels = decodeTile(full, bytes.slice(range.offset, range.offset + range.bytes));
  assert.equal(pixels.length, 4 * 4 * 3);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      for (let s = 0; s < 3; s++) assert.equal(pixels[(y * 4 + x) * 3 + s], paint(x, y, s) & 255, `pixel ${x},${y} sample ${s}`);
    }
  }
  assert.equal(tileRange(full, 2, 0), null, "a tile outside the picture is nothing");
});

test("ground positions and pixels turn into each other", () => {
  const bytes = makeTiff({
    origin: { x: 600000, y: 2650000 },
    levels: [{ width: 4, height: 4, tileWidth: 4, tileHeight: 4, samples: 1, scale: 10, compression: COMPRESSION.none, predictor: 1, tiles: [tile(4, 4, 1, () => 1, 1, COMPRESSION.none)] }]
  });
  const directory = readTiff(bytes).directories[0];
  assert.deepEqual(groundOf(directory, 0, 0), { x: 600000, y: 2650000 });
  assert.deepEqual(groundOf(directory, 2, 3), { x: 600020, y: 2649970 });
  assert.deepEqual(pixelOf(directory, 600020, 2649970), { x: 2, y: 3 });
});

test("the reader picks the level that suits the detail wanted", () => {
  const level = (scale: number, size: number) => ({ width: size, height: size, tileWidth: 4, tileHeight: 4, samples: 1, scale, compression: COMPRESSION.none, predictor: 1, tiles: [tile(4, 4, 1, () => 2, 1, COMPRESSION.none)] });
  const tiff = readTiff(makeTiff({ levels: [level(10, 16), level(20, 8), level(40, 4)] }));
  assert.equal(directoryForResolution(tiff, 10), 0);
  assert.equal(directoryForResolution(tiff, 22), 1);
  assert.equal(directoryForResolution(tiff, 100), 2);
  assert.equal(directoryForResolution(tiff, 1), 0, "never coarser than asked for");
});

test("a file that is not a TIFF, or is packed a way this cannot open, says so", () => {
  assert.throws(() => readTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /not a TIFF/);
  assert.throws(() => readTiff(new Uint8Array(4)), /too short/);
  const big = new Uint8Array(16);
  big[0] = 0x49;
  big[1] = 0x49;
  new DataView(big.buffer).setUint16(2, 43, true);
  assert.throws(() => readTiff(big), /BigTIFF/);
  const jpeg = makeTiff({ levels: [{ width: 4, height: 4, tileWidth: 4, tileHeight: 4, samples: 1, scale: 10, compression: 7, predictor: 1, tiles: [new Uint8Array(8)] }] });
  const directory = readTiff(jpeg).directories[0];
  assert.throws(() => decodeTile(directory, new Uint8Array(8)), /compression 7/);
});

test("an overview takes its ground from the full size picture, as a scene stores it", () => {
  // Only the first directory of a real scene carries the scale, the corner and the projection.
  const bytes = makeTiff({
    origin: { x: 799980, y: 2700000 },
    epsg: 32645,
    levels: [
      { width: 16, height: 16, tileWidth: 8, tileHeight: 8, samples: 1, scale: 10, compression: COMPRESSION.none, predictor: 1, tiles: [0, 1, 2, 3].map(() => tile(8, 8, 1, () => 5, 1, COMPRESSION.none)) },
      { width: 4, height: 4, tileWidth: 4, tileHeight: 4, samples: 1, scale: 0, compression: COMPRESSION.none, predictor: 1, tiles: [tile(4, 4, 1, () => 6, 1, COMPRESSION.none)] }
    ]
  });
  const tiff = readTiff(bytes);
  assert.equal(tiff.directories.length, 2);
  const overview = tiff.directories[1];
  assert.deepEqual(overview.scale, { x: 40, y: 40 }, "a quarter of the pixels is four times the ground each");
  assert.deepEqual(overview.origin, { x: 799980, y: 2700000 });
  assert.equal(overview.epsg, 32645);
  assert.deepEqual(groundOf(overview, 1, 1), { x: 800020, y: 2699960 });
  assert.equal(directoryForResolution(tiff, 40), 1);
});
