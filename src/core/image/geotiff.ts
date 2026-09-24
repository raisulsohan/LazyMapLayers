// Just enough of a cloud-optimised GeoTIFF to read pixels out of a satellite scene without
// downloading it.
//
// A COG is an ordinary TIFF whose directories go from full size down through overviews, and whose
// pixels are stored in tiles rather than strips. That shape is what makes it readable over the web:
// read the header, work out which tiles cover the ground you want at the detail you want, and ask
// the server for those bytes alone.
//
// This reads the tags a satellite scene needs and decodes the tiles Sentinel-2 uses (deflate, with
// or without a horizontal predictor, and uncompressed). Anything else throws by name, so the panel
// can say what it met instead of drawing something wrong.

import { unzlibSync } from "fflate";

export const TIFF_TAGS = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  samplesPerPixel: 277,
  planarConfig: 284,
  predictor: 317,
  tileWidth: 322,
  tileHeight: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiePoint: 33922,
  geoKeys: 34735
} as const;

export const COMPRESSION = { none: 1, lzw: 5, jpeg: 7, deflate: 8, adobeDeflate: 32946 } as const;

export type TiffDirectory = {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tilesAcross: number;
  tilesDown: number;
  samples: number;
  bits: number;
  compression: number;
  predictor: number;
  /** Byte range of each tile, in the order the file lists them. */
  tiles: { offset: number; bytes: number }[];
  /** Metres per pixel across and down, when the file says. */
  scale: { x: number; y: number } | null;
  /** The ground position of the top left corner, when the file says. */
  origin: { x: number; y: number } | null;
  /** The projection the ground positions are in, from the GeoTIFF keys. */
  epsg: number | null;
};

export type Tiff = { little: boolean; directories: TiffDirectory[] };

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

/** How many bytes of the front of a file are worth asking for before anything is known about it. */
export const TIFF_HEADER_BYTES = 64 * 1024;

function values(view: DataView, little: boolean, type: number, count: number, at: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = at + i * TYPE_SIZE[type];
    if (type === 1 || type === 7) out.push(view.getUint8(p));
    else if (type === 2) out.push(view.getUint8(p));
    else if (type === 3) out.push(view.getUint16(p, little));
    else if (type === 4) out.push(view.getUint32(p, little));
    else if (type === 5) out.push(view.getUint32(p, little) / view.getUint32(p + 4, little));
    else if (type === 6) out.push(view.getInt8(p));
    else if (type === 8) out.push(view.getInt16(p, little));
    else if (type === 9) out.push(view.getInt32(p, little));
    else if (type === 10) out.push(view.getInt32(p, little) / view.getInt32(p + 4, little));
    else if (type === 11) out.push(view.getFloat32(p, little));
    else if (type === 12) out.push(view.getFloat64(p, little));
    else if (type === 16) out.push(Number(view.getBigUint64(p, little)));
    else if (type === 17) out.push(Number(view.getBigInt64(p, little)));
    else out.push(0);
  }
  return out;
}

/**
 * Reads the directories of a TIFF from the front of the file. `bytes` does not have to be the whole
 * file: a directory whose values sit past what was read is left out, and the reader says so by
 * returning fewer directories than the file has.
 */
export function readTiff(bytes: Uint8Array): Tiff {
  if (bytes.length < 8) throw new Error("the file is too short to be a TIFF");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint8(0) === 0x49 && view.getUint8(1) === 0x49;
  const big = view.getUint8(0) === 0x4d && view.getUint8(1) === 0x4d;
  if (!little && !big) throw new Error("this is not a TIFF (no byte order mark)");
  const magic = view.getUint16(2, little);
  if (magic === 43) throw new Error("this is a BigTIFF, which this reader does not open");
  if (magic !== 42) throw new Error(`this is not a TIFF (magic ${magic})`);

  const directories: TiffDirectory[] = [];
  let next = view.getUint32(4, little);
  const seen = new Set<number>();
  while (next > 0 && next + 2 <= bytes.length && !seen.has(next)) {
    seen.add(next);
    const count = view.getUint16(next, little);
    const end = next + 2 + count * 12;
    if (end + 4 > bytes.length) break;
    const tags = new Map<number, number[]>();
    let readable = true;
    for (let i = 0; i < count; i++) {
      const at = next + 2 + i * 12;
      const tag = view.getUint16(at, little);
      const type = view.getUint16(at + 2, little);
      const n = view.getUint32(at + 4, little);
      const size = (TYPE_SIZE[type] ?? 0) * n;
      if (!size) continue;
      let from = at + 8;
      if (size > 4) {
        from = view.getUint32(at + 8, little);
        if (from + size > bytes.length) {
          // The values sit past what was read; this directory cannot be trusted.
          if (tag === TIFF_TAGS.tileOffsets || tag === TIFF_TAGS.tileByteCounts) readable = false;
          continue;
        }
      }
      tags.set(tag, values(view, little, type, n, from));
    }
    next = view.getUint32(end, little);
    if (!readable) continue;
    const width = tags.get(TIFF_TAGS.width)?.[0] ?? 0;
    const height = tags.get(TIFF_TAGS.height)?.[0] ?? 0;
    const tileWidth = tags.get(TIFF_TAGS.tileWidth)?.[0] ?? 0;
    const tileHeight = tags.get(TIFF_TAGS.tileHeight)?.[0] ?? 0;
    const offsets = tags.get(TIFF_TAGS.tileOffsets) ?? [];
    const byteCounts = tags.get(TIFF_TAGS.tileByteCounts) ?? [];
    if (!width || !height || !tileWidth || !tileHeight || !offsets.length) continue;
    const scaleValues = tags.get(TIFF_TAGS.pixelScale);
    const tie = tags.get(TIFF_TAGS.tiePoint);
    const geoKeys = tags.get(TIFF_TAGS.geoKeys) ?? [];
    let epsg: number | null = null;
    // The geo keys are quadruples after a four number header; 3072 is the projected system's code.
    for (let i = 4; i + 3 < geoKeys.length; i += 4) {
      if (geoKeys[i] === 3072 && geoKeys[i + 1] === 0) epsg = geoKeys[i + 3];
    }
    directories.push({
      width,
      height,
      tileWidth,
      tileHeight,
      tilesAcross: Math.ceil(width / tileWidth),
      tilesDown: Math.ceil(height / tileHeight),
      samples: tags.get(TIFF_TAGS.samplesPerPixel)?.[0] ?? 1,
      bits: tags.get(TIFF_TAGS.bitsPerSample)?.[0] ?? 8,
      compression: tags.get(TIFF_TAGS.compression)?.[0] ?? 1,
      predictor: tags.get(TIFF_TAGS.predictor)?.[0] ?? 1,
      tiles: offsets.map((offset, i) => ({ offset, bytes: byteCounts[i] ?? 0 })),
      scale: scaleValues && scaleValues.length >= 2 && scaleValues[0] > 0 ? { x: scaleValues[0], y: scaleValues[1] } : null,
      origin: tie && tie.length >= 6 ? { x: tie[3], y: tie[4] } : null,
      epsg
    });
  }
  if (!directories.length) throw new Error("no readable image directory in the first bytes of the file");
  // Only the first directory carries the ground tags; an overview is the same ground at half the
  // pixels, again and again, so its own scale follows from how much smaller it is.
  const first = directories[0];
  for (const directory of directories) {
    if (!directory.scale && first.scale && first.width) {
      const step = first.width / directory.width;
      directory.scale = { x: first.scale.x * step, y: first.scale.y * step };
    }
    if (!directory.origin) directory.origin = first.origin;
    if (directory.epsg === null) directory.epsg = first.epsg;
  }
  return { little, directories };
}

/** Where a tile of a directory sits in the file. */
export function tileRange(directory: TiffDirectory, column: number, row: number): { offset: number; bytes: number } | null {
  if (column < 0 || row < 0 || column >= directory.tilesAcross || row >= directory.tilesDown) return null;
  const tile = directory.tiles[row * directory.tilesAcross + column];
  return tile && tile.bytes > 0 ? tile : null;
}

/** Undoes the horizontal difference a TIFF writer may have applied before compressing. */
function unpredict(pixels: Uint8Array, width: number, height: number, samples: number): void {
  for (let row = 0; row < height; row++) {
    const start = row * width * samples;
    for (let x = samples; x < width * samples; x++) pixels[start + x] = (pixels[start + x] + pixels[start + x - samples]) & 255;
  }
}

/**
 * The pixels of one tile: eight bits a sample, as the file stores them (so three bytes a pixel for a
 * true-colour scene, one for a classification band).
 */
export function decodeTile(directory: TiffDirectory, data: Uint8Array): Uint8Array {
  if (directory.bits !== 8) throw new Error(`this scene stores ${directory.bits} bits a sample; only eight are read`);
  let pixels: Uint8Array;
  if (directory.compression === COMPRESSION.none) pixels = data.slice();
  else if (directory.compression === COMPRESSION.deflate || directory.compression === COMPRESSION.adobeDeflate) pixels = unzlibSync(data);
  else throw new Error(`this scene is packed with compression ${directory.compression}, which this reader does not open`);
  const wanted = directory.tileWidth * directory.tileHeight * directory.samples;
  if (pixels.length < wanted) throw new Error(`a tile came back with ${pixels.length} bytes, not the ${wanted} it should hold`);
  if (directory.predictor === 2) unpredict(pixels, directory.tileWidth, directory.tileHeight, directory.samples);
  else if (directory.predictor !== 1) throw new Error(`this scene uses predictor ${directory.predictor}, which this reader does not undo`);
  return pixels;
}

/** The ground position of a pixel, in whatever grid the file's own projection uses. */
export function groundOf(directory: TiffDirectory, x: number, y: number): { x: number; y: number } | null {
  if (!directory.scale || !directory.origin) return null;
  return { x: directory.origin.x + x * directory.scale.x, y: directory.origin.y - y * directory.scale.y };
}

/** The pixel a ground position falls on, the other way round. */
export function pixelOf(directory: TiffDirectory, x: number, y: number): { x: number; y: number } | null {
  if (!directory.scale || !directory.origin) return null;
  return { x: (x - directory.origin.x) / directory.scale.x, y: (directory.origin.y - y) / directory.scale.y };
}

/** Every tile of a directory that covers a rectangle of ground, for fetching them in one go. */
export function tilesCovering(directory: TiffDirectory, box: { west: number; east: number; south: number; north: number }): { column: number; row: number }[] {
  const topLeft = pixelOf(directory, box.west, box.north);
  const bottomRight = pixelOf(directory, box.east, box.south);
  if (!topLeft || !bottomRight) return [];
  const firstColumn = Math.max(0, Math.floor(topLeft.x / directory.tileWidth));
  const lastColumn = Math.min(directory.tilesAcross - 1, Math.floor(bottomRight.x / directory.tileWidth));
  const firstRow = Math.max(0, Math.floor(topLeft.y / directory.tileHeight));
  const lastRow = Math.min(directory.tilesDown - 1, Math.floor(bottomRight.y / directory.tileHeight));
  const out: { column: number; row: number }[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) out.push({ column, row });
  }
  return out;
}

/**
 * The directory whose pixels are closest to (and no coarser than) the ground resolution asked for.
 * A COG keeps the full size first and halves it down the file, so this is what makes a small picture
 * of a big scene cheap.
 */
export function directoryForResolution(tiff: Tiff, metresPerPixel: number): number {
  let best = 0;
  for (let i = 0; i < tiff.directories.length; i++) {
    const scale = tiff.directories[i].scale?.x;
    if (!scale) continue;
    if (scale <= metresPerPixel * 1.35) best = i;
    else break;
  }
  return best;
}
