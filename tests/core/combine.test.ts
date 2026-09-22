import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { areaKm2, centreOf, circleAround, cleanPolygons, combinedName, growArea, mergeAreas, type Polygons } from "../../src/core/geo/combine.ts";
import { simplifyPolygons } from "../../src/core/geo/simplify.ts";
import { AREA_MAX_POINTS } from "../../src/core/style/highlights.ts";

const square = (west: number, south: number, size: number): Polygons => [
  [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south]
    ]
  ]
];

const root = path.resolve(import.meta.dirname, "..", "..");
const provincesOf = (country: string) => (JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "admin1", `${country}.json`), "utf8")) as { features: { id: string; name: string; polygons: Polygons }[] }).features;
const countryOutline = (code: string) => (JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "countries", `${code}.json`), "utf8")) as { name: string; polygons: Polygons }).polygons;
const rings = (polygons: Polygons) => polygons.reduce((total, polygon) => total + polygon.length, 0);
const points = (polygons: Polygons) => polygons.reduce((total, polygon) => total + polygon.reduce((n, ring) => n + ring.length, 0), 0);

test("squares that touch become one outline, squares apart stay apart", () => {
  const joined = mergeAreas([square(0, 0, 1), square(1, 0, 1)]);
  assert.equal(joined.length, 1, "one polygon");
  assert.equal(rings(joined), 1, "and no hole where the border was");
  assert.equal(points(joined), 5, "a 2 by 1 rectangle");
  const apart = mergeAreas([square(0, 0, 1), square(5, 5, 1)]);
  assert.equal(apart.length, 2);
  assert.equal(mergeAreas([]).length, 0);
  assert.deepEqual(mergeAreas([square(0, 0, 1)]), square(0, 0, 1), "one outline is left as it is");
});

test("a hole survives a merge, and rubbish is dropped", () => {
  const withHole: Polygons = [[square(0, 0, 10)[0][0], square(4, 4, 2)[0][0]]];
  const merged = mergeAreas([withHole, square(20, 20, 1)]);
  assert.equal(merged.length, 2);
  assert.equal(rings(merged), 3, "the hole is still there");
  assert.deepEqual(cleanPolygons([[[[0, 0], [1, 1]]], [], [[[0, 0], [1, 0], [1, 1], [0, 0]]]]).length, 1, "a ring needs four points");
  assert.deepEqual(cleanPolygons([[[[0, 0], [1, 0], [Number.NaN, 1], [0, 0]]]]), [], "a ring with a broken point is not geometry");
});

test("the area on the globe is right", () => {
  // A degree square on the equator, with great circles for edges, is about 12,364 km2.
  assert.ok(Math.abs(areaKm2(square(0, 0, 1)) - 12364) < 30, String(areaKm2(square(0, 0, 1))));
  // The same square with a quarter taken out of it.
  const withHole: Polygons = [[square(0, 0, 1)[0][0], square(0.25, 0.25, 0.5)[0][0]]];
  assert.ok(Math.abs(areaKm2(withHole) - 12364 * 0.75) < 60, String(areaKm2(withHole)));
  assert.deepEqual(centreOf(square(2, 4, 2)), { lat: 5, lng: 3 });
  assert.equal(centreOf([]), null);
});

test("a circle around a place has the radius it says", () => {
  const circle = circleAround({ lat: 48.86, lng: 2.35 }, 50);
  assert.equal(circle.length, 1);
  // Pi r squared, give or take the corners of a 64-sided circle.
  assert.ok(Math.abs(areaKm2(circle) - Math.PI * 2500) / (Math.PI * 2500) < 0.01, String(areaKm2(circle)));
  assert.equal(circleAround({ lat: 1, lng: 1 }, 0).length, 0);
  assert.equal(circleAround({ lat: Number.NaN, lng: 1 }, 10).length, 0);
});

test("growing pushes the edge out by the distance, shrinking pulls it in", () => {
  const grown = growArea(square(0, 0, 1), 111.19);
  const centre = centreOf(grown)!;
  assert.ok(Math.abs(centre.lat - 0.5) < 0.01 && Math.abs(centre.lng - 0.5) < 0.01);
  // About a degree in every direction (a degree of latitude is 111.19 km).
  const north = Math.max(...grown[0][0].map((p) => p[1]));
  assert.ok(Math.abs(north - 2) < 0.05, `north edge at ${north}`);
  const shrunk = growArea(square(0, 0, 1), -55);
  assert.ok(areaKm2(shrunk) < areaKm2(square(0, 0, 1)) / 2, `${areaKm2(shrunk)} km2 left`);
  assert.equal(growArea(square(0, 0, 1), -500).length, 0, "shrinking past nothing leaves nothing");
  assert.deepEqual(growArea(square(0, 0, 1), 0), square(0, 0, 1));
});

test("real provinces merge into one outline with no borders and no slivers", () => {
  const wanted = ["Nord", "Ardennes", "Aisne", "Meuse", "Meurthe-et-Moselle", "Pas-de-Calais", "Somme", "Oise", "Marne"];
  const chosen = provincesOf("FRA").filter((province) => wanted.includes(province.name));
  assert.equal(chosen.length, wanted.length, "the province data has all of them");
  // As the panel keeps them: thinned, sharing their borders.
  const merged = mergeAreas(chosen.map((province) => simplifyPolygons(province.polygons, AREA_MAX_POINTS)));
  assert.equal(merged.length, 1, "nine provinces, one shape");
  assert.equal(rings(merged), 1, "no hole where a border was");
  const sum = chosen.reduce((total, province) => total + areaKm2(province.polygons), 0);
  assert.ok(Math.abs(areaKm2(merged) - sum) / sum < 0.02, `${areaKm2(merged)} km2 against ${sum} km2 apart`);
});

test("countries merge across their shared borders", () => {
  const codes = ["FRA", "BEL", "LUX", "DEU", "NLD"];
  const merged = mergeAreas(codes.map(countryOutline));
  const biggest = merged.map((polygon) => areaKm2([polygon])).sort((a, b) => b - a)[0];
  // France, Germany and the Benelux on the mainland are a little under a million km2 (Corsica and
  // the overseas parts of France are polygons of their own).
  assert.ok(biggest > 900000 && biggest < 1050000, `the mainland is ${biggest} km2`);
  // The islands and the overseas parts of France stay their own polygons, and none of them is a sliver.
  assert.ok(merged.length > 1);
  assert.equal(merged.filter((polygon) => areaKm2([polygon]) < 1).length, 0, "no slivers along the borders");
});

test("the name says what went in", () => {
  assert.equal(combinedName(["France", "Belgium"]), "France + Belgium");
  assert.equal(combinedName(["A", "B", "C", "D"]), "A + 3 more");
  assert.equal(combinedName([" ", ""]), "Combined area");
});
