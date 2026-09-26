import { strict as assert } from "node:assert";
import test from "node:test";
import { cityClassOf, cityRecords, namesOf, type CityFeature } from "../../src/core/labels/cityNames.ts";
import { featureClassOf } from "../../src/core/labels/nature.ts";

const point = (layer: string, properties: Record<string, string | number | boolean>, lng: number, lat: number): CityFeature => ({ layer, type: 1, properties, coords: [[[lng, lat]]] });
const line = (layer: string, properties: Record<string, string | number | boolean>, coords: number[][]): CityFeature => ({ layer, type: 2, properties, coords: [coords] });

test("tile features are sorted into the kinds of city name, and the rest are left out", () => {
  assert.equal(cityClassOf(point("places", { kind: "neighbourhood", kind_detail: "suburb", name: "Le Marais", min_zoom: 12 }, 2.36, 48.86))?.kind, "district");
  assert.equal(cityClassOf(point("places", { kind: "locality", kind_detail: "city", name: "Paris" }, 2.35, 48.85)), null);
  assert.equal(cityClassOf(point("pois", { kind: "park", name: "Jardin du Luxembourg" }, 2.337, 48.846))?.kind, "park");
  assert.equal(cityClassOf(point("pois", { kind: "aerodrome", name: "Orly" }, 2.36, 48.72))?.kind, "airport");
  assert.equal(cityClassOf(point("pois", { kind: "station", name: "Gare du Nord" }, 2.355, 48.88))?.kind, "station");
  assert.equal(cityClassOf(point("pois", { kind: "university", name: "Sorbonne" }, 2.343, 48.848))?.kind, "campus");
  assert.equal(cityClassOf(point("pois", { kind: "attraction", name: "Tour Eiffel" }, 2.2945, 48.8584))?.kind, "landmark");
  assert.equal(cityClassOf(point("pois", { kind: "post_office", name: "La Poste" }, 2.3, 48.8)), null);
  assert.equal(cityClassOf(line("roads", { kind: "major_road", kind_detail: "primary", name: "Boulevard Saint-Germain" }, [[2.33, 48.853], [2.35, 48.851]]))?.kind, "street");
  assert.equal(cityClassOf(line("roads", { kind: "major_road", kind_detail: "primary", is_link: true, name: "Bretelle" }, [[2.33, 48.853], [2.35, 48.851]])), null);
  assert.equal(cityClassOf(line("roads", { kind: "minor_road", kind_detail: "residential", name: "Rue X" }, [[2.33, 48.853], [2.35, 48.851]])), null);
  assert.equal(cityClassOf(line("water", { kind: "river", name: "La Seine" }, [[2.3, 48.86], [2.36, 48.85]]))?.kind, "cityWater");
});

test("the plain name stands for the local language, other names keep their own", () => {
  assert.deepEqual(namesOf({ name: "Tour Eiffel", "name:en": "Eiffel Tower", "name:zh-Hant": "艾菲爾鐵塔" }, "fr"), { en: "Eiffel Tower", zht: "艾菲爾鐵塔", fr: "Tour Eiffel" });
  assert.deepEqual(namesOf({ name: "Gulshan" }, "bn"), { bn: "Gulshan", en: "Gulshan" });
  assert.deepEqual(namesOf({ name: "Gulshan", "name:bn": "গুলশান" }, "bn"), { bn: "গুলশান", en: "Gulshan" });
});

test("a point repeated by neighbouring tiles is kept once", () => {
  const records = cityRecords(
    [
      point("pois", { kind: "attraction", name: "Tour Eiffel", min_zoom: 13 }, 2.2945, 48.8584),
      point("pois", { kind: "attraction", name: "Tour Eiffel", min_zoom: 13 }, 2.29451, 48.85841),
      point("pois", { kind: "attraction", name: "Arc de Triomphe", min_zoom: 13 }, 2.295, 48.8738)
    ],
    { country: "FRA", local: "fr" }
  );
  assert.deepEqual(records.map((r) => r.names.fr).sort(), ["Arc de Triomphe", "Tour Eiffel"]);
  const tower = records.find((r) => r.names.fr === "Tour Eiffel")!;
  assert.equal(featureClassOf(tower.id), "landmark");
  assert.equal(tower.country, "FRA");
  assert.equal(tower.minZoom, 13);
});

test("a street cut into pieces gets one name per stretch, on its longest piece, laid along it", () => {
  // Boulevard Saint-Germain, west to east, cut at two tile edges; a short piece and a long one far away.
  const name = { kind: "major_road", kind_detail: "secondary", name: "Boulevard Saint-Germain" };
  const records = cityRecords(
    [
      line("roads", name, [[2.325, 48.857], [2.33, 48.856]]),
      line("roads", name, [[2.33, 48.856], [2.34, 48.8535], [2.35, 48.851]]),
      line("roads", name, [[2.35, 48.851], [2.3505, 48.8509]]),
      line("roads", name, [[2.45, 48.84], [2.47, 48.838]])
    ],
    { country: "FRA", local: "fr" }
  );
  assert.equal(records.length, 2, JSON.stringify(records.map((r) => [r.lng, r.lat])));
  const first = records[0];
  assert.ok(first.lng > 2.33 && first.lng < 2.35, `the name sits at ${first.lng}`);
  assert.ok(first.along && first.along.from.lng < first.lng && first.along.to.lng > first.lng, "the two points are either side of the name");
  assert.equal(first.minZoom, 13.5);
});

test("a river is named along its line, and its banks are not named again as an area", () => {
  const river = { kind: "river", name: "La Seine" };
  const records = cityRecords(
    [
      line("water", river, [[2.28, 48.862], [2.3, 48.862], [2.32, 48.8605], [2.34, 48.857]]),
      { layer: "water", type: 3, properties: river, coords: [[[2.3, 48.861], [2.32, 48.861], [2.32, 48.863], [2.3, 48.863], [2.3, 48.861]]] },
      { layer: "water", type: 3, properties: { kind: "lake", name: "Lac Daumesnil" }, coords: [[[2.41, 48.832], [2.414, 48.832], [2.414, 48.835], [2.41, 48.835], [2.41, 48.832]]] }
    ],
    { country: "FRA", local: "fr" }
  );
  const seine = records.filter((r) => r.names.fr === "La Seine");
  assert.equal(seine.length, 1);
  assert.ok(seine[0].along, "the Seine should lie along its line");
  const lake = records.find((r) => r.names.fr === "Lac Daumesnil")!;
  assert.equal(lake.along, undefined);
  assert.ok(lake.lng > 2.41 && lake.lng < 2.414 && lake.lat > 48.832 && lake.lat < 48.835);
});
