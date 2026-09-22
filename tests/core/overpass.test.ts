import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleRings, kindOf, osmFeatures, osmGeoJson, overpassQuery, polygonsFrom, type OsmBbox } from "../../src/core/data/overpass.ts";
import { importGeoJson } from "../../src/core/data/importLines.ts";

const bbox: OsmBbox = [45.8, 9.0, 46.2, 9.4];

test("the query asks for what the user typed, in the area the preview shows", () => {
  const query = overpassQuery({ text: "Lake Como", kind: "water", bbox, limit: 30 });
  assert.match(query, /^\[out:json\]\[timeout:25\];/);
  assert.match(query, /\["natural"="water"\]\["name"~"Lake Como",i\]\(45\.8,9,46\.2,9\.4\);/);
  assert.match(query, /out geom 30;$/);
  // Every kind filter is asked for, as way and as relation.
  assert.equal((query.match(/^ {2}way/gm) ?? []).length, 3);
  assert.equal((query.match(/^ {2}relation/gm) ?? []).length, 3);
  assert.equal((query.match(/^ {2}node/gm) ?? []).length, 3, "a named lake can be a single point");
});

test("a name cannot break out of the query, and a nameless search still works", () => {
  const query = overpassQuery({ text: 'x"]["highway"~".*', kind: "island", bbox });
  assert.ok(!query.includes('"]["highway"'), query);
  assert.ok(query.includes(String.raw`["name"~"x\"\]\[\"highway\"~\"\.\*",i]`), query);
  // Roads are never a single node, and nothing is asked for without a name or a kind.
  assert.ok(!overpassQuery({ text: "", kind: "road", bbox }).includes("node"));
  assert.throws(() => overpassQuery({ text: "  ", kind: "any", bbox }), /type a name/);
  assert.match(overpassQuery({ text: "", kind: "building", bbox, limit: 9000 }), /out geom 500;/);
});

test("rings are built from parts that arrive in any order or direction", () => {
  const a = [[0, 0], [10, 0]];
  const b = [[10, 10], [10, 0]];
  const c = [[10, 10], [0, 10]];
  const d = [[0, 10], [0, 0]];
  const rings = assembleRings([a, c, b, d]);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0][0], rings[0][rings[0].length - 1], "the ring closes");
  assert.equal(rings[0].length, 5);
  // A part that never closes is kept as it is: half a coastline still draws.
  const open = assembleRings([[[0, 0], [1, 1], [2, 0]]]);
  assert.equal(open.length, 1);
  assert.equal(open[0].length, 3);
});

test("a hole goes into the outer ring that holds it", () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const far = [[100, 100], [110, 100], [110, 110], [100, 100]];
  const hole = [[2, 2], [4, 2], [4, 4], [2, 2]];
  const polygons = polygonsFrom([outer, far], [hole]);
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].length, 2, "the hole is in the ring around it");
  assert.equal(polygons[1].length, 1);
});

const answer = {
  elements: [
    { type: "node", id: 1, lat: 46.0, lon: 9.2, tags: { name: "Bellagio", place: "village" } },
    { type: "node", id: 2, lat: 46.1, lon: 9.3, tags: { amenity: "bench" } },
    { type: "way", id: 10, tags: { name: "Adda", waterway: "river" }, geometry: [{ lat: 46, lon: 9 }, { lat: 46.1, lon: 9.1 }, { lat: 46.2, lon: 9.2 }] },
    {
      type: "way",
      id: 11,
      tags: { name: "Lake Como", natural: "water", water: "lake" },
      geometry: [{ lat: 46, lon: 9 }, { lat: 46, lon: 9.1 }, { lat: 46.1, lon: 9.1 }, { lat: 46, lon: 9 }]
    },
    {
      type: "relation",
      id: 20,
      tags: { name: "Lake Como", natural: "water", water: "lake" },
      members: [
        { type: "way", role: "outer", geometry: [{ lat: 45.9, lon: 8.9 }, { lat: 45.9, lon: 9.3 }] },
        { type: "way", role: "outer", geometry: [{ lat: 46.3, lon: 9.3 }, { lat: 45.9, lon: 9.3 }] },
        { type: "way", role: "outer", geometry: [{ lat: 46.3, lon: 9.3 }, { lat: 46.3, lon: 8.9 }, { lat: 45.9, lon: 8.9 }] },
        { type: "way", role: "inner", geometry: [{ lat: 46.0, lon: 9.0 }, { lat: 46.0, lon: 9.1 }, { lat: 46.1, lon: 9.1 }, { lat: 46.0, lon: 9.0 }] }
      ]
    }
  ]
};

test("nodes, ways and relations become features, and the richer copy of a name wins", () => {
  const features = osmFeatures(answer);
  assert.deepEqual(features.map((f) => `${f.name} ${f.kind} ${f.geometry.type}`), ["Lake Como Lake MultiPolygon", "Adda River LineString", "Bellagio Village Point"]);
  assert.equal(features.find((f) => f.name === "Lake Como")?.id, "relation/20", "the relation holds more than the single way");
  const lake = features[0].geometry.coordinates as number[][][][];
  assert.equal(lake.length, 1);
  assert.equal(lake[0].length, 2, "the island in the lake is a hole");
  assert.equal(osmFeatures({ elements: [{ type: "node", id: 3, lat: 1, lon: 1 }] }).length, 0, "a feature without a name is not offered");
});

test("what Overpass sends can be imported like any other GeoJSON", () => {
  const imported = importGeoJson(osmGeoJson(osmFeatures(answer)), "OpenStreetMap");
  assert.deepEqual(imported.areas.map((area) => area.name), ["Lake Como"]);
  // An area also arrives as a closed line, so its outline can be drawn on as a route.
  assert.deepEqual(imported.lines.map((line) => line.name), ["Lake Como", "Adda"]);
  assert.deepEqual(imported.places.map((place) => place.name), ["Bellagio"]);
  assert.ok(imported.areas[0].points > 4);
});

test("the word for what a feature is comes from the tags people use", () => {
  assert.equal(kindOf({ boundary: "administrative", admin_level: "6" }), "Boundary level 6");
  assert.equal(kindOf({ building: "yes" }), "Building");
  assert.equal(kindOf({ leisure: "nature_reserve" }), "Nature reserve");
  assert.equal(kindOf({}), "Feature");
});
