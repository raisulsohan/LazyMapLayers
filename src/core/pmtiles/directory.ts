// Reading PMTiles v3 directories (the inverse of writer.ts serializeDirectory).

import { gunzipSync } from "fflate";
import { PMTILES_COMPRESSION } from "./writer.ts";

export type DirectoryEntry = { tileId: number; offset: number; length: number; runLength: number };

/** Unsigned LEB128 varint up to 2^53, advancing `cursor.pos`. */
export function readVarint(bytes: Uint8Array, cursor: { pos: number }): number {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10; i++) {
    const byte = bytes[cursor.pos++];
    if (byte === undefined) throw new Error("unexpected end of directory");
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 0x80;
  }
  throw new Error("varint longer than 10 bytes");
}

export function deserializeDirectory(bytes: Uint8Array): DirectoryEntry[] {
  const cursor = { pos: 0 };
  const count = readVarint(bytes, cursor);
  const entries: DirectoryEntry[] = [];
  let lastId = 0;
  for (let i = 0; i < count; i++) {
    lastId += readVarint(bytes, cursor);
    entries.push({ tileId: lastId, offset: 0, length: 0, runLength: 1 });
  }
  for (const e of entries) e.runLength = readVarint(bytes, cursor);
  for (const e of entries) e.length = readVarint(bytes, cursor);
  for (let i = 0; i < count; i++) {
    const v = readVarint(bytes, cursor);
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
}

export function decompressInternal(bytes: Uint8Array, compression: number): Uint8Array {
  if (compression === PMTILES_COMPRESSION.none || compression === PMTILES_COMPRESSION.unknown) return bytes;
  if (compression === PMTILES_COMPRESSION.gzip) return gunzipSync(bytes);
  throw new Error(`unsupported PMTiles internal compression ${compression}`);
}
