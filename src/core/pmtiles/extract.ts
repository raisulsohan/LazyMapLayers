// Regional extract from a (possibly remote, very large) PMTiles v3 archive using only range reads.
//
// 1. plan: read the header and walk only the directories whose tile-id span can contain a wanted
//    tile, then list the byte ranges of the wanted tiles and the exact download size.
// 2. run: download merged byte ranges, slice out the tiles, and write a new local archive.
// Tile data is copied as stored (already compressed), so nothing is re-encoded.

import { bytesToHeader, tileIdToZxy, zxyToTileId, type Header } from "pmtiles";
import { tileRangeForBbox, tilesInRange, type Bbox } from "../tiles/tileMath.ts";
import { decompressInternal, deserializeDirectory, type DirectoryEntry } from "./directory.ts";
import { PmtilesWriter } from "./writer.ts";

/** Reads `length` bytes at `offset`. */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

export type ExtractPlan = {
  header: Header;
  metadata: Record<string, unknown>;
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  /** Wanted tiles that exist in the source, with their data location (relative to tile data). */
  tiles: { tileId: number; offset: number; length: number }[];
  /** Unique tile data bytes to download. */
  tileBytes: number;
  /** Bytes already read to build the plan (header and directories). */
  directoryBytes: number;
  directoriesRead: number;
};

export type ExtractProgress = { downloadedBytes: number; totalBytes: number; tiles: number };

const FIRST_FETCH = 16384;

export async function planExtract(read: RangeReader, bbox: Bbox, minZoom: number, maxZoom: number): Promise<ExtractPlan> {
  const head = await read(0, FIRST_FETCH);
  const header = bytesToHeader(head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength) as ArrayBuffer);
  if (header.specVersion !== 3) throw new Error(`PMTiles spec ${header.specVersion} is not supported`);
  let directoryBytes = head.length;
  let directoriesRead = 0;

  const lastZoom = Math.min(maxZoom, header.maxZoom);
  const firstZoom = Math.max(minZoom, header.minZoom);
  const wanted: number[] = [];
  for (let z = firstZoom; z <= lastZoom; z++) {
    for (const t of tilesInRange(tileRangeForBbox(bbox, z))) wanted.push(zxyToTileId(t.z, t.x, t.y));
  }
  wanted.sort((a, b) => a - b);

  /** Index of the first wanted id >= from. */
  const lowerBound = (from: number) => {
    let lo = 0;
    let hi = wanted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (wanted[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const anyWantedIn = (from: number, toExclusive: number) => {
    const i = lowerBound(from);
    return i < wanted.length && wanted[i] < toExclusive;
  };

  const readDirectory = async (offset: number, length: number): Promise<DirectoryEntry[]> => {
    const raw = offset + length <= head.length ? head.subarray(offset, offset + length) : await read(offset, length);
    if (offset + length > head.length) directoryBytes += length;
    directoriesRead++;
    return deserializeDirectory(decompressInternal(raw, header.internalCompression));
  };

  const found = new Map<number, { tileId: number; offset: number; length: number }>();
  const walk = async (entries: DirectoryEntry[], spanEnd: number, depth: number): Promise<void> => {
    if (depth > 4) throw new Error("PMTiles directory nesting too deep");
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const next = i + 1 < entries.length ? entries[i + 1].tileId : spanEnd;
      if (e.runLength === 0) {
        if (anyWantedIn(e.tileId, next)) {
          const leaf = await readDirectory(header.leafDirectoryOffset + e.offset, e.length);
          await walk(leaf, next, depth + 1);
        }
      } else {
        // Runs can cover millions of ids (open ocean); visit only the wanted ids inside the run.
        const runEnd = e.tileId + e.runLength;
        for (let w = lowerBound(e.tileId); w < wanted.length && wanted[w] < runEnd; w++) {
          found.set(wanted[w], { tileId: wanted[w], offset: e.offset, length: e.length });
        }
      }
    }
  };
  const root = await readDirectory(header.rootDirectoryOffset, header.rootDirectoryLength);
  await walk(root, Number.MAX_SAFE_INTEGER, 0);

  let metadata: Record<string, unknown> = {};
  if (header.jsonMetadataLength > 0) {
    const raw = await read(header.jsonMetadataOffset, header.jsonMetadataLength);
    directoryBytes += header.jsonMetadataLength;
    metadata = JSON.parse(new TextDecoder().decode(decompressInternal(raw, header.internalCompression)));
  }

  const tiles = Array.from(found.values()).sort((a, b) => a.tileId - b.tileId);
  const unique = new Map<number, number>();
  for (const t of tiles) unique.set(t.offset, t.length);
  let tileBytes = 0;
  for (const length of unique.values()) tileBytes += length;
  return { header, metadata, bbox, minZoom: firstZoom, maxZoom: lastZoom, tiles, tileBytes, directoryBytes, directoriesRead };
}

/** Merges nearby tile byte ranges so that few requests fetch everything. */
export function mergeRanges(tiles: { offset: number; length: number }[], maxGap: number): { offset: number; length: number }[] {
  const sorted = [...tiles].sort((a, b) => a.offset - b.offset);
  const merged: { offset: number; length: number }[] = [];
  for (const t of sorted) {
    const last = merged[merged.length - 1];
    if (last && t.offset <= last.offset + last.length + maxGap) {
      last.length = Math.max(last.length, t.offset + t.length - last.offset);
    } else {
      merged.push({ offset: t.offset, length: t.length });
    }
  }
  return merged;
}

export async function runExtract(
  plan: ExtractPlan,
  read: RangeReader,
  onProgress?: (p: ExtractProgress) => void,
  options: { maxGap?: number; maxRequestBytes?: number } = {}
): Promise<Uint8Array> {
  const ranges = mergeRanges(plan.tiles, options.maxGap ?? 64 * 1024);
  const maxRequest = options.maxRequestBytes ?? 32 * 1024 * 1024;
  const totalBytes = ranges.reduce((sum, r) => sum + r.length, 0);
  const writer = new PmtilesWriter();
  let downloadedBytes = 0;
  let tileIndex = 0;

  for (const range of ranges) {
    // Split very large merged ranges into several requests, then stitch them together.
    const parts: Uint8Array[] = [];
    for (let at = 0; at < range.length; at += maxRequest) {
      const length = Math.min(maxRequest, range.length - at);
      const bytes = await read(plan.header.tileDataOffset + range.offset + at, length);
      if (bytes.length !== length) throw new Error(`short read: wanted ${length} bytes, got ${bytes.length}`);
      parts.push(bytes);
      downloadedBytes += length;
      onProgress?.({ downloadedBytes, totalBytes, tiles: tileIndex });
    }
    const block = parts.length === 1 ? parts[0] : concat(parts, range.length);
    for (const t of plan.tiles) {
      if (t.offset >= range.offset && t.offset + t.length <= range.offset + range.length) {
        const start = t.offset - range.offset;
        const [z, x, y] = tileIdToZxy(t.tileId);
        writer.addTile(z, x, y, block.slice(start, start + t.length));
        tileIndex++;
      }
    }
    onProgress?.({ downloadedBytes, totalBytes, tiles: tileIndex });
  }

  const { bbox } = plan;
  return writer.build({
    tileType: plan.header.tileType,
    tileCompression: plan.header.tileCompression,
    metadata: {
      ...plan.metadata,
      lazymaplayers_extract: {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        minzoom: plan.minZoom,
        maxzoom: plan.maxZoom,
        extracted_at: new Date().toISOString()
      }
    },
    bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
    center: { lng: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2, zoom: plan.maxZoom }
  });
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}
