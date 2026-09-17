import { test } from "node:test";
import assert from "node:assert/strict";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { PMTILES_COMPRESSION, PMTILES_TILE_TYPE, PmtilesWriter, serializeDirectory } from "../../src/core/pmtiles/writer.ts";
import { deserializeDirectory } from "../../src/core/pmtiles/directory.ts";
import { mergeRanges, planExtract, runExtract } from "../../src/core/pmtiles/extract.ts";
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
