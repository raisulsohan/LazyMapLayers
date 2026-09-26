import { strict as assert } from "node:assert";
import test from "node:test";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { decodeTile, tilePointToLngLat } from "../../src/core/tiles/mvt.ts";

// One tile around Paris, encoded by the same packages that build the bundled world data.
const Z = 12;
const X = 2074;
const Y = 1409;

function encode(features: GeoJSON.Feature[], layer: string, extra: Record<string, GeoJSON.Feature[]> = {}) {
  const layers: Record<string, unknown> = {};
  for (const [name, list] of Object.entries({ [layer]: features, ...extra })) {
    const index = new GeoJSONVT({ type: "FeatureCollection", features: list } as GeoJSON.FeatureCollection, { maxZoom: 14, indexMaxZoom: 14, tolerance: 0, extent: 4096, buffer: 64 });
    layers[name] = index.getTile(Z, X, Y);
  }
  return fromGeojsonVt(layers as Parameters<typeof fromGeojsonVt>[0], { version: 2, extent: 4096 });
}

const toLngLat = (point: number[], extent: number) => tilePointToLngLat(Z, X, Y, extent, point[0], point[1]);

test("points, lines and properties of every kind come back as they went in", () => {
  const bytes = encode(
    [
      { type: "Feature", properties: { name: "Notre-Dame", kind: "attraction", min_zoom: 13, rank: -2, height: 69.5, open: true }, geometry: { type: "Point", coordinates: [2.3499, 48.853] } },
      { type: "Feature", properties: { name: "Seine", kind: "river" }, geometry: { type: "LineString", coordinates: [[2.33, 48.858], [2.34, 48.856], [2.35, 48.8535], [2.36, 48.851]] } }
    ],
    "pois"
  );
  const [layer] = decodeTile(bytes);
  assert.equal(layer.name, "pois");
  assert.equal(layer.extent, 4096);
  const poi = layer.features.find((f) => f.type === 1)!;
  assert.deepEqual(poi.properties, { name: "Notre-Dame", kind: "attraction", min_zoom: 13, rank: -2, height: 69.5, open: true });
  const [lng, lat] = toLngLat(poi.geometry[0][0], layer.extent);
  assert.ok(Math.abs(lng - 2.3499) < 1e-4 && Math.abs(lat - 48.853) < 1e-4, `${lng}, ${lat}`);
  const river = layer.features.find((f) => f.type === 2)!;
  assert.equal(river.properties.name, "Seine");
  assert.equal(river.geometry[0].length, 4);
  const last = toLngLat(river.geometry[0][3], layer.extent);
  assert.ok(Math.abs(last[0] - 2.36) < 1e-4 && Math.abs(last[1] - 48.851) < 1e-4);
});

test("a polygon with a hole keeps both rings, each closed", () => {
  const outer = [[2.33, 48.85], [2.37, 48.85], [2.37, 48.87], [2.33, 48.87], [2.33, 48.85]];
  const hole = [[2.345, 48.855], [2.345, 48.865], [2.355, 48.865], [2.355, 48.855], [2.345, 48.855]];
  const [layer] = decodeTile(encode([{ type: "Feature", properties: { name: "Park" }, geometry: { type: "Polygon", coordinates: [outer, hole] } }], "landuse"));
  const polygon = layer.features[0];
  assert.equal(polygon.type, 3);
  assert.equal(polygon.geometry.length, 2);
  for (const ring of polygon.geometry) assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("only the layers asked for are decoded", () => {
  const bytes = encode(
    [{ type: "Feature", properties: { name: "Marais" }, geometry: { type: "Point", coordinates: [2.36, 48.858] } }],
    "places",
    { buildings: [{ type: "Feature", properties: { height: 20 }, geometry: { type: "Polygon", coordinates: [[[2.34, 48.855], [2.341, 48.855], [2.341, 48.856], [2.34, 48.855]]] } }] }
  );
  assert.deepEqual(decodeTile(bytes).map((l) => l.name).sort(), ["buildings", "places"]);
  assert.deepEqual(decodeTile(bytes, ["places"]).map((l) => l.name), ["places"]);
});
