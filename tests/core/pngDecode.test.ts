import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { crc32, encodePng } from "../../src/core/image/png.ts";
import { decodePng } from "../../src/core/image/pngDecode.ts";

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

/** Builds a PNG whose rows cycle through all five filter types. */
function pngWithAllFilters(width: number, height: number, channels: 3 | 4, pixels: Uint8Array): Uint8Array {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? pixels[i - channels] : 0;
      const b = y > 0 ? pixels[i - stride] : 0;
      const c = x >= channels && y > 0 ? pixels[i - stride - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + x] = (pixels[i] - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", new Uint8Array(0))
  ]);
}

test("decodes our own encoder's output", () => {
  const rgba = new Uint8Array(31 * 17 * 4).map((_, i) => (i * 7 + (i >> 3)) & 0xff);
  const decoded = decodePng(encodePng(rgba, 31, 17));
  assert.equal(decoded.width, 31);
  assert.deepEqual(decoded.rgba, rgba);
});

test("decodes all five filter types for RGBA and RGB", () => {
  for (const channels of [3, 4] as const) {
    const width = 23;
    const height = 15;
    const pixels = new Uint8Array(width * height * channels).map((_, i) => (i * 13 + ((i * i) >> 5)) & 0xff);
    const decoded = decodePng(pngWithAllFilters(width, height, channels, pixels));
    for (let p = 0; p < width * height; p++) {
      for (let c = 0; c < channels; c++) assert.equal(decoded.rgba[p * 4 + c], pixels[p * channels + c]);
      if (channels === 3) assert.equal(decoded.rgba[p * 4 + 3], 255);
    }
  }
});
