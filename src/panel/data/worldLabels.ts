// The bundled Natural Earth names (countries and populated places in 26 languages), read once and
// shared by auto labels, place search and automatic names.

import { buildPlaceIndex, type PlaceIndex, type PlaceRecord } from "../../core/search/placeSearch.ts";
import { worldOverlayPath } from "../basemap/basemapStyle.ts";
import { fs } from "../cep.ts";

export type WorldLabel = PlaceRecord & { minZoom: number; maxZoom?: number };

let records: { countries: WorldLabel[]; places: WorldLabel[] } | null = null;
let index: PlaceIndex | null = null;

export function loadWorldLabels(): { countries: WorldLabel[]; places: WorldLabel[] } {
  if (!records) records = JSON.parse(fs().readFileSync(worldOverlayPath("labels.json"), "utf8"));
  return records!;
}

/** The search index (built on first use, about 50 ms). */
export function placeIndex(): PlaceIndex {
  if (!index) index = buildPlaceIndex(loadWorldLabels());
  return index;
}
