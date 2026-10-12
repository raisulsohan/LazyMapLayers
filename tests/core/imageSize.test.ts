import { test } from "node:test";
import assert from "node:assert/strict";
import { imageSize, tileSizeOf } from "../../src/core/image/imageSize.ts";
import { encodePng } from "../../src/core/image/png.ts";

test("PNG: the size from its header", () => {
  const png = encodePng(new Uint8Array(512 * 256 * 4), 512, 256, { level: 1, opaque: false });
  assert.deepEqual(imageSize(png), { width: 512, height: 256, format: "png" });
  assert.equal(tileSizeOf(png), 512);
  assert.equal(tileSizeOf(encodePng(new Uint8Array(256 * 256 * 4), 256, 256, { level: 1, opaque: true })), 256);
});

test("JPEG: the size from the start of frame, past other segments and fill bytes", () => {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sof2 = [0xff, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0x00, 0x01, 0x00, 0x03, ...Array(9).fill(0)];
  assert.deepEqual(imageSize(Uint8Array.from([0xff, 0xd8, ...app0, ...dqt, ...sof2])), { width: 256, height: 512, format: "jpg" });
  const huffmanFirst = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x02, 0x00, 0x03, ...Array(9).fill(0)];
  assert.deepEqual(imageSize(Uint8Array.from([0xff, 0xd8, ...huffmanFirst, ...sof0])), { width: 512, height: 512, format: "jpg" });
});

test("WebP (lossy, lossless, extended) and GIF", () => {
  const riff = (chunk: string, data: number[]) => Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)), [...chunk].map((c) => c.charCodeAt(0)), [0, 0, 0, 0], data, Array(16).fill(0)));
  // Lossy: a frame tag, the start code, then 14-bit width and height.
  assert.deepEqual(imageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x02, 0x00, 0x01])), { width: 512, height: 256, format: "webp" });
  // Lossless: the signature, then width - 1 and height - 1 in 14 bits each (511 and 255 here).
  const w = 511;
  const h = 255;
  const bits = w | (h << 14);
  assert.deepEqual(imageSize(riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff])), { width: 512, height: 256, format: "webp" });
  // Extended: flags, three reserved bytes, then the canvas size less one in 24 bits each.
  assert.deepEqual(imageSize(riff("VP8X", [0, 0, 0, 0, 0xff, 0x00, 0x00, 0xff, 0x01, 0x00])), { width: 256, height: 512, format: "webp" });
  assert.deepEqual(imageSize(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x01, 0x00, 0x02])), { width: 256, height: 512, format: "gif" });
  assert.equal(imageSize(new TextEncoder().encode("not a picture at all, just text")), null);
  assert.equal(tileSizeOf(null), 256);
});
