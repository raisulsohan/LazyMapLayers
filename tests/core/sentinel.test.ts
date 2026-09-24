import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classIsClear,
  estimateBytes,
  latOfTileRow,
  pickScenes,
  pixelToSceneGrid,
  readSentinelScenes,
  sceneCovers,
  SCENE_CLASSES,
  sentinelSearchBody,
  tileCorners,
  tileMetresPerPixel,
  tileOnSceneGrid,
  type SentinelScene
} from "../../src/core/imagery/sentinel.ts";
import { lngLatFromUtm } from "../../src/core/geo/utm.ts";

const DHAKA = { west: 90.33, south: 23.68, east: 90.5, north: 23.85 };

test("the search asks the open catalogue for the clearest scenes over the area", () => {
  const body = sentinelSearchBody({ bbox: DHAKA, from: "2025-11-01T00:00:00Z", to: "2026-09-20T00:00:00Z", maxCloud: 5, limit: 20 }) as Record<string, any>;
  assert.deepEqual(body.collections, ["sentinel-2-l2a"]);
  assert.deepEqual(body.bbox, [90.33, 23.68, 90.5, 23.85]);
  assert.equal(body.datetime, "2025-11-01T00:00:00Z/2026-09-20T00:00:00Z");
  assert.equal(body.limit, 20);
  assert.deepEqual(body.query, { "eo:cloud_cover": { lt: 5 } });
  assert.equal(body.sortby[0].direction, "asc");
  // Nothing in the request names a user, a key or a token.
  assert.equal(JSON.stringify(body).toLowerCase().includes("key"), false);
  assert.equal((sentinelSearchBody({ bbox: DHAKA, from: "a", to: "b" }) as Record<string, any>).limit, 40);
});

/** An answer shaped as the catalogue writes them. */
const answer = {
  features: [
    {
      id: "S2A_45QZG_20251108_0_L2A",
      bbox: [89.9, 23.0, 91.0, 24.1],
      properties: { datetime: "2025-11-08T04:42:14Z", "eo:cloud_cover": 0.0007, "proj:epsg": 32645 },
      assets: {
        visual: { href: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/x/TCI.tif" },
        scl: { href: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/x/SCL.tif" }
      }
    },
    {
      id: "S2B_45QZG_20251203_0_L2A",
      bbox: [89.9, 23.0, 91.0, 24.1],
      properties: { datetime: "2025-12-03T04:42:10Z", "eo:cloud_cover": 3.4, "proj:epsg": 32645 },
      assets: { visual: { href: "https://example.invalid/TCI.tif" } }
    },
    { id: "no-visual", properties: { datetime: "2025-12-04T00:00:00Z" }, assets: {} }
  ]
};

test("scenes are read with their date, cloud, grid and pictures", () => {
  const scenes = readSentinelScenes(answer);
  assert.equal(scenes.length, 2, "a scene without a true-colour picture is no use");
  assert.equal(scenes[0].id, "S2A_45QZG_20251108_0_L2A");
  assert.equal(scenes[0].cloud, 0.0007);
  assert.equal(scenes[0].epsg, 32645);
  assert.deepEqual(scenes[0].grid, { zone: 45, north: true });
  assert.ok(scenes[0].visual.endsWith("TCI.tif"));
  assert.ok(scenes[0].classification?.endsWith("SCL.tif"));
  assert.equal(scenes[1].classification, null);
  assert.deepEqual(readSentinelScenes({}), []);
  assert.deepEqual(readSentinelScenes(null), []);
});

test("only scenes that cover the area are picked, clearest day first", () => {
  const scenes = readSentinelScenes(answer);
  assert.equal(sceneCovers(scenes[0], DHAKA), true);
  assert.equal(sceneCovers({ ...scenes[0], bbox: { west: 0, south: 0, east: 1, north: 1 } }, DHAKA), false);
  const picked = pickScenes(scenes, DHAKA, 2);
  assert.deepEqual(picked.map((scene) => scene.id), ["S2A_45QZG_20251108_0_L2A", "S2B_45QZG_20251203_0_L2A"]);
  assert.equal(pickScenes(scenes, DHAKA, 1).length, 1, "one try keeps one day");
  // Two scenes of the same day sit side by side, so both are kept as one try.
  const sameDay = [scenes[0], { ...scenes[0], id: "next-along", cloud: 0.2 }];
  assert.equal(pickScenes(sameDay, DHAKA, 1).length, 2);
  // A scene on a grid this cannot work on is left out.
  assert.equal(pickScenes([{ ...scenes[0], grid: null }] as SentinelScene[], DHAKA, 3).length, 0);
});

test("a map tile knows the ground it covers and how fine its pixels are", () => {
  // Zoom 0 is the whole world in one tile; at the equator each of its 256 pixels is 156 km.
  assert.ok(Math.abs(tileMetresPerPixel(0, 0, 256) - 156543) < 1);
  // Ten metres a pixel arrives at about zoom 14 at the equator.
  assert.ok(Math.abs(tileMetresPerPixel(14, 8192, 256) - 9.55) < 0.01);
  // Near Dhaka the same zoom is a little finer, because the world narrows.
  assert.ok(tileMetresPerPixel(14, 7150, 256) < 9.55);
  const corners = tileCorners(0, 0, 0);
  assert.ok(Math.abs(corners.west + 180) < 1e-9 && Math.abs(corners.east - 180) < 1e-9);
  assert.ok(Math.abs(corners.north - 85.0511287) < 1e-6 && Math.abs(corners.south + 85.0511287) < 1e-6);
  assert.ok(Math.abs(latOfTileRow(1, 1)) < 1e-9, "the line between the two rows of zoom 1 is the equator");
  assert.ok(Math.abs(latOfTileRow(0.5, 1) - 66.5132) < 1e-3, "and the middle of the top tile is two thirds of the way up");
});

test("a tile's pixels land on the scene's own grid, and come back to the same place", () => {
  const grid = { zone: 45, north: true };
  const z = 13;
  const x = 6047;
  const y = 3546;
  const box = tileOnSceneGrid(z, x, y, grid);
  assert.ok(box.east > box.west && box.north > box.south);
  const corners = tileCorners(z, x, y);
  // The corner pixel of the tile stands where the tile's own corner is.
  const topLeft = pixelToSceneGrid(z, x, y, 0, 0, 256, grid);
  const back = lngLatFromUtm(topLeft, grid);
  assert.ok(Math.abs(back.lng - corners.west) < 1e-8, `${back.lng} against ${corners.west}`);
  assert.ok(Math.abs(back.lat - corners.north) < 1e-8, `${back.lat} against ${corners.north}`);
  // And every pixel of the tile sits inside the rectangle the plan asks the scene for.
  for (const [px, py] of [[0, 0], [255, 0], [0, 255], [255, 255], [128, 128]]) {
    const point = pixelToSceneGrid(z, x, y, px, py, 256, grid);
    assert.ok(point.x >= box.west && point.x <= box.east && point.y >= box.south && point.y <= box.north, `pixel ${px},${py} at ${point.x},${point.y} is outside ${JSON.stringify(box)}`);
  }
});

test("cloud and its shadow are thrown away, ground and water kept", () => {
  assert.equal(classIsClear(SCENE_CLASSES.vegetation), true);
  assert.equal(classIsClear(SCENE_CLASSES.bare), true);
  assert.equal(classIsClear(SCENE_CLASSES.water), true);
  assert.equal(classIsClear(SCENE_CLASSES.cloudHigh), false);
  assert.equal(classIsClear(SCENE_CLASSES.cloudMedium), false);
  assert.equal(classIsClear(SCENE_CLASSES.cirrus), false);
  assert.equal(classIsClear(SCENE_CLASSES.cloudShadow), false);
  assert.equal(classIsClear(SCENE_CLASSES.snow), false);
  assert.equal(classIsClear(SCENE_CLASSES.noData), false);
});

test("the size a build will move is said before it starts", () => {
  const one = estimateBytes(20, 1);
  assert.ok(one > 5e6 && one < 12e6, `${one}`);
  assert.ok(estimateBytes(20, 3) > one, "more tries, more bytes");
  assert.equal(estimateBytes(0, 3), 0);
});
