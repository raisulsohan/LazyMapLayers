// A small read-only reader of the SQLite file format, enough to find rows in an MBTiles file (D103):
// the header, pages, table and index B-trees, overflow pages, records and the schema. It reads
// through a function that returns bytes at an offset, so only the pages a lookup touches leave the
// disk. It never writes, never takes a lock and knows nothing of SQL beyond the schema's CREATE
// statements. The format is documented at https://www.sqlite.org/fileformat2.html.

/** Reads `length` bytes at `offset` (fewer only at the end of the file). */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

export type SqliteValue = null | number | string | Uint8Array;

export type SqliteHeader = {
  pageSize: number;
  /** The bytes of a page that hold data (the page less the space reserved at its end). */
  usable: number;
  encoding: "utf-8" | "utf-16le" | "utf-16be";
  /** Written in WAL mode: the newest pages may still be in the -wal file beside it. */
  wal: boolean;
};

export type SchemaEntry = { type: string; name: string; table: string; rootPage: number; sql: string | null };

/** A table's columns as its CREATE TABLE names them. */
export type TableShape = {
  columns: string[];
  /** The column that is the rowid under another name (INTEGER PRIMARY KEY), or -1. */
  rowidColumn: number;
  withoutRowid: boolean;
  /** UNIQUE and PRIMARY KEY constraints in the order they appear (SQLite's automatic indexes follow it). */
  uniques: string[][];
};

/** An index's columns, in its order; `usable` is false for a partial or descending index. */
export type IndexShape = { name: string; table: string; columns: string[]; usable: boolean; rootPage: number };

export type Row = { rowid: number; values: SqliteValue[] };

const MAGIC = "SQLite format 3\u0000";
const TABLE_LEAF = 0x0d;
const TABLE_INTERIOR = 0x05;
const INDEX_LEAF = 0x0a;
const INDEX_INTERIOR = 0x02;

export class SqliteError extends Error {}

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

/** A variable-length integer: its value and how many bytes it took. */
export function readVarint(b: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const byte = b[at + i];
    if (byte === undefined) throw new SqliteError("a number runs past the end of its page");
    value = value * 128 + (byte & 0x7f);
    if (byte < 0x80) return [value, i + 1];
  }
  return [value * 256 + b[at + 8], 9];
}

/** How many bytes a value of this serial type takes in a record. */
export function serialSize(type: number): number {
  if (type <= 4) return [0, 1, 2, 3, 4][type];
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  if (type < 12) return 0;
  return type % 2 === 0 ? (type - 12) / 2 : (type - 13) / 2;
}

/** The record's header: where its values start and each value's serial type. */
function recordHeader(b: Uint8Array): { start: number; types: number[] } {
  const [size, used] = readVarint(b, 0);
  if (size > b.length) throw new SqliteError("a record's header runs past its payload");
  const types: number[] = [];
  let at = used;
  while (at < size) {
    const [type, n] = readVarint(b, at);
    types.push(type);
    at += n;
  }
  return { start: size, types };
}

/** Where the first `count` values of a record end (to tell whether the part on the page is enough). */
export function recordEnd(b: Uint8Array, count: number): number {
  const { start, types } = recordHeader(b);
  let end = start;
  for (let i = 0; i < Math.min(count, types.length); i++) end += serialSize(types[i]);
  return end;
}

/** The values of a record (at most `count` of them). */
export function decodeRecord(b: Uint8Array, encoding: SqliteHeader["encoding"], count = Infinity): SqliteValue[] {
  const { start, types } = recordHeader(b);
  const values: SqliteValue[] = [];
  let at = start;
  const decoder = new TextDecoder(encoding);
  for (const type of types) {
    if (values.length >= count) break;
    const size = serialSize(type);
    if (at + size > b.length) throw new SqliteError("a record's value runs past its payload");
    if (type === 0) values.push(null);
    else if (type === 8) values.push(0);
    else if (type === 9) values.push(1);
    else if (type <= 6) {
      let v = b[at] < 128 ? b[at] : b[at] - 256;
      for (let i = 1; i < size; i++) v = v * 256 + b[at + i];
      values.push(v);
    } else if (type === 7) values.push(new DataView(b.buffer, b.byteOffset + at, 8).getFloat64(0));
    else if (type < 12) throw new SqliteError(`a record holds the reserved serial type ${type}`);
    else if (type % 2 === 0) values.push(b.slice(at, at + size));
    else values.push(decoder.decode(b.subarray(at, at + size)));
    at += size;
  }
  return values;
}

/** SQLite's order of values: NULL, then numbers, then text (by its bytes), then blobs. */
export function compareValues(a: SqliteValue, b: SqliteValue): number {
  const rank = (v: SqliteValue) => (v === null ? 0 : typeof v === "number" ? 1 : typeof v === "string" ? 2 : 3);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a === null || b === null) return 0;
  if (typeof a === "number") return a < (b as number) ? -1 : a > (b as number) ? 1 : 0;
  const ba = typeof a === "string" ? new TextEncoder().encode(a) : a;
  const bb = typeof b === "string" ? new TextEncoder().encode(b) : (b as Uint8Array);
  for (let i = 0; i < Math.min(ba.length, bb.length); i++) if (ba[i] !== bb[i]) return ba[i] - bb[i];
  return ba.length - bb.length;
}

/** How much of a payload of `size` bytes is on the page; the rest is in overflow pages. */
export function localPayloadSize(size: number, usable: number, kind: "table" | "index"): number {
  const most = kind === "table" ? usable - 35 : Math.floor(((usable - 12) * 64) / 255) - 23;
  if (size <= most) return size;
  const least = Math.floor(((usable - 12) * 32) / 255) - 23;
  const k = least + ((size - least) % (usable - 4));
  return k <= most ? k : least;
}

const unquote = (name: string) => {
  const text = name.trim();
  const first = text[0];
  if ((first === '"' || first === "`" || first === "'") && text.endsWith(first)) return text.slice(1, -1).split(first + first).join(first);
  if (first === "[" && text.endsWith("]")) return text.slice(1, -1);
  return text;
};

/** The text between the first "(" and its closing ")", split at top-level commas; and what follows. */
function parenthesised(sql: string): { parts: string[]; after: string } | null {
  const open = sql.indexOf("(");
  if (open < 0) return null;
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let from = open + 1;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "[") quote = "]";
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        parts.push(sql.slice(from, i));
        return { parts: parts.map((p) => p.trim()), after: sql.slice(i + 1) };
      }
    } else if (c === "," && depth === 1) {
      parts.push(sql.slice(from, i));
      from = i + 1;
    }
  }
  return null;
}

/** The first word of a definition (a column's name), quoted or not. */
function firstName(text: string): [string, string] {
  const match = /^\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|'(?:[^']|'')*'|[^\s(]+)/.exec(text);
  if (!match) return ["", text];
  return [unquote(match[1]), text.slice(match[0].length)];
}

const columnList = (text: string) => (parenthesised(text)?.parts ?? []).map((part) => firstName(part)[0].toLowerCase());

/** A table's shape from its CREATE TABLE statement. */
export function parseCreateTable(sql: string): TableShape {
  const body = parenthesised(sql);
  if (!body) throw new SqliteError(`cannot read the table definition: ${sql.slice(0, 80)}`);
  const columns: string[] = [];
  const uniques: string[][] = [];
  let rowidColumn = -1;
  for (const part of body.parts) {
    if (/^(constraint\s+\S+\s+)?(primary\s+key|unique)\b/i.test(part)) {
      uniques.push(columnList(part));
      continue;
    }
    if (/^(constraint|check|foreign)\b/i.test(part)) continue;
    const [name, rest] = firstName(part);
    const column = name.toLowerCase();
    if (/^\s*integer\s+primary\s+key\b(?!\s+desc)/i.test(rest)) rowidColumn = columns.length;
    else if (/\b(primary\s+key|unique)\b/i.test(rest)) uniques.push([column]);
    columns.push(column);
  }
  return { columns, rowidColumn, withoutRowid: /\bwithout\s+rowid\b/i.test(body.after), uniques };
}

/** An index's columns from its CREATE INDEX statement. */
export function parseCreateIndex(sql: string): { columns: string[]; usable: boolean } {
  const on = /\bon\s+("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[^\s(]+)\s*\(/i.exec(sql);
  const body = on ? parenthesised(sql.slice(on.index)) : null;
  if (!body) return { columns: [], usable: false };
  const descending = body.parts.some((part) => /\bdesc\s*$/i.test(part));
  const collated = body.parts.some((part) => /\bcollate\s+(?!binary\b)/i.test(part));
  return { columns: body.parts.map((part) => firstName(part)[0].toLowerCase()), usable: !descending && !collated && !/\bwhere\b/i.test(body.after) };
}

type Cell = { local: Uint8Array; size: number; overflow: number; rowid: number; child: number };

/** A read-only SQLite database. */
export class SqliteReader {
  readonly header: SqliteHeader;
  schema: SchemaEntry[] = [];
  private readonly read: ReadAt;
  private readonly cache = new Map<number, Uint8Array>();
  private readonly cacheSize: number;

  private constructor(read: ReadAt, header: SqliteHeader, cacheSize: number) {
    this.read = read;
    this.header = header;
    this.cacheSize = cacheSize;
  }

  /** Opens a database: reads its header and its schema. */
  static async open(read: ReadAt, options: { cachePages?: number } = {}): Promise<SqliteReader> {
    const head = await read(0, 100);
    if (head.length < 100 || new TextDecoder("latin1").decode(head.subarray(0, 16)) !== MAGIC) throw new SqliteError("not an SQLite database");
    const rawSize = u16(head, 16);
    const pageSize = rawSize === 1 ? 65536 : rawSize;
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) throw new SqliteError(`a page size of ${pageSize} bytes is not one SQLite writes`);
    const usable = pageSize - head[20];
    if (usable < 480) throw new SqliteError("too much space reserved on each page");
    const text = u32(head, 56);
    const encoding = text === 2 ? "utf-16le" : text === 3 ? "utf-16be" : "utf-8";
    const reader = new SqliteReader(read, { pageSize, usable, encoding, wal: head[18] === 2 || head[19] === 2 }, options.cachePages ?? 512);
    reader.schema = [];
    for await (const row of reader.rows(1)) {
      const [type, name, table, rootPage, sql] = row.values;
      reader.schema.push({ type: String(type ?? ""), name: String(name ?? ""), table: String(table ?? ""), rootPage: typeof rootPage === "number" ? rootPage : 0, sql: typeof sql === "string" ? sql : null });
    }
    return reader;
  }

  /** A page's bytes (pages count from 1). */
  async page(number: number): Promise<Uint8Array> {
    const cached = this.cache.get(number);
    if (cached) {
      this.cache.delete(number);
      this.cache.set(number, cached);
      return cached;
    }
    if (!(number >= 1)) throw new SqliteError(`page ${number} does not exist`);
    const bytes = await this.read((number - 1) * this.header.pageSize, this.header.pageSize);
    if (bytes.length < this.header.pageSize) throw new SqliteError(`page ${number} is past the end of the file`);
    this.cache.set(number, bytes);
    if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value as number);
    return bytes;
  }

  /** The schema entry of a table, view or index by name (any case). */
  entry(name: string, type?: string): SchemaEntry | null {
    const wanted = name.toLowerCase();
    return this.schema.find((e) => e.name.toLowerCase() === wanted && (!type || e.type === type)) ?? null;
  }

  table(name: string): (TableShape & { rootPage: number }) | null {
    const entry = this.entry(name, "table");
    if (!entry?.sql) return null;
    return { ...parseCreateTable(entry.sql), rootPage: entry.rootPage };
  }

  /** The indexes on a table, automatic ones (from UNIQUE and PRIMARY KEY) included. */
  indexes(table: string): IndexShape[] {
    const shape = this.table(table);
    const out: IndexShape[] = [];
    for (const entry of this.schema) {
      if (entry.type !== "index" || entry.table.toLowerCase() !== table.toLowerCase()) continue;
      if (entry.sql) out.push({ name: entry.name, table: entry.table, rootPage: entry.rootPage, ...parseCreateIndex(entry.sql) });
      else {
        const n = /^sqlite_autoindex_.+_(\d+)$/.exec(entry.name);
        const columns = n && shape ? shape.uniques[Number(n[1]) - 1] : undefined;
        out.push({ name: entry.name, table: entry.table, rootPage: entry.rootPage, columns: columns ?? [], usable: !!columns });
      }
    }
    return out;
  }

  private cells(p: Uint8Array, at: number): { type: number; count: number; pointers: number; right: number } {
    const type = p[at];
    if (type !== TABLE_LEAF && type !== TABLE_INTERIOR && type !== INDEX_LEAF && type !== INDEX_INTERIOR) throw new SqliteError(`page holds no B-tree (type ${type})`);
    const interior = type === TABLE_INTERIOR || type === INDEX_INTERIOR;
    return { type, count: u16(p, at + 3), pointers: at + (interior ? 12 : 8), right: interior ? u32(p, at + 8) : 0 };
  }

  private cell(p: Uint8Array, type: number, offset: number): Cell {
    let at = offset;
    let child = 0;
    if (type === TABLE_INTERIOR || type === INDEX_INTERIOR) {
      child = u32(p, at);
      at += 4;
    }
    if (type === TABLE_INTERIOR) {
      const [key] = readVarint(p, at);
      return { local: new Uint8Array(0), size: 0, overflow: 0, rowid: key, child };
    }
    const [size, n] = readVarint(p, at);
    at += n;
    let rowid = 0;
    if (type === TABLE_LEAF) {
      const [id, m] = readVarint(p, at);
      rowid = id;
      at += m;
    }
    const local = localPayloadSize(size, this.header.usable, type === TABLE_LEAF ? "table" : "index");
    if (at + local > p.length) throw new SqliteError("a cell runs past its page");
    return { local: p.subarray(at, at + local), size, overflow: local < size ? u32(p, at + local) : 0, rowid, child };
  }

  /** A cell's whole payload, following its overflow pages. */
  private async payload(cell: Cell): Promise<Uint8Array> {
    if (!cell.overflow) return cell.local;
    const out = new Uint8Array(cell.size);
    out.set(cell.local);
    let at = cell.local.length;
    let next = cell.overflow;
    const room = this.header.usable - 4;
    for (let guard = 0; next && at < cell.size; guard++) {
      if (guard > 1 << 22) throw new SqliteError("an overflow chain never ends");
      const page = await this.page(next);
      const take = Math.min(room, cell.size - at);
      out.set(page.subarray(4, 4 + take), at);
      at += take;
      next = u32(page, 0);
    }
    if (at < cell.size) throw new SqliteError("an overflow chain ends early");
    return out;
  }

  /** The first `count` values of a cell, reading overflow pages only when they hold one of them. */
  private async values(cell: Cell, count = Infinity): Promise<SqliteValue[]> {
    let bytes = cell.local;
    if (cell.overflow) {
      let enough = false;
      try {
        enough = count !== Infinity && recordEnd(cell.local, count) <= cell.local.length;
      } catch {
        enough = false;
      }
      if (!enough) bytes = await this.payload(cell);
    }
    return decodeRecord(bytes, this.header.encoding, count);
  }

  /** Every row of a table, in rowid order; `count` limits the values read per row. */
  async *rows(rootPage: number, count = Infinity): AsyncGenerator<Row> {
    const stack: number[] = [rootPage];
    let guard = 0;
    while (stack.length) {
      if (++guard > 1 << 24) throw new SqliteError("a table's B-tree has a loop");
      const number = stack.pop() as number;
      const p = await this.page(number);
      const head = this.cells(p, number === 1 ? 100 : 0);
      if (head.type === TABLE_INTERIOR) {
        // Children go on the stack in reverse, so the leftmost comes off first.
        stack.push(head.right);
        for (let i = head.count - 1; i >= 0; i--) stack.push(u32(p, u16(p, head.pointers + 2 * i)));
      } else if (head.type === TABLE_LEAF) {
        for (let i = 0; i < head.count; i++) {
          const cell = this.cell(p, head.type, u16(p, head.pointers + 2 * i));
          yield { rowid: cell.rowid, values: await this.values(cell, count) };
        }
      } else throw new SqliteError(`page ${number} is an index page inside a table`);
    }
  }

  /** One row of a table by its rowid, or null. */
  async row(rootPage: number, rowid: number): Promise<Row | null> {
    let number = rootPage;
    for (let depth = 0; depth < 64; depth++) {
      const p = await this.page(number);
      const head = this.cells(p, number === 1 ? 100 : 0);
      const at = (i: number) => this.cell(p, head.type, u16(p, head.pointers + 2 * i));
      let lo = 0;
      let hi = head.count;
      // The first cell whose rowid (a leaf) or key (an interior page) is at least the one asked for.
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (at(mid).rowid < rowid) lo = mid + 1;
        else hi = mid;
      }
      if (head.type === TABLE_LEAF) {
        if (lo >= head.count) return null;
        const cell = at(lo);
        return cell.rowid === rowid ? { rowid, values: await this.values(cell) } : null;
      }
      if (head.type !== TABLE_INTERIOR) throw new SqliteError(`page ${number} is not a table page`);
      number = lo < head.count ? at(lo).child : head.right;
    }
    throw new SqliteError("a table's B-tree is too deep");
  }

  /** The first index entry whose leading values equal `key` (its last value is the row's rowid), or null. */
  async find(rootPage: number, key: SqliteValue[]): Promise<SqliteValue[] | null> {
    const compare = (entry: SqliteValue[]) => {
      for (let i = 0; i < key.length; i++) {
        const c = compareValues(entry[i] ?? null, key[i]);
        if (c) return c;
      }
      return 0;
    };
    let number = rootPage;
    for (let depth = 0; depth < 64; depth++) {
      const p = await this.page(number);
      const head = this.cells(p, number === 1 ? 100 : 0);
      if (head.type !== INDEX_LEAF && head.type !== INDEX_INTERIOR) throw new SqliteError(`page ${number} is not an index page`);
      const cells: Cell[] = [];
      const entryAt = async (i: number) => {
        cells[i] = cells[i] ?? this.cell(p, head.type, u16(p, head.pointers + 2 * i));
        return this.values(cells[i]);
      };
      let lo = 0;
      let hi = head.count;
      let found: SqliteValue[] | null = null;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const entry = await entryAt(mid);
        const c = compare(entry);
        if (c < 0) lo = mid + 1;
        else {
          if (c === 0) found = entry;
          hi = mid;
        }
      }
      if (head.type === INDEX_LEAF) return lo < head.count ? (compare(await entryAt(lo)) === 0 ? await entryAt(lo) : null) : null;
      // An equal key on an interior page may still have an equal one to its left; the leaf decides,
      // and falls back on the one seen here.
      const child = lo < head.count ? (cells[lo] ?? this.cell(p, head.type, u16(p, head.pointers + 2 * lo))).child : head.right;
      const below = await this.find(child, key);
      return below ?? found;
    }
    throw new SqliteError("an index's B-tree is too deep");
  }

  /** The smallest (`first`) or largest entry of an index, or null when it is empty. */
  async edge(rootPage: number, which: "first" | "last"): Promise<SqliteValue[] | null> {
    let number = rootPage;
    let best: SqliteValue[] | null = null;
    for (let depth = 0; depth < 64; depth++) {
      const p = await this.page(number);
      const head = this.cells(p, number === 1 ? 100 : 0);
      if (head.type !== INDEX_LEAF && head.type !== INDEX_INTERIOR) throw new SqliteError(`page ${number} is not an index page`);
      const cellAt = (i: number) => this.cell(p, head.type, u16(p, head.pointers + 2 * i));
      if (head.type === INDEX_LEAF) {
        if (!head.count) return best;
        return this.values(cellAt(which === "first" ? 0 : head.count - 1));
      }
      // An interior page's own entries sit between its children: the edge is in the outermost child,
      // or, if that leaf is empty, the outermost entry seen on the way down.
      if (which === "first") {
        const cell = cellAt(0);
        best = await this.values(cell);
        number = cell.child;
      } else {
        if (head.count) best = await this.values(cellAt(head.count - 1));
        number = head.right;
      }
    }
    throw new SqliteError("an index's B-tree is too deep");
  }
}
