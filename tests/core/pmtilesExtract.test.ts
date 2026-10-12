import { test } from "node:test";
import assert from "node:assert/strict";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { PMTILES_COMPRESSION, PMTILES_TILE_TYPE, PmtilesWriter, serializeDirectory } from "../../src/core/pmtiles/writer.ts";
import { deserializeDirectory } from "../../src/core/pmtiles/directory.ts";
import { fetchTiles, mergeRanges, planExtract, planTiles, runExtract } from "../../src/core/pmtiles/extract.ts";
import { tileIdToZxy, zxyToTileId } from "pmtiles";
import { tileRangeForBbox, tileCount } from "../../src/core/tiles/tileMath.ts";

class MemorySource implements Source {
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  getKey(): string {
    return "memory";
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.bytes.slice(offset, offset + length).buffer };
  }
}

const paris = { west: 2.2, south: 48.8, east: 2.48, north: 48.92 };

function worldArchive(maxZoom: number) {
  const writer = new PmtilesWriter();
  const sea = new TextEncoder().encode("sea");
  for (let z = 0; z <= maxZoom; z++) {
    const n = 2 ** z;
    const inside = z >= 4 ? tileRangeForBbox(paris, z) : null;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const land = inside && x >= inside.minX && x <= inside.maxX && y >= inside.minY && y <= inside.maxY;
        writer.addTile(z, x, y, land ? new TextEncoder().encode(`paris ${z}/${x}/${y}`) : sea);
      }
    }
  }
  return writer.build({ tileType: PMTILES_TILE_TYPE.mvt, tileCompression: PMTILES_COMPRESSION.none, metadata: { name: "world" }, leafSize: 256 });
}

test("directory serialisation round trips", () => {
  const entries = [
    { tileId: 5, offset: 0, length: 100, runLength: 1 },
    { tileId: 6, offset: 100, length: 50, runLength: 3 },
    { tileId: 9_000_000_000, offset: 0, length: 100, runLength: 0 }
  ];
  assert.deepEqual(deserializeDirectory(serializeDirectory(entries)), entries);
});

test("tile ranges cover the bbox", () => {
  const z12 = tileRangeForBbox(paris, 12);
  assert.ok(tileCount(z12) >= 4 && tileCount(z12) < 30, `z12 tiles ${tileCount(z12)}`);
  assert.equal(tileCount(tileRangeForBbox(paris, 0)), 1);
});

test("extract keeps exactly the tiles inside the bbox", async () => {
  const source = worldArchive(7);
  let reads = 0;
  const read = async (offset: number, length: number) => {
    reads++;
    return source.slice(offset, offset + length);
  };
  const plan = await planExtract(read, paris, 0, 7);
  const expectedCount = [0, 1, 2, 3, 4, 5, 6, 7].reduce((sum, z) => sum + tileCount(tileRangeForBbox(paris, z)), 0);
  assert.equal(plan.tiles.length, expectedCount);
  assert.ok(plan.directoriesRead < 20, `read ${plan.directoriesRead} directories`);

  const readsBefore = reads;
  const archive = await runExtract(plan, read);
  assert.ok(reads - readsBefore <= 3, `tile data fetched in ${reads - readsBefore} requests`);

  const out = new PMTiles(new MemorySource(archive));
  const header = await out.getHeader();
  assert.equal(header.numAddressedTiles, expectedCount);
  const inside = tileRangeForBbox(paris, 7);
  const tile = await out.getZxy(7, inside.minX, inside.minY);
  assert.equal(new TextDecoder().decode(tile!.data), `paris 7/${inside.minX}/${inside.minY}`);
  assert.equal(await out.getZxy(7, 0, 0), undefined, "tiles outside the bbox are not copied");
  const meta = (await out.getMetadata()) as { name: string; lazymaplayers_extract: { maxzoom: number } };
  assert.equal(meta.name, "world");
  assert.equal(meta.lazymaplayers_extract.maxzoom, 7);
});

test("nearby ranges merge, distant ones stay apart", () => {
  const merged = mergeRanges(
    [
      { offset: 0, length: 10 },
      { offset: 15, length: 5 },
      { offset: 5000, length: 10 }
    ],
    100
  );
  assert.deepEqual(merged, [
    { offset: 0, length: 20 },
    { offset: 5000, length: 10 }
  ]);
});

test("any set of tiles is planned and fetched one by one, with the absent ones named", async () => {
  const writer = new PmtilesWriter();
  // A world to zoom 6 where one tile is missing, as open sea can be in a real archive.
  for (let z = 0; z <= 6; z++) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) if (!(z === 6 && x === 10 && y === 20)) writer.addTile(z, x, y, new TextEncoder().encode(`${z}/${x}/${y}`));
  }
  const source = writer.build({ tileType: PMTILES_TILE_TYPE.mvt, tileCompression: PMTILES_COMPRESSION.none, metadata: {}, leafSize: 64 });
  const indexReads: string[] = [];
  let dataReads = 0;
  const read = async (offset: number, length: number) => {
    dataReads++;
    return source.slice(offset, offset + length);
  };
  const readIndex = async (offset: number, length: number) => {
    indexReads.push(`${offset}+${length}`);
    return source.slice(offset, offset + length);
  };
  const wanted = [
    { z: 6, x: 33, y: 20 },
    { z: 6, x: 34, y: 20 },
    { z: 6, x: 10, y: 20 },
    { z: 5, x: 16, y: 10 },
    { z: 7, x: 1, y: 1 },
    { z: 6, x: 33, y: 20 }
  ];
  const plan = await planTiles(read, wanted, { readIndex });
  assert.equal(dataReads, 0, "the header and directories go through the index reader");
  assert.ok(indexReads.length >= 2, "the leaves holding the tiles are read");
  assert.equal(plan.tiles.length, 3);
  assert.deepEqual(plan.absent.map((id) => tileIdToZxy(id).join("/")).sort(), ["6/10/20", "7/1/1"]);

  const got = new Map<string, string>();
  await fetchTiles(plan, read, (id, bytes) => got.set(tileIdToZxy(id).join("/"), new TextDecoder().decode(bytes)), undefined, { parallel: 3 });
  assert.deepEqual([...got.entries()].sort(), [["5/16/10", "5/16/10"], ["6/33/20", "6/33/20"], ["6/34/20", "6/34/20"]]);
  assert.ok(dataReads <= 3);

  // Nothing wanted: no directory beyond the head is read.
  const empty = await planTiles(read, []);
  assert.equal(empty.tiles.length, 0);
  assert.equal(zxyToTileId(0, 0, 0), 0);
});

test("a fetch stops when it is cancelled", async () => {
  const writer = new PmtilesWriter();
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) writer.addTile(2, x, y, new Uint8Array(70000).fill(x * 4 + y));
  const source = writer.build({ tileType: PMTILES_TILE_TYPE.mvt, tileCompression: PMTILES_COMPRESSION.none, metadata: {} });
  const read = async (offset: number, length: number) => source.slice(offset, offset + length);
  const plan = await planTiles(read, [{ z: 2, x: 0, y: 0 }, { z: 2, x: 3, y: 3 }]);
  let calls = 0;
  await assert.rejects(fetchTiles(plan, read, () => calls++, undefined, { maxGap: 0, cancelled: () => calls > 0 }), /cancelled/);
  assert.equal(calls, 1);
});
