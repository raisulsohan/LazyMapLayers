import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compareValues, decodeRecord, localPayloadSize, parseCreateIndex, parseCreateTable, readVarint, SqliteError, SqliteReader, type ReadAt, type SqliteValue } from "../../src/core/tiles/sqlite.ts";
import { encodeRecord, writeSqlite } from "../../src/core/tiles/sqliteWrite.ts";

const folder = mkdtempSync(join(tmpdir(), "lml-sqlite-"));
test.after(() => rmSync(folder, { recursive: true, force: true }));

let made = 0;
/** A database SQLite itself writes, returned as bytes once it is closed. */
function sqliteFile(setup: (db: DatabaseSync) => void, pragmas: string[] = []): { bytes: Uint8Array; file: string } {
  const file = join(folder, `db${made++}.sqlite`);
  const db = new DatabaseSync(file);
  for (const pragma of pragmas) db.exec(`PRAGMA ${pragma}`);
  setup(db);
  db.close();
  return { bytes: new Uint8Array(readFileSync(file)), file };
}

/** Reads from the bytes, counting the calls. */
function reading(bytes: Uint8Array): { read: ReadAt; calls: () => number } {
  let calls = 0;
  return {
    read: async (offset, length) => {
      calls++;
      return bytes.subarray(offset, offset + length);
    },
    calls: () => calls
  };
}

/** A deterministic random number generator. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const blob = (n: number, seed: number) => {
  const next = random(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
};

test("variable-length numbers and records decode as SQLite writes them", () => {
  assert.deepEqual(readVarint(Uint8Array.of(0x05), 0), [5, 1]);
  assert.deepEqual(readVarint(Uint8Array.of(0x81, 0x00), 0), [128, 2]);
  assert.deepEqual(readVarint(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01), 0), [2 ** 64 - 255, 9]);
  const values: SqliteValue[] = [null, 0, 1, -1, 127, -129, 40000, -8388608, 2 ** 31, -(2 ** 40), 2 ** 52, 1.5, "Dhaka ঢাকা", Uint8Array.of(1, 2, 3), ""];
  assert.deepEqual(decodeRecord(encodeRecord(values), "utf-8"), values);
  assert.deepEqual(decodeRecord(encodeRecord(values), "utf-8", 3), values.slice(0, 3));
});

test("values sort as SQLite sorts them", () => {
  const sorted: SqliteValue[] = [null, -5, 0, 2.5, 3, "B", "a", "ab", Uint8Array.of(0), Uint8Array.of(0, 1)];
  for (let i = 0; i < sorted.length; i++) for (let j = 0; j < sorted.length; j++) assert.equal(Math.sign(compareValues(sorted[i], sorted[j])), Math.sign(i - j), `${String(sorted[i])} vs ${String(sorted[j])}`);
});

test("the part of a payload kept on the page follows the file format's rule", () => {
  assert.equal(localPayloadSize(100, 4096, "table"), 100);
  assert.equal(localPayloadSize(4061, 4096, "table"), 4061);
  // Past the limit: M + (P - M) % (U - 4) when that fits, else M.
  const least = Math.floor((4084 * 32) / 255) - 23;
  assert.equal(localPayloadSize(5000, 4096, "table"), least + ((5000 - least) % 4092) <= 4061 ? least + ((5000 - least) % 4092) : least);
  assert.equal(localPayloadSize(1000, 4096, "index"), 1000);
  assert.ok(localPayloadSize(2000, 4096, "index") < 2000);
});

test("table and index shapes are read from their CREATE statements", () => {
  const tiles = parseCreateTable("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)");
  assert.deepEqual(tiles.columns, ["zoom_level", "tile_column", "tile_row", "tile_data"]);
  assert.equal(tiles.rowidColumn, -1);
  assert.equal(tiles.withoutRowid, false);
  const quoted = parseCreateTable('CREATE TABLE "my table" ("Zoom Level" INTEGER NOT NULL, [col] TEXT DEFAULT \'a,b\', `x` REAL CHECK (x > 0), id INTEGER PRIMARY KEY, CONSTRAINT k UNIQUE ("Zoom Level", col))');
  assert.deepEqual(quoted.columns, ["zoom level", "col", "x", "id"]);
  assert.equal(quoted.rowidColumn, 3);
  assert.deepEqual(quoted.uniques, [["zoom level", "col"]]);
  const keyed = parseCreateTable("create table t (a integer, b text unique, c blob, primary key (a, c))");
  assert.deepEqual(keyed.uniques, [["b"], ["a", "c"]]);
  assert.equal(parseCreateTable("CREATE TABLE w (a INTEGER PRIMARY KEY, b) WITHOUT ROWID").withoutRowid, true);
  assert.deepEqual(parseCreateIndex("CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row)"), { columns: ["zoom_level", "tile_column", "tile_row"], usable: true });
  assert.equal(parseCreateIndex("CREATE INDEX i ON t (a DESC)").usable, false, "a descending index sorts the other way");
  assert.equal(parseCreateIndex("CREATE INDEX i ON t (a) WHERE a > 3").usable, false, "a partial index misses rows");
  assert.equal(parseCreateIndex('CREATE INDEX "i" ON "t" ("b" COLLATE NOCASE)').usable, false);
});

for (const pageSize of [512, 1024, 4096, 65536]) {
  test(`rows, rowids and overflow pages read back as SQLite wrote them (pages of ${pageSize} bytes)`, async () => {
    const next = random(pageSize);
    const rows: { id: number; n: number; f: number; t: string; b: Uint8Array | null }[] = [];
    for (let i = 0; i < 1500; i++) {
      // Some rows far longer than a page, so their payload runs on through overflow pages.
      const size = i % 97 === 0 ? 3 * pageSize + Math.floor(next() * pageSize) : Math.floor(next() * 300);
      rows.push({ id: i * 3 + 7, n: Math.floor((next() - 0.5) * 2 ** 40), f: next() * 1000, t: `name ${i} · নাম ${i}`, b: i % 50 === 1 ? null : blob(size, i) });
    }
    const { bytes } = sqliteFile((db) => {
      db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, n INTEGER, f REAL, t TEXT, b BLOB)");
      db.exec("CREATE INDEX things_t ON things (t)");
      const insert = db.prepare("INSERT INTO things VALUES (?, ?, ?, ?, ?)");
      db.exec("BEGIN");
      for (const r of rows) insert.run(r.id, r.n, r.f, r.t, r.b);
      db.exec("COMMIT");
    }, [`page_size = ${pageSize}`]);
    const db = await SqliteReader.open(reading(bytes).read);
    assert.equal(db.header.pageSize, pageSize);
    assert.equal(db.header.wal, false);
    const table = db.table("things")!;
    assert.equal(table.rowidColumn, 0);
    let i = 0;
    for await (const row of db.rows(table.rootPage)) {
      const want = rows[i++];
      assert.equal(row.rowid, want.id);
      assert.deepEqual(row.values, [null, want.n, want.f, want.t, want.b]);
    }
    assert.equal(i, rows.length);
    for (const want of [rows[0], rows[97], rows[500], rows[1499]]) {
      const row = await db.row(table.rootPage, want.id);
      assert.deepEqual(row?.values.slice(1), [want.n, want.f, want.t, want.b]);
    }
    assert.equal(await db.row(table.rootPage, 8), null, "a rowid between two rows");
    assert.equal(await db.row(table.rootPage, 10 ** 9), null, "a rowid past the last row");
    const index = db.indexes("things").find((x) => x.name === "things_t")!;
    assert.deepEqual(index.columns, ["t"]);
    for (const want of [rows[3], rows[1234]]) {
      const entry = await db.find(index.rootPage, [want.t]);
      assert.deepEqual(entry, [want.t, want.id]);
    }
    assert.equal(await db.find(index.rootPage, ["no such name"]), null);
    assert.deepEqual(await db.edge(index.rootPage, "first"), ["name 0 · নাম 0", 7]);
    const last = rows.map((r) => r.t).sort((a, b) => compareValues(a, b)).at(-1)!;
    assert.equal((await db.edge(index.rootPage, "last"))![0], last);
  });
}

test("a lookup reads a few pages, not the file", async () => {
  const { bytes } = sqliteFile((db) => {
    db.exec("CREATE TABLE t (a INTEGER, b INTEGER, c INTEGER, d BLOB)");
    db.exec("CREATE UNIQUE INDEX t_abc ON t (a, b, c)");
    const insert = db.prepare("INSERT INTO t VALUES (?, ?, ?, ?)");
    db.exec("BEGIN");
    for (let a = 0; a < 6; a++) for (let b = 0; b < 30; b++) for (let c = 0; c < 30; c++) insert.run(a, b, c, blob(200, a * 900 + b * 30 + c));
    db.exec("COMMIT");
  });
  const counted = reading(bytes);
  const db = await SqliteReader.open(counted.read);
  const index = db.indexes("t")[0];
  const before = counted.calls();
  const entry = await db.find(index.rootPage, [4, 17, 29]);
  assert.ok(entry);
  const row = await db.row(db.table("t")!.rootPage, entry![3] as number);
  assert.deepEqual(row!.values.slice(0, 3), [4, 17, 29]);
  assert.deepEqual(row!.values[3], blob(200, 4 * 900 + 17 * 30 + 29));
  const pages = bytes.length / db.header.pageSize;
  assert.ok(counted.calls() - before < 10, `${counted.calls() - before} reads of a ${pages}-page file`);
});

test("automatic indexes take their columns from the table's constraints", async () => {
  const { bytes } = sqliteFile((db) => {
    db.exec("CREATE TABLE t (name TEXT UNIQUE, z INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (z, x, y))");
    db.exec("INSERT INTO t VALUES ('one', 1, 2, 3), ('two', 4, 5, 6)");
  });
  const db = await SqliteReader.open(reading(bytes).read);
  const indexes = db.indexes("t");
  assert.deepEqual(indexes.map((x) => x.columns), [["name"], ["z", "x", "y"]]);
  const entry = await db.find(indexes[1].rootPage, [4, 5, 6]);
  assert.equal((await db.row(db.table("t")!.rootPage, entry!.at(-1) as number))!.values[0], "two");
});

test("text stored as UTF-16 reads as text", async () => {
  for (const encoding of ["UTF-16le", "UTF-16be"]) {
    const { bytes } = sqliteFile((db) => {
      db.exec("CREATE TABLE metadata (name TEXT, value TEXT)");
      db.prepare("INSERT INTO metadata VALUES (?, ?)").run("attribution", "© Ordnance · জরিপ");
    }, [`encoding = '${encoding}'`]);
    const db = await SqliteReader.open(reading(bytes).read);
    assert.equal(db.header.encoding, encoding.toLowerCase());
    const rows = [];
    for await (const row of db.rows(db.table("metadata")!.rootPage)) rows.push(row.values);
    assert.deepEqual(rows, [["attribution", "© Ordnance · জরিপ"]]);
  }
});

test("a database in WAL mode says so", async () => {
  const { bytes } = sqliteFile((db) => {
    db.exec("CREATE TABLE t (a)");
    db.exec("INSERT INTO t VALUES (1)");
  }, ["journal_mode = WAL"]);
  assert.equal((await SqliteReader.open(reading(bytes).read)).header.wal, true);
});

test("what is not an SQLite file is refused", async () => {
  await assert.rejects(SqliteReader.open(reading(new TextEncoder().encode("PK\u0003\u0004 a zip, not a database ".repeat(10))).read), SqliteError);
  await assert.rejects(SqliteReader.open(reading(new Uint8Array(10)).read), SqliteError);
});

for (const pageSize of [512, 4096, 65536]) {
  test(`the writer's files pass SQLite's own integrity check (pages of ${pageSize} bytes)`, async () => {
    const rows: SqliteValue[][] = [];
    for (let i = 0; i < 3000; i++) rows.push([i % 7, i, i ? -i * 1000 : 0, i / 3, `row ${i}`, blob(i % 120, i), i % 11 ? null : ""]);
    const bytes = writeSqlite([
      { name: "t", sql: "CREATE TABLE t (a INTEGER, b INTEGER, c INTEGER, d REAL, e TEXT, f BLOB, g TEXT)", rows },
      { name: "metadata", sql: "CREATE TABLE metadata (name text, value text)", rows: [["format", "png"]] },
      { name: "empty", sql: "CREATE TABLE empty (a)", rows: [] }
    ], { pageSize, applicationId: 0x4d504258 });
    const file = join(folder, `written${pageSize}.sqlite`);
    writeFileSync(file, bytes);
    const db = new DatabaseSync(file, { readOnly: true });
    assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map((row) => ({ ...row })), [{ integrity_check: "ok" }]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n, 3000);
    const some = db.prepare("SELECT a, b, c, d, e, f, g FROM t WHERE rowid = ?").get(1234) as Record<string, unknown>;
    assert.deepEqual([some.a, some.b, some.c, some.d, some.e, new Uint8Array(some.f as Uint8Array), some.g], [rows[1233][0], rows[1233][1], rows[1233][2], rows[1233][3], rows[1233][4], rows[1233][5], rows[1233][6]]);
    assert.equal((db.prepare("PRAGMA application_id").get() as { application_id: number }).application_id, 0x4d504258);
    assert.equal((db.prepare("SELECT count(*) AS n FROM empty").get() as { n: number }).n, 0);
    db.close();
    const reader = await SqliteReader.open(reading(bytes).read);
    const back = [];
    for await (const row of reader.rows(reader.table("t")!.rootPage)) back.push(row.values);
    assert.deepEqual(back, rows);
  });
}

test("the writer refuses a row too long for a page", () => {
  assert.throws(() => writeSqlite([{ name: "t", sql: "CREATE TABLE t (a)", rows: [[new Uint8Array(600)]] }], { pageSize: 512 }), /too long/);
});
