import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeoJson, pointsFromExpression } from "../../src/core/data/geoJsonExport.ts";
import { routePathExpression } from "../../src/core/ae/labelExpressions.ts";
import { shapePathExpressions, shapeRings } from "../../src/core/ae/shapeExpressions.ts";
import { cometTailKeys } from "../../src/core/ae/trimKeys.ts";

test("the points come back out of a generated path expression", () => {
  const points = [
    [23.8, 90.4, 0, 0],
    [24.9, 91.87, 0, 12.5],
    [25.7, 89.25, 0, 0]
  ];
  const read = pointsFromExpression(routePathExpression(points));
  assert.equal(read?.length, 3);
  assert.deepEqual(read?.[1].slice(0, 2), [24.9, 91.87]);
  assert.equal(pointsFromExpression("value"), null, "a hand-written expression gives nothing");
  assert.equal(pointsFromExpression("var pts = [[1,2]];"), null, "one point is not a line");
});

test("pins, routes, outlines and callouts become a FeatureCollection", () => {
  const square = [
    [90, 23],
    [91, 23],
    [91, 24],
    [90, 24],
    [90, 23]
  ];
  const outline = shapePathExpressions(shapeRings([[square, square.map(([lng, lat]) => [lng + 0.2, lat + 0.2])]]));
  const { geojson, skipped } = buildGeoJson(
    [
      { kind: "pin", name: "Pin 1", lat: 23.8, lng: 90.4 },
      { kind: "attached", name: "My icon", lat: 24, lng: 90 },
      { kind: "callout", name: "Callout box: Dhaka", lat: 23.8, lng: 90.4 },
      { kind: "callout", name: "Callout title: Dhaka", lat: 23.8, lng: 90.4 },
      { kind: "callout", name: "Callout leader: Dhaka", lat: 23.8, lng: 90.4 },
      {
        kind: "route",
        name: "Route: flight",
        paths: [
          routePathExpression([
            [23.8, 90.4, 0, 0],
            [51.5, -0.1, 0, 0]
          ])
        ]
      },
      { kind: "feature", name: "Shape: Bangladesh", paths: outline },
      { kind: "route", name: "Route: edited by hand", paths: ["createPath(value)"] }
    ],
    [{ name: "Delta", polygons: [[square]] }],
    "Dhaka Map"
  );
  assert.equal(skipped, 1, "the hand-edited route has no points left");
  const kinds = geojson.features.map((f) => `${f.properties!.kind}:${f.geometry.type}`);
  assert.deepEqual(kinds, ["pin:Point", "attached:Point", "callout:Point", "route:LineString", "feature:MultiPolygon", "highlight:MultiPolygon"]);
  const pin = geojson.features[0];
  assert.deepEqual(pin.geometry.type === "Point" && pin.geometry.coordinates, [90.4, 23.8], "GeoJSON is longitude first");
  assert.equal(geojson.features[2].properties!.name, "Dhaka", "one point for the three callout layers");
  const route = geojson.features[3];
  assert.ok(route.geometry.type === "LineString" && route.geometry.coordinates.length >= 2);
  const shape = geojson.features[4];
  if (shape.geometry.type !== "MultiPolygon") throw new Error("the outline should be a MultiPolygon");
  assert.equal(shape.geometry.coordinates.length, 2, "the ring and its hole");
  for (const polygon of shape.geometry.coordinates) {
    const ring = polygon[0];
    assert.deepEqual(ring[0], ring[ring.length - 1], "rings close again");
  }
});

test("a comet trails the head of its line by a fixed share", () => {
  assert.deepEqual(
    cometTailKeys([
      [0, 0],
      [50, 50],
      [100, 100]
    ]),
    [
      [0, 0],
      [50, 38],
      [100, 88]
    ]
  );
  assert.deepEqual(cometTailKeys([[0, 5]], 12), [[0, 0]], "the tail never runs past the start");
});
