import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { coveringTiles, tileKey, variableZoom, withRing, parseTileKey } from "../../src/core/tiles/coveringTiles.ts";

type Case = {
  place: string;
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
  viewport: { width: number; height: number };
  maxZoom: number;
  tiles: string[];
};

const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/covering-tiles.json", import.meta.url), "utf8")) as { maplibre: string; cases: Case[] };

test("the covering matches MapLibre's own for every recorded view", () => {
  assert.ok(fixtures.cases.length >= 100, `${fixtures.cases.length} recorded views`);
  const misses: string[] = [];
  for (const c of fixtures.cases) {
    const ours = coveringTiles({ center: c.center, zoom: c.zoom, bearing: c.bearing, pitch: c.pitch }, c.viewport, { maxZoom: c.maxZoom })
      .map((t) => `${tileKey(t)}@${t.wrap}`)
      .sort();
    if (JSON.stringify(ours) !== JSON.stringify(c.tiles)) {
      const extra = ours.filter((t) => !c.tiles.includes(t));
      const missing = c.tiles.filter((t) => !ours.includes(t));
      misses.push(`${c.place} z${c.zoom} pitch ${c.pitch} bearing ${c.bearing} ${c.viewport.width}x${c.viewport.height}: extra ${extra.join(" ")} missing ${missing.join(" ")}`);
    }
  }
  assert.deepEqual(misses, [], `against MapLibre ${fixtures.maplibre}`);
});

test("the views cover flat, tilted past 60 degrees, the antimeridian and both source zoom limits", () => {
  const cases = fixtures.cases;
  assert.ok(cases.some((c) => c.pitch === 0));
  assert.ok(cases.filter((c) => variableZoom(c, c.viewport)).length >= 20, "views where distant tiles drop in zoom");
  assert.ok(cases.some((c) => c.tiles.some((t) => !t.endsWith("@0"))), "a view across the antimeridian");
  assert.ok(cases.some((c) => c.maxZoom === 9 && c.zoom > 10), "a source stretched past its top zoom");
  assert.ok(cases.some((c) => new Set(c.tiles.map((t) => t.split("/")[0])).size > 2), "a view with three or more tile zooms");
});

test("a flat view takes the tiles of floor(zoom) under the frame", () => {
  // Dhaka at zoom 12.5, 1920 x 1080: a zoom 12 tile is 724 px wide there, so 2.65 x 1.5 tiles.
  const tiles = coveringTiles({ center: { lng: 90.4, lat: 23.78 }, zoom: 12.5, bearing: 0, pitch: 0 }, { width: 1920, height: 1080 }, { maxZoom: 15 });
  assert.ok(tiles.every((t) => t.z === 12 && t.wrap === 0));
  const xs = new Set(tiles.map((t) => t.x));
  const ys = new Set(tiles.map((t) => t.y));
  assert.ok(xs.size >= 3 && xs.size <= 4 && ys.size >= 2 && ys.size <= 3, `${xs.size} x ${ys.size}`);
  // Past the source's top zoom the same tiles of that zoom are used.
  const stretched = coveringTiles({ center: { lng: 90.4, lat: 23.78 }, zoom: 12.5, bearing: 0, pitch: 0 }, { width: 1920, height: 1080 }, { maxZoom: 9 });
  assert.ok(stretched.every((t) => t.z === 9));
  assert.ok(stretched.length <= 2);
});

test("3D terrain lowers the zoom of distant tiles even below 60 degrees", () => {
  const view = { center: { lng: 86.92, lat: 27.99 }, zoom: 11, bearing: 0, pitch: 45 };
  const flat = coveringTiles(view, { width: 1920, height: 1080 }, { maxZoom: 15 });
  const terrain = coveringTiles(view, { width: 1920, height: 1080 }, { maxZoom: 15, terrain: true });
  assert.ok(flat.every((t) => t.z === 11));
  assert.ok(new Set(terrain.map((t) => t.z)).size >= 2);
});

test("a ring adds the neighbours of each tile and wraps round the world", () => {
  const ring = withRing([{ z: 3, x: 0, y: 0 }]);
  assert.equal(ring.length, 6, "no row above the pole");
  assert.ok(ring.some((t) => t.x === 7 && t.y === 1), "the neighbour across the antimeridian");
  assert.deepEqual(parseTileKey("14/12345/6789"), { z: 14, x: 12345, y: 6789 });
});
