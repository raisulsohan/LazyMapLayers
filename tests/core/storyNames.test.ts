import { test } from "node:test";
import assert from "node:assert/strict";
import { kmBetween, namesToKeep, storyPlaces, type NamedPlace } from "../../src/core/labels/storyNames.ts";
import type { ExportLayer } from "../../src/core/data/geoJsonExport.ts";
import { routePathExpression } from "../../src/core/ae/labelExpressions.ts";

// A route layer as the panel makes it: its points baked into the path expression.
const route = (points: number[][]): ExportLayer => ({ kind: "route", name: "Paris to Tokyo", paths: [routePathExpression(points.map(([lat, lng]) => [lat, lng, 0, 0]))] });

const PARIS = { lat: 48.8566, lng: 2.3522 };
const TOKYO = { lat: 35.6895, lng: 139.6917 };

const names: NamedPlace[] = [
  { labelId: "place:paris", ...PARIS, tier: 0 },
  { labelId: "place:tokyo", ...TOKYO, tier: 0 },
  { labelId: "place:cairo", lat: 30.0444, lng: 31.2357, tier: 0 },
  { labelId: "place:london", lat: 51.5074, lng: -0.1278, tier: 0 },
  { labelId: "country:FRA", lat: 46.6, lng: 2.4, tier: 1 },
  { labelId: "country:JPN", lat: 36.5, lng: 138.3, tier: 1 },
  { labelId: "nature:ocean:atlantic", lat: 30, lng: -40, tier: 2 },
  // A district right beside the Eiffel Tower: closer than Paris, but a lower kind of name.
  { labelId: "local:7e", lat: 48.857, lng: 2.31, tier: 3 }
];

test("kmBetween: Paris to Tokyo is about 9,700 km, a place to itself 0", () => {
  assert.ok(Math.abs(kmBetween(PARIS, TOKYO) - 9713) < 30);
  assert.equal(kmBetween(PARIS, PARIS), 0);
});

test("storyPlaces: both ends of a route, pins and callouts, each place once", () => {
  const places = storyPlaces([
    route([[48.8566, 2.3522], [55, 60], [35.6895, 139.6917]]),
    { kind: "pin", name: "Pin: Eiffel Tower", lat: 48.8584, lng: 2.2945 },
    { kind: "callout", name: "Callout box: Paris", lat: 48.8566, lng: 2.3522 },
    { kind: "callout", name: "Callout title: Paris", lat: 48.8566, lng: 2.3522 },
    { kind: "feature", name: "France", paths: [] }
  ]);
  assert.deepEqual(places, [PARIS, TOKYO, { lat: 48.8584, lng: 2.2945 }]);
});

test("storyPlaces: a route whose expression was replaced by hand adds nothing", () => {
  assert.deepEqual(storyPlaces([{ kind: "route", name: "Mine", paths: ["value"] }]), []);
});

test("namesToKeep: the Paris to Tokyo flight keeps Paris and Tokyo, nothing else", () => {
  const places = storyPlaces([route([[48.8566, 2.3522], [35.6895, 139.6917]]), { kind: "pin", name: "Pin: Eiffel Tower", lat: 48.8584, lng: 2.2945 }]);
  assert.deepEqual([...namesToKeep(names, places)].sort(), ["place:paris", "place:tokyo"]);
});

test("namesToKeep: a city beats a closer name of a lower kind", () => {
  assert.deepEqual([...namesToKeep(names, [{ lat: 48.8584, lng: 2.2945 }])], ["place:paris"]);
});

test("namesToKeep: a place with no name near it keeps nothing; a lower kind serves when it is all there is", () => {
  assert.equal(namesToKeep(names, [{ lat: 0, lng: 0 }]).size, 0);
  assert.deepEqual([...namesToKeep(names, [{ lat: 46.5, lng: 2.5 }])], ["country:FRA"]);
});
