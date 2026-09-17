import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_ID_PREFIX, POINTS_PER_UNIT, boundaryRecords, buildBoundarySet, isoOfCountry } from "../../src/core/data/boundarySet.ts";
import { buildPlaceIndex, searchPlaces } from "../../src/core/search/placeSearch.ts";
import { normaliseHighlights } from "../../src/core/style/highlights.ts";

const meta = { iso: "BGD", country: "BGD", countryName: "Bangladesh", level: "ADM2" as const, unit: "district", source: "Test bureau", license: "CC BY 4.0", licenseSource: "example.org", downloaded: "2026-09-18" };

/** Two neighbours whose shared border wiggles with a thousand points (the same points in both, reversed). */
function neighbours() {
  const border: number[][] = [];
  for (let i = 0; i <= 1000; i++) border.push([90 + Math.sin(i / 25) * 0.02 + Math.sin(i / 3) * 0.002, 23 + i * 0.001]);
  const left = [[89, 23], ...border.map((p) => p.slice()), [89, 24], [89, 23]];
  const right = [[91, 23], [91, 24], ...border.slice().reverse().map((p) => p.slice()), [91, 23]];
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { shapeName: "Westside", shapeID: "111B-22" }, geometry: { type: "Polygon", coordinates: [left] } },
      { type: "Feature", properties: { shapeName: "Eastside", shapeID: "111B-23" }, geometry: { type: "MultiPolygon", coordinates: [[right], [[[95, 20], [95.01, 20], [95.01, 20.01], [95, 20.01], [95, 20]]]] } },
      { type: "Feature", properties: { shapeName: "A point" }, geometry: { type: "Point", coordinates: [90, 23] } }
    ]
  };
}

test("a downloaded set is thinned together: neighbours keep one and the same border", () => {
  const { info, features } = buildBoundarySet(neighbours(), meta);
  assert.deepEqual(
    features.map((f) => f.name),
    ["Westside", "Eastside"]
  );
  assert.deepEqual(
    features.map((f) => f.id),
    [`${BOUNDARY_ID_PREFIX}bgd111b22`, `${BOUNDARY_ID_PREFIX}bgd111b23`]
  );
  const points = features.reduce((n, f) => n + f.polygons.reduce((m, polygon) => m + polygon[0].length, 0), 0);
  assert.ok(points <= 2 * POINTS_PER_UNIT * 1.2, `${points} points kept`);

  // Every point of the wiggling border that the west keeps, the east keeps too.
  const key = (p: number[]) => `${p[0]},${p[1]}`;
  const onBorder = (p: number[]) => p[0] > 89.9 && p[0] < 90.1;
  const westBorder = features[0].polygons[0][0].filter(onBorder).map(key);
  const eastBorder = new Set(features[1].polygons[0][0].filter(onBorder).map(key));
  assert.ok(westBorder.length > 10, `${westBorder.length} border points`);
  for (const p of westBorder) assert.ok(eastBorder.has(p), `border point ${p} is missing on the other side`);

  // The label point and bounds come from the largest polygon, not from the far island.
  const east = info.units[1];
  assert.ok(east.lng > 90 && east.lng < 91 && east.lat > 23 && east.lat < 24, JSON.stringify(east));
  assert.deepEqual(info.units[0].b, [89, 23, 90.02, 24]);
  assert.equal(info.license, "CC BY 4.0");
  // Ids fit a highlight code (at most 24 characters) even for geoBoundaries' long ids.
  const long = buildBoundarySet({ type: "FeatureCollection", features: [{ ...neighbours().features[0], properties: { shapeName: "Long", shapeID: "16705992B77600989823530" } }] }, meta);
  assert.equal(long.features[0].id, "gbbgd77600989823530");
  assert.ok(normaliseHighlights([{ code: `area:${long.features[0].id}`, name: "Long" }]).length === 1);
});

test("downloaded districts are found by search, under provinces of the same name", () => {
  const { info } = buildBoundarySet(neighbours(), meta);
  const index = buildPlaceIndex({
    countries: [{ id: "c:BGD", kind: "country", lat: 24, lng: 90, country: "BGD", rank: 2, population: 17e7, names: { en: "Bangladesh" } }],
    provinces: [{ id: "province:bgd1", kind: "province", lat: 23, lng: 90, country: "BGD", region: "Division", rank: 4, population: 0, names: { en: "Westside" } }],
    districts: boundaryRecords(info),
    places: []
  });
  const results = searchPlaces(index, "westside");
  assert.deepEqual(
    results.map((r) => r.kind),
    ["province", "district"]
  );
  assert.equal(results[1].adm1, `${BOUNDARY_ID_PREFIX}bgd111b22`);
  assert.equal(results[1].detail, "District, Bangladesh");
  assert.deepEqual(results[1].bbox, { west: 89, south: 23, east: 90.02, north: 24 });
});

test("files without areas are refused, and country codes map to ISO", () => {
  assert.throws(() => buildBoundarySet({ type: "FeatureCollection", features: [] }, meta), /no areas/);
  assert.throws(() => buildBoundarySet("nonsense", meta), /no areas/);
  assert.equal(isoOfCountry("BGD", "BGD"), "BGD");
  assert.equal(isoOfCountry("FRA", "-99"), "FRA");
  assert.equal(isoOfCountry("KOS", "-99"), "XKX");
  assert.equal(isoOfCountry("SDS", undefined), "SSD");
});
