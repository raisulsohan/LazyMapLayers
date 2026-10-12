// A small SQLite writer: tables only, no indexes, every row on its page (no overflow). The in-AE test
// OI1 makes its MBTiles file with it, and the unit tests hold it and the reader (sqlite.ts) to SQLite
// itself (D103). It is not a database engine: it writes a finished file in one go.

import type { SqliteValue } from "./sqlite.ts";

export type WriteTable = { name: string; sql: string; rows: SqliteValue[][] };

const MAGIC = "SQLite format 3\u0000";

function varint(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 2 ** 53) throw new Error(`varint out of range: ${value}`);
  if (value < 0x80) return [value];
  const groups: number[] = [];
  let v = value;
  while (v > 0) {
    groups.unshift(v % 128);
    v = Math.floor(v / 128);
  }
  if (groups.length > 8) throw new Error("varint too large");
  return groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g));
}

/** A value's serial type and bytes. */
function serial(value: SqliteValue): { type: number; bytes: Uint8Array } {
  if (value === null) return { type: 0, bytes: new Uint8Array(0) };
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return { type: 13 + 2 * bytes.length, bytes };
  }
  if (value instanceof Uint8Array) return { type: 12 + 2 * value.length, bytes: value };
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    if (value === 0) return { type: 8, bytes: new Uint8Array(0) };
    if (value === 1) return { type: 9, bytes: new Uint8Array(0) };
    const sizes: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 6], [6, 8]];
    for (const [type, size] of sizes) {
      const limit = 2 ** (8 * size - 1);
      if (value >= -limit && value < limit) {
        const bytes = new Uint8Array(size);
        let v = value < 0 ? 2 ** (8 * size) + value : value;
        for (let i = size - 1; i >= 0; i--) {
          bytes[i] = v % 256;
          v = Math.floor(v / 256);
        }
        return { type, bytes };
      }
    }
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value as number);
  return { type: 7, bytes };
}

/** A record: its header (size, serial types) and its values. */
export function encodeRecord(values: SqliteValue[]): Uint8Array {
  const parts = values.map(serial);
  const types = parts.flatMap((p) => varint(p.type));
  let headerSize = types.length + 1;
  while (varint(headerSize).length + types.length !== headerSize) headerSize = varint(headerSize).length + types.length;
  const out = new Uint8Array(headerSize + parts.reduce((sum, p) => sum + p.bytes.length, 0));
  out.set([...varint(headerSize), ...types]);
  let at = headerSize;
  for (const p of parts) {
    out.set(p.bytes, at);
    at += p.bytes.length;
  }
  return out;
}

type Page = { number: number; bytes: Uint8Array };

/** Lays cells on B-tree pages of one kind; returns the pages and, per page, its last cell's key. */
function layPages(cells: { bytes: number[] | Uint8Array; key: number }[], kind: "leaf" | "interior", rights: number[], pageSize: number, firstNumber: number, headerAt = 0): { pages: Page[]; keys: number[] } {
  const pages: Page[] = [];
  const keys: number[] = [];
  const headerSize = kind === "leaf" ? 8 : 12;
  let start = 0;
  while (start < cells.length || (start === 0 && cells.length === 0)) {
    // As many cells as fit; an interior page keeps its last child as the right-most pointer.
    let used = headerAt + headerSize;
    let end = start;
    while (end < cells.length && used + 2 + cells[end].bytes.length <= pageSize) {
      used += 2 + cells[end].bytes.length;
      end++;
    }
    if (end === start && cells.length) throw new Error("a row does not fit on one page (the writer has no overflow pages)");
    // An interior page left with a single child would hold no cell: give it two.
    if (kind === "interior" && cells.length - end === 1 && end - start > 2) end--;
    const bytes = new Uint8Array(pageSize);
    const take = kind === "interior" ? cells.slice(start, end - 1) : cells.slice(start, end);
    const right = kind === "interior" ? rights[end - 1] : 0;
    bytes[headerAt] = kind === "leaf" ? 0x0d : 0x05;
    bytes[headerAt + 3] = take.length >> 8;
    bytes[headerAt + 4] = take.length & 0xff;
    let content = pageSize;
    take.forEach((cell, i) => {
      content -= cell.bytes.length;
      bytes.set(cell.bytes, content);
      const pointer = headerAt + headerSize + 2 * i;
      bytes[pointer] = content >> 8;
      bytes[pointer + 1] = content & 0xff;
    });
    const area = content === 65536 ? 0 : content;
    bytes[headerAt + 5] = area >> 8;
    bytes[headerAt + 6] = area & 0xff;
    if (kind === "interior") new DataView(bytes.buffer).setUint32(headerAt + 8, right);
    pages.push({ number: firstNumber + pages.length, bytes });
    keys.push(cells.length ? cells[end - 1].key : 0);
    start = end;
    if (!cells.length) break;
  }
  return { pages, keys };
}

/** A table's B-tree on pages from `firstNumber`; returns its pages and its root page's number. */
function tablePages(rows: SqliteValue[][], pageSize: number, firstNumber: number): { pages: Page[]; root: number } {
  const leafCells = rows.map((values, i) => {
    const payload = encodeRecord(values);
    if (payload.length > pageSize - 35) throw new Error(`row ${i + 1} is too long for one page`);
    return { bytes: [...varint(payload.length), ...varint(i + 1), ...payload], key: i + 1 };
  });
  let level = layPages(leafCells, "leaf", [], pageSize, firstNumber);
  const pages = [...level.pages];
  while (level.pages.length > 1) {
    const children = level.pages.map((page) => page.number);
    const cells = children.map((child, i) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, child);
      return { bytes: [...bytes, ...varint(level.keys[i])], key: level.keys[i] };
    });
    level = layPages(cells, "interior", children, pageSize, firstNumber + pages.length);
    pages.push(...level.pages);
  }
  return { pages, root: pages[pages.length - 1].number };
}

/** A finished SQLite file holding these tables. */
export function writeSqlite(tables: WriteTable[], options: { pageSize?: number; applicationId?: number } = {}): Uint8Array {
  const pageSize = options.pageSize ?? 4096;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) throw new Error(`page size ${pageSize}`);
  const pages: Page[] = [];
  const schema: SqliteValue[][] = [];
  for (const table of tables) {
    const built = tablePages(table.rows, pageSize, 2 + pages.length);
    pages.push(...built.pages);
    schema.push(["table", table.name, table.name, built.root, table.sql]);
  }
  const schemaCells = schema.map((values, i) => {
    const payload = encodeRecord(values);
    return { bytes: [...varint(payload.length), ...varint(i + 1), ...payload], key: i + 1 };
  });
  const first = layPages(schemaCells, "leaf", [], pageSize, 1, 100);
  if (first.pages.length > 1) throw new Error("the schema does not fit on the first page");
  const head = first.pages[0].bytes;
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint16(16, pageSize === 65536 ? 1 : pageSize);
  head[18] = 1;
  head[19] = 1;
  head[21] = 64;
  head[22] = 32;
  head[23] = 32;
  const total = 1 + pages.length;
  view.setUint32(24, 1);
  view.setUint32(28, total);
  view.setUint32(40, 1);
  view.setUint32(44, 4);
  view.setUint32(56, 1);
  view.setUint32(68, options.applicationId ?? 0);
  view.setUint32(92, 1);
  view.setUint32(96, 3045000);
  const out = new Uint8Array(total * pageSize);
  out.set(head, 0);
  for (const page of pages) out.set(page.bytes, (page.number - 1) * pageSize);
  return out;
}
