import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Mbtiles, plainAttribution } from "../../src/core/tiles/mbtiles.ts";
import { SqliteError, type ReadAt } from "../../src/core/tiles/sqlite.ts";
import { writeSqlite } from "../../src/core/tiles/sqliteWrite.ts";

const folder = mkdtempSync(join(tmpdir(), "lml-mbtiles-"));
test.after(() => rmSync(folder, { recursive: true, force: true }));

let made = 0;
function sqliteFile(setup: (db: DatabaseSync) => void, pageSize = 4096): Uint8Array {
  const file = join(folder, `t${made++}.mbtiles`);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA page_size = ${pageSize}`);
  setup(db);
  db.close();
  return new Uint8Array(readFileSync(file));
}

const read = (bytes: Uint8Array): ReadAt => async (offset, length) => bytes.subarray(offset, offset + length);

/** A stand-in tile: its own z/x/y (rows from the north) in the bytes, padded to `size`. */
const tileBytes = (z: number, x: number, y: number, size = 64) => {
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(`${z}/${x}/${y}`));
  return out;
};

/** Every tile of zooms 0 to `top`, as (z, x, TMS row, data). */
function* pyramid(top: number, size?: (z: number) => number): Generator<[number, number, number, Uint8Array]> {
  for (let z = 0; z <= top; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) yield [z, x, 2 ** z - 1 - y, tileBytes(z, x, y, size?.(z))];
}

const META = [
  ["name", "Test ortho"],
  ["format", "jpeg"],
  ["bounds", "-10.5,35.25,30,60"],
  ["minzoom", "0"],
  ["maxzoom", "5"],
  ["attribution", '<a href="https://example.org">&copy; Example Survey</a> &amp; friends']
];

function tilesTable(db: DatabaseSync, index: "unique" | "primary" | "none", top = 5, meta = META) {
  db.exec(`CREATE TABLE metadata (name text, value text)`);
  if (index === "primary") db.exec("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob, PRIMARY KEY (zoom_level, tile_column, tile_row))");
  else db.exec("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)");
  if (index === "unique") db.exec("CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row)");
  const insert = db.prepare("INSERT INTO tiles VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const [z, x, row, data] of pyramid(top)) insert.run(z, x, row, data);
  for (const [k, v] of meta) db.prepare("INSERT INTO metadata VALUES (?, ?)").run(k, v);
  db.exec("COMMIT");
}

async function checkTiles(mb: Mbtiles, top = 5) {
  for (const [z, x, y] of [[0, 0, 0], [1, 1, 0], [3, 2, 6], [5, 31, 0], [5, 17, 29]]) {
    assert.deepEqual(await mb.tile(z, x, y), tileBytes(z, x, y), `${z}/${x}/${y}`);
  }
  assert.equal(await mb.tile(top + 1, 0, 0), null, "a zoom the file does not have");
  assert.equal(await mb.tile(2, 4, 0), null, "outside the world");
}

test("a tiles table with its index: tiles by z/x/y counted from the north, and the metadata", async () => {
  const mb = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "unique"))));
  assert.deepEqual(mb.info, { name: "Test ortho", format: "jpg", minZoom: 0, maxZoom: 5, bounds: [-10.5, 35.25, 30, 60], attribution: "© Example Survey & friends", scheme: "tms", layout: "tiles", indexed: true, wal: false });
  await checkTiles(mb);
});

test("a tiles table keyed by its PRIMARY KEY, and one with no index at all", async () => {
  const keyed = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "primary"))));
  assert.equal(keyed.info.indexed, true, "the automatic index is used");
  await checkTiles(keyed);
  // No index and no zooms in the metadata: the keys are read once, and the zooms come from them.
  const bare = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "none", 4, [["format", "png"]]))));
  assert.equal(bare.info.indexed, false);
  assert.equal(bare.info.minZoom, 0);
  assert.equal(bare.info.maxZoom, 4);
  assert.equal(bare.info.bounds, null);
  assert.equal(bare.info.attribution, "");
  for (const [z, x, y] of [[0, 0, 0], [3, 2, 6], [4, 9, 3], [4, 15, 15]]) assert.deepEqual(await bare.tile(z, x, y), tileBytes(z, x, y), `${z}/${x}/${y}`);
  assert.equal(await bare.tile(5, 0, 0), null);
});

test("the zooms come from the index when the metadata has none", async () => {
  const mb = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "unique", 3, [["format", "webp"]]))));
  assert.equal(mb.info.minZoom, 0);
  assert.equal(mb.info.maxZoom, 3);
  assert.equal(mb.info.format, "webp");
});

test("the map and images tables behind a tiles view, with tiles shared and long enough to overflow", async () => {
  for (const indexed of [true, false]) {
    const bytes = sqliteFile((db) => {
      // As GDAL and mbutil write it: the picture first, its id after it.
      db.exec("CREATE TABLE map (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_id TEXT, grid_id TEXT)");
      db.exec("CREATE TABLE images (tile_data blob, tile_id text)");
      if (indexed) {
        db.exec("CREATE UNIQUE INDEX map_index ON map (zoom_level, tile_column, tile_row)");
        db.exec("CREATE UNIQUE INDEX images_id ON images (tile_id)");
      }
      db.exec("CREATE VIEW tiles AS SELECT map.zoom_level AS zoom_level, map.tile_column AS tile_column, map.tile_row AS tile_row, images.tile_data AS tile_data FROM map JOIN images ON images.tile_id = map.tile_id");
      db.exec("CREATE TABLE metadata (name text, value text)");
      db.prepare("INSERT INTO metadata VALUES (?, ?)").run("format", "png");
      const map = db.prepare("INSERT INTO map VALUES (?, ?, ?, ?, NULL)");
      const image = db.prepare("INSERT INTO images VALUES (?, ?)");
      db.exec("BEGIN");
      for (const [z, x, row, data] of pyramid(4, (z) => (z === 4 ? 3000 : 64))) {
        // The sea: every tile of zoom 3 is the same picture, stored once.
        const id = z === 3 ? "sea" : `${z}-${x}-${row}`;
        map.run(z, x, row, id);
        if (z !== 3 || (x === 0 && row === 0)) image.run(z === 3 ? tileBytes(9, 9, 9) : data, id);
      }
      db.exec("COMMIT");
    }, 1024);
    const mb = await Mbtiles.open(read(bytes));
    assert.equal(mb.info.layout, "map-images");
    assert.equal(mb.info.indexed, indexed);
    assert.equal(mb.info.maxZoom, 4);
    assert.deepEqual(await mb.tile(2, 1, 3), tileBytes(2, 1, 3));
    assert.deepEqual(await mb.tile(4, 11, 5), tileBytes(4, 11, 5, 3000), "a tile over three pages long");
    assert.deepEqual(await mb.tile(3, 5, 2), tileBytes(9, 9, 9), "a shared picture");
    assert.deepEqual(await mb.tile(3, 0, 7), tileBytes(9, 9, 9));
    assert.equal(await mb.tile(5, 0, 0), null);
  }
});

test("rows counted from the north when the metadata says xyz", async () => {
  const bytes = sqliteFile((db) => {
    db.exec("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)");
    db.exec("CREATE TABLE metadata (name text, value text)");
    db.prepare("INSERT INTO metadata VALUES ('scheme', 'xyz')").run();
    db.prepare("INSERT INTO tiles VALUES (2, 1, 0, ?)").run(tileBytes(2, 1, 0));
  });
  const mb = await Mbtiles.open(read(bytes));
  assert.equal(mb.info.scheme, "xyz");
  assert.deepEqual(await mb.tile(2, 1, 0), tileBytes(2, 1, 0));
  assert.equal(await mb.tile(2, 1, 3), null);
});

test("vector tiles are named as such, WAL is reported, and other databases are refused", async () => {
  const vector = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "unique", 1, [["format", "pbf"]]))));
  assert.equal(vector.info.format, "pbf");
  const walFile = join(folder, "wal.mbtiles");
  const db = new DatabaseSync(walFile);
  db.exec("PRAGMA journal_mode = WAL");
  tilesTable(db, "unique", 1);
  db.close();
  assert.equal((await Mbtiles.open(read(new Uint8Array(readFileSync(walFile))))).info.wal, true);
  await assert.rejects(Mbtiles.open(read(sqliteFile((d) => d.exec("CREATE TABLE photos (a, b)")))), /no tiles table/);
  await assert.rejects(Mbtiles.open(read(sqliteFile((d) => d.exec("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob, PRIMARY KEY (zoom_level, tile_column, tile_row)) WITHOUT ROWID")))), SqliteError);
});

test("the file the in-AE test writes is an MBTiles file the reader takes", async () => {
  const rows = [...pyramid(3)].map(([z, x, row, data]) => [z, x, row, data]);
  const bytes = writeSqlite([
    { name: "metadata", sql: "CREATE TABLE metadata (name text, value text)", rows: [["name", "OI1"], ["format", "png"], ["minzoom", "0"], ["maxzoom", "3"], ["attribution", "Test MBTiles"]] },
    { name: "tiles", sql: "CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)", rows }
  ]);
  const mb = await Mbtiles.open(read(bytes));
  assert.equal(mb.info.attribution, "Test MBTiles");
  assert.deepEqual(await mb.tile(3, 6, 1), tileBytes(3, 6, 1));
});

test("an attribution's HTML becomes plain text", () => {
  assert.equal(plainAttribution('<a href="x">© OpenMapTiles</a> <a href="y">© OpenStreetMap contributors</a>'), "© OpenMapTiles © OpenStreetMap contributors");
  assert.equal(plainAttribution("Kartverket &#169; &#xA9; &unknown; <b>x</b>"), "Kartverket © © &unknown; x");
});

test("a sample tile tells the tiles' size", async () => {
  const mb = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "unique", 2))));
  assert.deepEqual(await mb.sample(), tileBytes(0, 0, 0));
  const empty = await Mbtiles.open(read(sqliteFile((db) => tilesTable(db, "none", -1))));
  assert.equal(await empty.sample(), null);
});
