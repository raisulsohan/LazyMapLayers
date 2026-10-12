import { test } from "node:test";
import assert from "node:assert/strict";
import { flyPath } from "../../src/core/camera/flyPath.ts";
import type { View } from "../../src/core/camera/camera.ts";
import { parseTileKey } from "../../src/core/tiles/coveringTiles.ts";
import { STREET_FADE, STREET_MAX_ZOOM, WORLD_DETAIL_MAX_ZOOM, allNeeds, describeFrames, detailLevels, frameRanges, framesNeeds, lackingFrames, sourceZooms, type DetailSource } from "../../src/core/tiles/streetDetail.ts";

const hd = { width: 1920, height: 1080 };
const sources: DetailSource[] = [
  { id: "world", fromZoom: 6, maxZoom: WORLD_DETAIL_MAX_ZOOM },
  { id: "streets", fromZoom: STREET_FADE.from, maxZoom: STREET_MAX_ZOOM }
];

/** A 10-second fly-to at 25 fps from Bangladesh at zoom 4 into Dhaka's streets at zoom 15, tilted at the end. */
function flyTo(): View[][] {
  const path = flyPath({ center: { lng: 90.3, lat: 23.7 }, zoom: 4, bearing: 0, pitch: 0 }, { center: { lng: 90.4125, lat: 23.7925 }, zoom: 15, bearing: 30, pitch: 50 }, hd);
  return Array.from({ length: 250 }, (_, i) => [path.at(i / 249)]);
}

test("a fly-to needs no tiles out where only the world map draws, world tiles in the middle and streets at the end", () => {
  const frames = flyTo();
  const needs = framesNeeds(frames, hd, sources);
  assert.equal(needs.length, 250);
  frames.forEach((samples, i) => {
    const zoom = samples[0].zoom;
    const zooms = new Set(needs[i].map((key) => parseTileKey(key).z));
    if (zoom < 6) assert.equal(needs[i].length, 0, `frame ${i} at zoom ${zoom.toFixed(2)}`);
    else if (zoom < STREET_FADE.from) assert.deepEqual([...zooms], [Math.floor(zoom)], `frame ${i}`);
    else {
      // The world detail stays at its top zoom under the streets, which take floor(zoom).
      assert.ok(zooms.has(WORLD_DETAIL_MAX_ZOOM), `frame ${i}`);
      assert.ok(zooms.has(Math.min(STREET_MAX_ZOOM, Math.floor(zoom))), `frame ${i}`);
    }
  });
  const last = needs[249].map(parseTileKey);
  assert.ok(last.some((t) => t.z === 15), "street level at the end");
  const all = allNeeds(needs);
  assert.ok(all.length > 50 && all.length < 1500, `${all.length} tiles for the whole move`);
});

test("with the world to zoom 6 installed, the frames past zoom 6 lack tiles until they are fetched", () => {
  const frames = flyTo();
  const needs = framesNeeds(frames, hd, sources);
  const lightInstall = (key: string) => parseTileKey(key).z <= 6;
  const lacking = lackingFrames(needs, lightInstall);
  const firstPastSix = frames.findIndex((samples) => samples[0].zoom >= 7);
  assert.ok(lacking.length > 0 && lacking[0] <= firstPastSix, `first lacking ${lacking[0]}, first past zoom 7 ${firstPastSix}`);
  assert.ok(lacking.every((frame) => frames[frame][0].zoom >= 7), "a frame below zoom 7 only needs zoom 6 tiles");
  // Once every tile is here, no frame lacks one.
  const fetched = new Set(allNeeds(needs));
  assert.deepEqual(lackingFrames(needs, (key) => fetched.has(key)), []);
  // A full install lacks only the streets.
  const fullInstall = (key: string) => parseTileKey(key).z <= WORLD_DETAIL_MAX_ZOOM;
  assert.ok(lackingFrames(needs, fullInstall).every((frame) => frames[frame][0].zoom >= 10));
});

test("a frame lacking its streets keeps the world detail this computer holds", () => {
  const frames = flyTo();
  const world = framesNeeds(frames, hd, [sources[0]]);
  const streets = framesNeeds(frames, hd, [sources[1]]);
  // A light install whose cache holds the world's zooms 7 to 9 but no streets.
  const levels = detailLevels(world, streets, (key) => parseTileKey(key).z <= WORLD_DETAIL_MAX_ZOOM);
  frames.forEach((samples, i) => {
    const zoom = samples[0].zoom;
    // Zoom 9 tiles serve the streets up to zoom 10.
    assert.equal(levels[i], zoom < 10 ? "full" : "world", `frame ${i} at zoom ${zoom.toFixed(2)}`);
  });
  // With only the light pack, past zoom 7 nothing but the pack is here.
  const bare = detailLevels(world, streets, (key) => parseTileKey(key).z <= 6);
  frames.forEach((samples, i) => assert.equal(bare[i], samples[0].zoom < 7 ? "full" : "installed", `frame ${i}`));
});

test("motion blur samples add the tiles of every sample", () => {
  const a: View = { center: { lng: 90.4, lat: 23.79 }, zoom: 14.2, bearing: 0, pitch: 0 };
  const b: View = { ...a, center: { lng: 90.43, lat: 23.79 } };
  const [one] = framesNeeds([[a]], hd, sources);
  const [both] = framesNeeds([[a, b]], hd, sources);
  assert.ok(both.length > one.length);
  assert.ok(one.every((key) => both.includes(key)));
});

test("a globe below zoom 8 and 3D terrain take a ring of tiles more", () => {
  const view: View = { center: { lng: 86.92, lat: 27.99 }, zoom: 7.4, bearing: 0, pitch: 30 };
  const [flat] = framesNeeds([[view]], hd, sources);
  const [globe] = framesNeeds([[view]], hd, sources, { projection: "globe" });
  const [terrain] = framesNeeds([[view]], hd, sources, { terrain: true });
  assert.ok(globe.length > flat.length && flat.every((key) => globe.includes(key)));
  assert.ok(terrain.length > flat.length);
  // Past zoom 8 the globe is the flat map.
  const near: View = { ...view, zoom: 8.5 };
  assert.deepEqual(framesNeeds([[near]], hd, sources, { projection: "globe" }), framesNeeds([[near]], hd, sources));
});

test("frames are named in runs, numbered as After Effects counts them, with their seconds", () => {
  assert.deepEqual(frameRanges([5, 3, 4, 9, 10, 4]), [{ from: 3, to: 5 }, { from: 9, to: 10 }]);
  assert.equal(describeFrames([150, 151, 152], 25), "frames 151-153 (6.0-6.1 s)");
  assert.equal(describeFrames(Array.from({ length: 100 }, (_, i) => 150 + i), 25), "frames 151-250 (6.0-10.0 s)");
  assert.equal(describeFrames([0, 10, 11], 25), "frame 1 (0.0 s) and frames 11-12 (0.4-0.5 s)");
  assert.equal(describeFrames([1, 3, 5, 7, 9, 11], 25, 2), "frame 2 (0.0 s), frame 4 (0.1 s) and 4 more");
  assert.equal(describeFrames([], 25), "no frames");
});

test("a source's zooms are read from the layers that draw from it", () => {
  const layers = [
    { source: "osm-world", minzoom: 6, maxzoom: 9.8 },
    { source: "osm-world", minzoom: 7.5 },
    { source: "natural-earth" },
    { source: "osm-streets", minzoom: 9 }
  ];
  assert.deepEqual(sourceZooms(layers, "osm-world"), { fromZoom: 6, untilZoom: 24 });
  assert.deepEqual(sourceZooms(layers, "osm-streets"), { fromZoom: 9, untilZoom: 24 });
  assert.equal(sourceZooms(layers, "nothing"), null);
});
