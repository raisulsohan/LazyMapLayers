// Provinces (states, divisions, regions) of every country, from Natural Earth: an index for search and
// one file of thinned polygons per country, read when a province of that country is first needed.

import { pointInPolygons } from "../../core/geo/pointInPolygon.ts";
import type { PlaceRecord } from "../../core/search/placeSearch.ts";
import type { AreaGeometry } from "../../core/style/highlights.ts";
import { extensionRoot, fs, path } from "../cep.ts";

type IndexEntry = { id: string; c: string; n: string; a?: Record<string, string>; t?: string; lat: number; lng: number; b: [number, number, number, number] };
export type Province = { id: string; name: string; polygons: AreaGeometry };

const dataPath = (...parts: string[]) => path().join(extensionRoot(), "data", ...parts);

let records: PlaceRecord[] | null = null;
const countries = new Map<string, Province[]>();

/** Provinces as search records (empty when the data is not part of this build). */
export function provinceRecords(): PlaceRecord[] {
  if (records) return records;
  records = [];
  try {
    const index = JSON.parse(fs().readFileSync(dataPath("admin1-index.json"), "utf8")) as { provinces: IndexEntry[] };
    records = index.provinces.map((p) => ({
      id: `province:${p.id}`,
      kind: "province" as const,
      lat: p.lat,
      lng: p.lng,
      country: p.c,
      region: p.t,
      rank: 4,
      population: 0,
      bbox: p.b,
      names: { en: p.n, ...(p.a ?? {}) }
    }));
  } catch {
    // Builds without province data still search countries and cities.
  }
  return records;
}

/** The provinces of a country (by its adm0_a3 code), or an empty list. */
export function provincesOf(country: string): Province[] {
  const cached = countries.get(country);
  if (cached) return cached;
  let list: Province[] = [];
  try {
    if (/^[A-Z0-9_-]{2,8}$/i.test(country)) list = (JSON.parse(fs().readFileSync(dataPath("admin1", `${country}.json`), "utf8")) as { features: Province[] }).features;
  } catch {
    list = [];
  }
  countries.set(country, list);
  return list;
}

/** The province of a country that holds a point, or null. */
export function provinceAt(country: string, position: { lat: number; lng: number }): Province | null {
  return provincesOf(country).find((province) => pointInPolygons(position, province.polygons)) ?? null;
}
