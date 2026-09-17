// PMTiles v3 archive writer (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
//
// Layout: 127-byte header | root directory | JSON metadata | leaf directories | tile data.
// Tiles are stored in tile-id (Hilbert) order, identical tile contents are stored once, and runs of
// consecutive tile ids with the same content collapse into one directory entry. Directories and
// metadata are written uncompressed (internal compression "none"), which every reader supports.

import { zxyToTileId } from "pmtiles";

export const PMTILES_COMPRESSION = { unknown: 0, none: 1, gzip: 2, brotli: 3, zstd: 4 } as const;
export const PMTILES_TILE_TYPE = { unknown: 0, mvt: 1, png: 2, jpeg: 3, webp: 4, avif: 5 } as const;

export type PmtilesArchiveOptions = {
  tileType: number;
  tileCompression: number;
  metadata?: Record<string, unknown>;
  /** [west, south, east, north] in degrees. Defaults to the whole world. */
  bounds?: [number, number, number, number];
  center?: { lng: number; lat: number; zoom: number };
  /** Maximum entries in the root directory before leaf directories are used. */
  maxRootEntries?: number;
  /** Entries per leaf directory. */
  leafSize?: number;
};

type Entry = { tileId: number; offset: number; length: number; runLength: number };

const HEADER_BYTES = 127;
/** Readers load header and root directory with a single 16384-byte request. */
const ROOT_BYTE_BUDGET = 16384;

export class PmtilesWriter {
  private readonly tiles = new Map<number, Uint8Array>();
  private minZoom = Infinity;
  private maxZoom = -Infinity;

  addTile(z: number, x: number, y: number, data: Uint8Array): void {
    this.tiles.set(zxyToTileId(z, x, y), data);
    this.minZoom = Math.min(this.minZoom, z);
    this.maxZoom = Math.max(this.maxZoom, z);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  build(options: PmtilesArchiveOptions): Uint8Array {
    const ids = Array.from(this.tiles.keys()).sort((a, b) => a - b);

    // Tile data section with de-duplication of identical contents.
    const contentIndex = new Map<string, { offset: number; data: Uint8Array }[]>();
    const chunks: Uint8Array[] = [];
    const entries: Entry[] = [];
    let dataLength = 0;
    let contents = 0;
    for (const id of ids) {
      const data = this.tiles.get(id) as Uint8Array;
      const key = contentKey(data);
      const bucket = contentIndex.get(key) ?? [];
      let offset = -1;
      for (const candidate of bucket) {
        if (bytesEqual(candidate.data, data)) {
          offset = candidate.offset;
          break;
        }
      }
      if (offset < 0) {
        offset = dataLength;
        bucket.push({ offset, data });
        contentIndex.set(key, bucket);
        chunks.push(data);
        dataLength += data.length;
        contents++;
      }
      const last = entries[entries.length - 1];
      if (last && last.offset === offset && last.length === data.length && last.tileId + last.runLength === id) {
        last.runLength++;
      } else {
        entries.push({ tileId: id, offset, length: data.length, runLength: 1 });
      }
    }

    // Readers fetch the first 16384 bytes and expect header + root directory inside them.
    const maxRootEntries = options.maxRootEntries ?? 4096;
    let rootBytes: Uint8Array = serializeDirectory(entries);
    let leafBytes: Uint8Array = new Uint8Array(0);
    if (entries.length > maxRootEntries || HEADER_BYTES + rootBytes.length > ROOT_BYTE_BUDGET) {
      let leafSize = options.leafSize ?? 4096;
      for (;;) {
        const leafChunks: Uint8Array[] = [];
        const rootEntries: Entry[] = [];
        let leafOffset = 0;
        for (let i = 0; i < entries.length; i += leafSize) {
          const leaf = serializeDirectory(entries.slice(i, i + leafSize));
          rootEntries.push({ tileId: entries[i].tileId, offset: leafOffset, length: leaf.length, runLength: 0 });
          leafChunks.push(leaf);
          leafOffset += leaf.length;
        }
        rootBytes = serializeDirectory(rootEntries);
        leafBytes = concat(leafChunks, leafOffset);
        if (HEADER_BYTES + rootBytes.length <= ROOT_BYTE_BUDGET) break;
        leafSize *= 2;
      }
    }

    const metadataBytes = new TextEncoder().encode(JSON.stringify(options.metadata ?? {}));
    const rootOffset = HEADER_BYTES;
    const metadataOffset = rootOffset + rootBytes.length;
    const leafOffset = metadataOffset + metadataBytes.length;
    const tileDataOffset = leafOffset + leafBytes.length;
    const total = tileDataOffset + dataLength;

    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    out.set(new TextEncoder().encode("PMTiles"), 0);
    out[7] = 3;
    setUint64(view, 8, rootOffset);
    setUint64(view, 16, rootBytes.length);
    setUint64(view, 24, metadataOffset);
    setUint64(view, 32, metadataBytes.length);
    setUint64(view, 40, leafOffset);
    setUint64(view, 48, leafBytes.length);
    setUint64(view, 56, tileDataOffset);
    setUint64(view, 64, dataLength);
    setUint64(view, 72, entries.reduce((sum, e) => sum + e.runLength, 0));
    setUint64(view, 80, entries.length);
    setUint64(view, 88, contents);
    out[96] = 1; // clustered: tile data is in tile-id order
    out[97] = PMTILES_COMPRESSION.none;
    out[98] = options.tileCompression;
    out[99] = options.tileType;
    const hasTiles = ids.length > 0;
    out[100] = hasTiles ? this.minZoom : 0;
    out[101] = hasTiles ? this.maxZoom : 0;
    const [west, south, east, north] = options.bounds ?? [-180, -85.051129, 180, 85.051129];
    view.setInt32(102, Math.round(west * 1e7), true);
    view.setInt32(106, Math.round(south * 1e7), true);
    view.setInt32(110, Math.round(east * 1e7), true);
    view.setInt32(114, Math.round(north * 1e7), true);
    const center = options.center ?? { lng: (west + east) / 2, lat: (south + north) / 2, zoom: hasTiles ? this.minZoom : 0 };
    out[118] = Math.max(0, Math.min(255, Math.round(center.zoom)));
    view.setInt32(119, Math.round(center.lng * 1e7), true);
    view.setInt32(123, Math.round(center.lat * 1e7), true);

    out.set(rootBytes, rootOffset);
    out.set(metadataBytes, metadataOffset);
    out.set(leafBytes, leafOffset);
    let cursor = tileDataOffset;
    for (const chunk of chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}

/** Directory encoding: count, delta tile ids, run lengths, lengths, offsets (0 = contiguous). */
export function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const bytes: number[] = [];
  writeVarint(bytes, entries.length);
  let lastId = 0;
  for (const e of entries) {
    writeVarint(bytes, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(bytes, e.runLength);
  for (const e of entries) writeVarint(bytes, e.length);
  for (let i = 0; i < entries.length; i++) {
    const previous = entries[i - 1];
    if (i > 0 && entries[i].offset === previous.offset + previous.length) {
      writeVarint(bytes, 0);
    } else {
      writeVarint(bytes, entries[i].offset + 1);
    }
  }
  return Uint8Array.from(bytes);
}

/** Unsigned LEB128 varint for integers up to 2^53. */
export function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function setUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value % 0x100000000, true);
  view.setUint32(offset + 4, Math.floor(value / 0x100000000), true);
}

function contentKey(data: Uint8Array): string {
  // FNV-1a over the bytes plus the length; collisions are resolved by a byte compare.
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${data.length}:${hash >>> 0}`;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
