// Searching OpenStreetMap for what the offline list cannot know: a street, an address, a building,
// a landmark, a village. Nominatim, the OpenStreetMap Foundation's search, is free and needs no key,
// on terms the panel keeps: a search only when the user asks for one (never while typing), at most
// one request a second, a User-Agent that names the panel, answers kept on disk so the same search
// is never asked twice, and the credit shown with the results.

import type { SearchResult } from "./placeSearch.ts";

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_CREDIT = "Search by Nominatim, data © OpenStreetMap contributors";

/** The address of a search: what was typed, the answer's language, and an optional nudge to the view. */
export function nominatimUrl(query: string, options: { language?: string; near?: { west: number; south: number; east: number; north: number } | null; limit?: number } = {}): string {
  const params = new URLSearchParams({ q: query.trim(), format: "jsonv2", limit: String(Math.max(1, Math.min(20, options.limit ?? 8))), "accept-language": options.language ?? "en" });
  if (options.near) {
    // A preference, not a fence: places in view come first, others still come.
    const b = options.near;
    params.set("viewbox", [b.west, b.north, b.east, b.south].map((v) => v.toFixed(5)).join(","));
  }
  return `${NOMINATIM_ENDPOINT}?${params.toString()}`;
}

type NominatimHit = {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  place_rank?: number;
  boundingbox?: [string, string, string, string];
};

/** What kind of thing a hit is, in a word for the result row. */
function kindOf(hit: NominatimHit): string {
  const type = (hit.addresstype || hit.type || hit.category || "").replace(/_/g, " ");
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Place";
}

/**
 * The zoom that frames a hit when its box says little (a point): a building or an address close,
 * a street a little further, a village further still, from Nominatim's own rank of the place.
 */
export function zoomForRank(rank: number | undefined): number {
  const r = Number(rank);
  if (!Number.isFinite(r)) return 14;
  if (r >= 28) return 17.5;
  if (r >= 26) return 16.5;
  if (r >= 22) return 15.5;
  if (r >= 18) return 14;
  if (r >= 16) return 12.5;
  if (r >= 12) return 10;
  return 7;
}

/** The hits of an answer as search results, in the order Nominatim ranked them. */
export function nominatimResults(answer: unknown): SearchResult[] {
  if (!Array.isArray(answer)) return [];
  const out: SearchResult[] = [];
  for (const raw of answer as NominatimHit[]) {
    const lat = Number(raw.lat);
    const lng = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const parts = String(raw.display_name ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    const name = (raw.name && raw.name.trim()) || parts[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const rest = parts.filter((part) => part !== name).slice(0, 3).join(", ");
    // One street comes as several of its pieces: the same name within a couple of kilometres is one place.
    if (out.some((r) => r.name === name && Math.abs(r.lat - lat) < 0.02 && Math.abs(r.lng - lng) < 0.03)) continue;
    const box = raw.boundingbox?.map(Number);
    const bbox = box && box.length === 4 && box.every(Number.isFinite) ? { south: box[0], north: box[1], west: box[2], east: box[3] } : undefined;
    out.push({
      id: `osm:${raw.osm_type ?? "x"}${raw.osm_id ?? raw.place_id ?? out.length}`,
      kind: "address",
      name,
      detail: [kindOf(raw), rest].filter(Boolean).join(" · "),
      lat,
      lng,
      // A box the size of a building frames nothing; a point and a zoom do better there.
      bbox: bbox && (bbox.north - bbox.south > 0.01 || bbox.east - bbox.west > 0.01) ? bbox : undefined,
      population: 0,
      zoom: zoomForRank(raw.place_rank)
    });
  }
  return out;
}
