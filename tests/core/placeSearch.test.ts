import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaceIndex, nameForView, parseCoordinates, searchPlaces, zoomForPlace, type PlaceRecord } from "../../src/core/search/placeSearch.ts";

const record = (extra: Partial<PlaceRecord> & { id: string; names: Record<string, string> }): PlaceRecord => ({ kind: "place", lat: 0, lng: 0, country: "XXX", rank: 5, population: 0, ...extra });

const index = buildPlaceIndex({
  countries: [
    record({ id: "c:FRA", kind: "country", country: "FRA", lat: 46.6, lng: 2.4, rank: 2, population: 67e6, bbox: [-4.8, 42.3, 8.2, 51.1], names: { en: "France", bn: "ফ্রান্স", ja: "フランス" } }),
    record({ id: "c:FJI", kind: "country", country: "FJI", lat: -17.8, lng: 178, rank: 5, population: 9e5, bbox: [177, -19, -178, -16], names: { en: "Fiji" } }),
    record({ id: "c:MCO", kind: "country", country: "MCO", lat: 43.74, lng: 7.42, rank: 6, population: 4e4, bbox: [7.4, 43.72, 7.44, 43.75], names: { en: "Monaco" } })
  ],
  places: [
    record({ id: "p:paris", country: "FRA", region: "Île-de-France", capital: true, lat: 48.8566, lng: 2.3522, rank: 0, population: 11e6, names: { en: "Paris", ru: "Париж", bn: "প্যারিস" } }),
    record({ id: "p:paris-tx", country: "USA", region: "Texas", lat: 33.66, lng: -95.55, rank: 8, population: 25000, names: { en: "Paris" } }),
    record({ id: "p:sao", country: "BRA", lat: -23.55, lng: -46.63, rank: 0, population: 22e6, names: { en: "São Paulo" } }),
    record({ id: "p:versailles", country: "FRA", region: "Île-de-France", lat: 48.8, lng: 2.13, rank: 7, population: 85000, names: { en: "Versailles" } }),
    record({ id: "p:comparis", country: "XXX", lat: 1, lng: 1, rank: 9, population: 100, names: { en: "Comparis" } })
  ]
});

test("coordinates are recognised in the usual spellings", () => {
  assert.deepEqual(parseCoordinates("48.85, 2.29"), { lat: 48.85, lng: 2.29 });
  assert.deepEqual(parseCoordinates(" -33.9;151.2 "), { lat: -33.9, lng: 151.2 });
  assert.deepEqual(parseCoordinates("33.9S 151.2E"), { lat: -33.9, lng: 151.2 });
  assert.deepEqual(parseCoordinates("40.7 N, 74 W"), { lat: 40.7, lng: -74 });
  assert.equal(parseCoordinates("95, 10"), null);
  assert.equal(parseCoordinates("Paris 12"), null);
  assert.equal(searchPlaces(index, "48.85, 2.29")[0].kind, "coordinates");
});

test("search ranks exact names, capitals and large places first", () => {
  const results = searchPlaces(index, "paris");
  assert.deepEqual(
    results.map((r) => r.id),
    ["p:paris", "p:paris-tx", "p:comparis"]
  );
  assert.equal(results[0].detail, "Île-de-France, France");
  assert.equal(searchPlaces(index, "fra")[0].id, "c:FRA");
  assert.deepEqual(searchPlaces(index, "fra")[0].bbox, { west: -4.8, south: 42.3, east: 8.2, north: 51.1 });
  assert.deepEqual(searchPlaces(index, "p"), [], "one letter is too short");
});

test("search works in any of the name languages and ignores accents", () => {
  const bengali = searchPlaces(index, "প্যারিস");
  assert.equal(bengali[0].id, "p:paris");
  assert.equal(bengali[0].matched, "প্যারিস");
  assert.equal(searchPlaces(index, "париж")[0].id, "p:paris");
  assert.equal(searchPlaces(index, "sao paulo")[0].id, "p:sao");
  assert.equal(searchPlaces(index, "フランス")[0].id, "c:FRA");
});

test("a view gets a name: the country from far, the nearest large place from near", () => {
  assert.equal(nameForView(index, { lat: 47, lng: 2 }, 4.5), "France");
  assert.equal(nameForView(index, { lat: 43.735, lng: 7.42 }, 5), "Monaco", "the smallest box wins");
  assert.equal(nameForView(index, { lat: -17.5, lng: -179 }, 5), "Fiji", "across the antimeridian");
  assert.equal(nameForView(index, { lat: 48.85, lng: 2.3 }, 12), "Paris");
  assert.equal(nameForView(index, { lat: 48.83, lng: 2.2 }, 10), "Paris", "the larger place in reach");
  assert.equal(nameForView(index, { lat: 48.8, lng: 2.13 }, 14), "Versailles");
  assert.equal(nameForView(index, { lat: 0, lng: -150 }, 8), null);
  assert.equal(nameForView(index, { lat: 20, lng: 0 }, 1.2), null);
  assert.equal(nameForView(index, { lat: 48.85, lng: 362.3 }, 12), "Paris", "unwrapped longitudes");
});

test("place zooms shrink with the population", () => {
  assert.ok(zoomForPlace(10e6) < zoomForPlace(3e5) && zoomForPlace(3e5) < zoomForPlace(1000));
});

test("provinces are found by any of their names and rank between countries and small places", () => {
  const withProvinces = buildPlaceIndex({
    countries: [record({ id: "c:BGD", kind: "country", country: "BGD", rank: 2, population: 17e7, names: { en: "Bangladesh" } })],
    provinces: [
      record({ id: "province:bgd1806", kind: "province", country: "BGD", region: "Division", lat: 23.9, lng: 90.3, rank: 4, bbox: [89.3, 22.9, 91.2, 25.2], names: { en: "Dhaka", bn: "ঢাকা বিভাগ" } }),
      record({ id: "province:usa3521", kind: "province", country: "USA", region: "State", rank: 4, names: { en: "California" } })
    ],
    places: [
      record({ id: "p:dhaka", country: "BGD", capital: true, rank: 0, population: 2e7, names: { en: "Dhaka", bn: "ঢাকা" } }),
      record({ id: "p:california-md", country: "USA", rank: 8, population: 12000, names: { en: "California" } })
    ]
  });
  const dhaka = searchPlaces(withProvinces, "dhaka");
  assert.deepEqual(
    dhaka.map((r) => r.id),
    ["p:dhaka", "province:bgd1806"]
  );
  assert.equal(dhaka[1].kind, "province");
  assert.equal(dhaka[1].adm1, "bgd1806");
  assert.equal(dhaka[1].code, "BGD");
  assert.equal(dhaka[1].detail, "Division, Bangladesh");
  assert.deepEqual(dhaka[1].bbox, { west: 89.3, south: 22.9, east: 91.2, north: 25.2 });
  assert.equal(dhaka[0].adm1, undefined);
  assert.equal(searchPlaces(withProvinces, "california")[0].id, "province:usa3521");
  assert.equal(searchPlaces(withProvinces, "ঢাকা বিভাগ")[0].id, "province:bgd1806");
});
