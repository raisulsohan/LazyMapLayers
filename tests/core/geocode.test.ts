import { strict as assert } from "node:assert";
import test from "node:test";
import { nominatimResults, nominatimUrl, zoomForRank } from "../../src/core/search/geocode.ts";

test("the search address carries the words, the language, and the view as a preference", () => {
  const url = new URL(nominatimUrl("  Rue de Rivoli, Paris ", { language: "fr", near: { west: 2.2, south: 48.8, east: 2.4, north: 48.9 } }));
  assert.equal(url.origin + url.pathname, "https://nominatim.openstreetmap.org/search");
  assert.equal(url.searchParams.get("q"), "Rue de Rivoli, Paris");
  assert.equal(url.searchParams.get("format"), "jsonv2");
  assert.equal(url.searchParams.get("accept-language"), "fr");
  assert.equal(url.searchParams.get("viewbox"), "2.20000,48.90000,2.40000,48.80000");
  assert.equal(url.searchParams.get("bounded"), null, "the view is a preference, not a fence");
});

test("an answer becomes results: a name, what it is, where, and how close to fly", () => {
  const results = nominatimResults([
    { osm_type: "way", osm_id: 4079739, lat: "48.8600", lon: "2.3400", name: "Rue de Rivoli", display_name: "Rue de Rivoli, Quartier des Halles, Paris, Île-de-France, France", addresstype: "road", place_rank: 26, boundingbox: ["48.8557", "48.8641", "2.3289", "2.3622"] },
    { osm_type: "node", osm_id: 1, lat: "23.7806", lon: "90.4193", name: "", display_name: "Gulshan 2 Circle, Gulshan, Dhaka, Bangladesh", addresstype: "square", place_rank: 25, boundingbox: ["23.7805", "23.7807", "90.4192", "90.4194"] },
    { lat: "nope", lon: "2" }
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].kind, "address");
  assert.equal(results[0].name, "Rue de Rivoli");
  assert.equal(results[0].detail, "Road · Quartier des Halles, Paris, Île-de-France");
  assert.ok(results[0].bbox && results[0].bbox.west < results[0].bbox.east, "a street has a box to frame");
  assert.equal(results[1].name, "Gulshan 2 Circle", "without a name, the first part of the address names it");
  assert.equal(results[1].bbox, undefined, "a box the size of a square frames nothing");
  assert.equal(results[1].zoom, 15.5);
});

test("a building flies closer than a street, a street closer than a town", () => {
  assert.ok(zoomForRank(30) > zoomForRank(26));
  assert.ok(zoomForRank(26) > zoomForRank(16));
  assert.equal(zoomForRank(undefined), 14);
  assert.deepEqual(nominatimResults({ error: "bad" }), []);
});

test("the pieces of one street are one result", () => {
  const piece = (lat: string, lon: string, id: number) => ({ osm_type: "way", osm_id: id, lat, lon, name: "Rue de Rivoli", display_name: "Rue de Rivoli, Paris, France", addresstype: "road", place_rank: 26 });
  const results = nominatimResults([piece("48.8643", "2.3305", 1), piece("48.8659", "2.3254", 2), piece("48.8557", "2.3590", 3), { ...piece("45.76", "4.83", 4), display_name: "Rue de Rivoli, Lyon, France" }]);
  assert.equal(results.length, 2);
});
