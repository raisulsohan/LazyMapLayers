// Minimal PNG encoder for rendered frames: 8-bit RGB or RGBA, one IDAT chunk.
// Each scanline uses the "Up" filter, which compresses map imagery well at low zlib levels.

import { zlibSync } from "fflate";

export type PngOptions = {
  /** zlib level 0-9. Low levels are much faster and still compress map frames well. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Drop the alpha channel (for opaque base passes). */
  opaque?: boolean;
};

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length, seed = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = ~seed;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

/** Encodes straight (non-premultiplied) RGBA pixels, top row first. */
export function encodePng(rgba: Uint8Array, width: number, height: number, options: PngOptions = {}): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`expected ${width * height * 4} bytes, got ${rgba.length}`);
  const channels = options.opaque ? 3 : 4;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  let src = 0;
  let dst = 0;
  const previousRow = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0, r = 0; x < width; x++, src += 4) {
      row[r++] = rgba[src];
      row[r++] = rgba[src + 1];
      row[r++] = rgba[src + 2];
      if (channels === 4) row[r++] = rgba[src + 3];
    }
    raw[dst++] = 2; // filter: Up
    for (let i = 0; i < stride; i++) raw[dst++] = (row[i] - previousRow[i]) & 0xff;
    previousRow.set(row);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type RGBA or RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlibSync(raw, { level: options.level ?? 3 });
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

/**
 * Converts WebGL readPixels output (bottom row first, premultiplied alpha) into straight RGBA with
 * the top row first, in place into a new buffer.
 */
export function flipAndUnpremultiply(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * rowBytes;
    const to = y * rowBytes;
    for (let i = 0; i < rowBytes; i += 4) {
      const a = pixels[from + i + 3];
      if (a === 255 || a === 0) {
        out[to + i] = pixels[from + i];
        out[to + i + 1] = pixels[from + i + 1];
        out[to + i + 2] = pixels[from + i + 2];
      } else {
        out[to + i] = Math.min(255, Math.round((pixels[from + i] * 255) / a));
        out[to + i + 1] = Math.min(255, Math.round((pixels[from + i + 1] * 255) / a));
        out[to + i + 2] = Math.min(255, Math.round((pixels[from + i + 2] * 255) / a));
      }
      out[to + i + 3] = a;
    }
  }
  return out;
}

/**
 * Flattens WebGL readPixels output (bottom row first, premultiplied) over black into opaque RGBA with
 * the top row first. For passes that are opaque by design, where a few edge pixels may still carry
 * alpha just below 1.
 */
export function flipAndFlatten(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * rowBytes;
    const to = y * rowBytes;
    out.set(pixels.subarray(from, from + rowBytes), to);
    for (let i = to + 3; i < to + rowBytes; i += 4) out[i] = 255;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
