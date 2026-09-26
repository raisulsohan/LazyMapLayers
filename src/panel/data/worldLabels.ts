// The bundled Natural Earth names (countries and populated places in 26 languages), read once and
// shared by auto labels, place search and automatic names.

import { buildPlaceIndex, type PlaceIndex, type PlaceRecord } from "../../core/search/placeSearch.ts";
import { worldOverlayPath } from "../basemap/basemapStyle.ts";
import { fs } from "../cep.ts";
import { provinceRecords } from "./admin1.ts";
import { districtRecords } from "./districts.ts";

export type WorldLabel = PlaceRecord & { minZoom: number; maxZoom?: number };

let records: { countries: WorldLabel[]; places: WorldLabel[]; nature: WorldLabel[] } | null = null;
let index: PlaceIndex | null = null;

export function loadWorldLabels(): { countries: WorldLabel[]; places: WorldLabel[]; nature: WorldLabel[] } {
  if (!records) {
    const read = JSON.parse(fs().readFileSync(worldOverlayPath("labels.json"), "utf8"));
    // Label data from before 0.8 has no natural features.
    records = { countries: read.countries ?? [], places: read.places ?? [], nature: read.nature ?? [] };
  }
  return records!;
}

/** The search index (built on first use, about 50 ms). */
export function placeIndex(): PlaceIndex {
  if (!index) index = buildPlaceIndex({ ...loadWorldLabels(), provinces: provinceRecords(), districts: districtRecords() });
  return index;
}

/** After districts were installed or removed: the next search builds the index again. */
export function resetPlaceIndex(): void {
  index = null;
}
