import { test } from "node:test";
import assert from "node:assert/strict";
import { PMTiles, type Source, type RangeResponse } from "pmtiles";
import { PMTILES_COMPRESSION, PMTILES_TILE_TYPE, PmtilesWriter, serializeDirectory } from "../../src/core/pmtiles/writer.ts";

class MemorySource implements Source {
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  getKey(): string {
    return "memory";
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.bytes.slice(offset, offset + length);
    return { data: slice.buffer };
  }
}

const bytesOf = (text: string) => new TextEncoder().encode(text);

function buildSample(maxRootEntries?: number) {
  const writer = new PmtilesWriter();
  const expected = new Map<string, Uint8Array>();
  const add = (z: number, x: number, y: number, data: Uint8Array) => {
    writer.addTile(z, x, y, data);
    expected.set(`${z}/${x}/${y}`, data);
  };
  add(0, 0, 0, bytesOf("world"));
  const ocean = bytesOf("ocean tile, identical everywhere");
  for (let z = 1; z <= 5; z++) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const unique = (x + y) % 7 === 0;
        add(z, x, y, unique ? bytesOf(`tile ${z}/${x}/${y}`) : ocean);
      }
    }
  }
  const archive = writer.build({
    tileType: PMTILES_TILE_TYPE.mvt,
    tileCompression: PMTILES_COMPRESSION.none,
    metadata: { name: "sample", vector_layers: [] },
    maxRootEntries,
    leafSize: 64
  });
  return { archive, expected };
}

for (const [label, maxRootEntries] of [["root directory only", undefined], ["with leaf directories", 50]] as const) {
  test(`every tile reads back (${label})`, async () => {
    const { archive, expected } = buildSample(maxRootEntries);
    const reader = new PMTiles(new MemorySource(archive));
    const header = await reader.getHeader();
    assert.equal(header.specVersion, 3);
    assert.equal(header.minZoom, 0);
    assert.equal(header.maxZoom, 5);
    assert.equal(header.numAddressedTiles, expected.size);
    assert.ok(header.numTileContents < expected.size, "duplicates are stored once");
    for (const [key, data] of expected) {
      const [z, x, y] = key.split("/").map(Number);
      const tile = await reader.getZxy(z, x, y);
      assert.ok(tile, `missing ${key}`);
      assert.deepEqual(new Uint8Array(tile.data), data, key);
    }
    assert.equal(await reader.getZxy(6, 0, 0), undefined);
    const metadata = (await reader.getMetadata()) as { name: string };
    assert.equal(metadata.name, "sample");
  });
}

test("a large archive keeps header and root directory inside the first 16384 bytes", async () => {
  // Regression: 5461 unique tiles fit under the entry limit but serialise to more than 16 KB,
  // which the official reader cannot load from its first request.
  const writer = new PmtilesWriter();
  const expected: [number, number, number, Uint8Array][] = [];
  for (let z = 0; z <= 6; z++) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const data = bytesOf(`unique tile ${z}/${x}/${y} `.repeat(3));
        writer.addTile(z, x, y, data);
        expected.push([z, x, y, data]);
      }
    }
  }
  const archive = writer.build({ tileType: PMTILES_TILE_TYPE.mvt, tileCompression: PMTILES_COMPRESSION.none });
  const view = new DataView(archive.buffer);
  const rootEnd = view.getUint32(8, true) + view.getUint32(16, true);
  assert.ok(rootEnd <= 16384, `root directory ends at byte ${rootEnd}`);
  const reader = new PMTiles(new MemorySource(archive));
  for (const [z, x, y, data] of [expected[0], expected[100], expected[2000], expected[expected.length - 1]]) {
    const tile = await reader.getZxy(z, x, y);
    assert.ok(tile, `missing ${z}/${x}/${y}`);
    assert.deepEqual(new Uint8Array(tile.data), data);
  }
});

test("runs of identical consecutive tiles collapse into one entry", () => {
  const writer = new PmtilesWriter();
  const same = bytesOf("same");
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) writer.addTile(2, x, y, same);
  const archive = writer.build({ tileType: PMTILES_TILE_TYPE.mvt, tileCompression: PMTILES_COMPRESSION.none });
  const view = new DataView(archive.buffer);
  assert.equal(view.getUint32(80, true), 1, "one tile entry");
  assert.equal(view.getUint32(72, true), 16, "sixteen addressed tiles");
});

test("directory encoding matches the spec example shape", () => {
  const bytes = serializeDirectory([
    { tileId: 0, offset: 0, length: 10, runLength: 1 },
    { tileId: 1, offset: 10, length: 5, runLength: 2 },
    { tileId: 5, offset: 0, length: 10, runLength: 1 }
  ]);
  // count 3 | ids 0,1,4 | runs 1,2,1 | lengths 10,5,10 | offsets 1 (0+1), 0 (contiguous), 1 (0+1)
  assert.deepEqual(Array.from(bytes), [3, 0, 1, 4, 1, 2, 1, 10, 5, 10, 1, 0, 1]);
});
