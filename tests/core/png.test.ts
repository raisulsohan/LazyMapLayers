import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { crc32, encodePng, flipAndFlatten, flipAndUnpremultiply } from "../../src/core/image/png.ts";

type Chunk = { type: string; data: Buffer; crc: number };

function readChunks(png: Uint8Array): Chunk[] {
  const buf = Buffer.from(png);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Chunk[] = [];
  let p = 8;
  while (p < buf.length) {
    const length = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + length);
    const crc = buf.readUInt32BE(p + 8 + length);
    assert.equal(crc, zlib.crc32(buf.subarray(p + 4, p + 8 + length)), `crc of ${type}`);
    chunks.push({ type, data, crc });
    p += 12 + length;
  }
  return chunks;
}

function decode(png: Uint8Array) {
  const chunks = readChunks(png);
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const channels = ihdr[9] === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.equal(filter, 2);
    for (let i = 0; i < stride; i++) {
      const up = y > 0 ? out[(y - 1) * stride + i] : 0;
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + up) & 0xff;
    }
  }
  return { width, height, channels, pixels: out, chunkTypes: chunks.map((c) => c.type) };
}

test("crc32 matches zlib", () => {
  const data = new TextEncoder().encode("LazyMapLayers renders every frame");
  assert.equal(crc32(data), zlib.crc32(Buffer.from(data)));
});

test("RGBA image survives encode and decode", () => {
  const width = 37;
  const height = 23;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 31 + (i >> 5)) & 0xff;
  const decoded = decode(encodePng(rgba, width, height));
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.equal(decoded.channels, 4);
  assert.deepEqual(decoded.chunkTypes, ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual(decoded.pixels, rgba);
});

test("opaque option drops alpha", () => {
  const rgba = Uint8Array.of(10, 20, 30, 255, 40, 50, 60, 255);
  const decoded = decode(encodePng(rgba, 2, 1, { opaque: true }));
  assert.equal(decoded.channels, 3);
  assert.deepEqual(Array.from(decoded.pixels), [10, 20, 30, 40, 50, 60]);
});

test("readPixels output is flipped and unpremultiplied", () => {
  // 1x2 image: bottom row (first in GL order) is half-transparent red, premultiplied.
  const gl = Uint8Array.of(128, 0, 0, 128, 0, 0, 255, 255);
  const straight = flipAndUnpremultiply(gl, 1, 2);
  assert.deepEqual(Array.from(straight), [0, 0, 255, 255, 255, 0, 0, 128]);
});

test("flattening keeps premultiplied colour over black, flips rows and drops alpha", () => {
  // Bottom row first, premultiplied: a half-covered pixel of (200, 100, 50) is (100, 50, 25, 128).
  const gl = Uint8Array.of(100, 50, 25, 128, 10, 20, 30, 255);
  const flat = flipAndFlatten(gl, 1, 2);
  assert.deepEqual([...flat], [10, 20, 30, 255, 100, 50, 25, 255]);
});
