// Offline place search over the bundled Natural Earth names (countries and populated places, in 26
// languages), plus typed coordinates. Also the reverse: a name for a view, to name new maps and shots.

import type { Bbox } from "../tiles/tileMath.ts";

export type PlaceRecord = {
  id: string;
  kind: "country" | "province" | "district" | "place";
  lat: number;
  lng: number;
  country: string;
  region?: string;
  capital?: boolean;
  rank: number;
  population: number;
  /** [west, south, east, north] of a country's main land. */
  bbox?: [number, number, number, number];
  names: Record<string, string>;
};

export type SearchResult = {
  id: string;
  kind: "country" | "province" | "district" | "place" | "coordinates";
  /** English (or first available) name. */
  name: string;
  /** The name that matched, when it differs from `name` (for example the local spelling). */
  matched?: string;
  /** Region and country for places. */
  detail: string;
  /** The country's three-letter Natural Earth code (adm0_a3): of the country itself, or of a place's country. */
  code?: string;
  /** A province's id in the bundled province data, or a district's id in a downloaded set. */
  adm1?: string;
  lat: number;
  lng: number;
  bbox?: Bbox;
  population: number;
};

// Latin accents only (combining marks 0300 to 036F): vowel signs of Indic scripts, Arabic and Thai
// marks are letters to their readers and must stay.
const LATIN_ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

const fold = (text: string) => text.normalize("NFD").replace(LATIN_ACCENTS, "").normalize("NFC").toLowerCase().trim();

/** "48.85, 2.29", "48.85 2.29", "48.85N 2.29E", "-33.9;151.2" -> a position, or null. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*\xb0?\s*([NSns])?\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*\xb0?\s*([EWew])?$/);
  if (!match) return null;
  let lat = Number(match[1]);
  let lng = Number(match[3]);
  if (match[2] && /s/i.test(match[2])) lat = -Math.abs(lat);
  if (match[4] && /w/i.test(match[4])) lng = -Math.abs(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 360) return null;
  return { lat, lng };
}

export type PlaceIndex = {
  records: PlaceRecord[];
  /** Folded names of each record, in the order of `names`' keys. */
  folded: string[][];
  countryNames: Map<string, string>;
};

export function buildPlaceIndex(data: { countries: PlaceRecord[]; places: PlaceRecord[]; provinces?: PlaceRecord[]; districts?: PlaceRecord[] }): PlaceIndex {
  const records = [...data.countries, ...(data.provinces ?? []), ...(data.districts ?? []), ...data.places];
  const countryNames = new Map<string, string>();
  for (const c of data.countries) if (!countryNames.has(c.country)) countryNames.set(c.country, c.names.en ?? Object.values(c.names)[0] ?? c.country);
  return { records, folded: records.map((r) => Object.values(r.names).map(fold)), countryNames };
}

const nameOf = (record: PlaceRecord) => record.names.en ?? Object.values(record.names)[0] ?? "";

function toResult(index: PlaceIndex, record: PlaceRecord, matched?: string): SearchResult {
  const name = nameOf(record);
  const country = index.countryNames.get(record.country) ?? record.country;
  const b = record.bbox;
  return {
    id: record.id,
    kind: record.kind,
    name,
    matched: matched && fold(matched) !== fold(name) ? matched : undefined,
    detail: record.kind === "country" ? "Country" : [record.region, country].filter((part) => part && part !== name).join(", "),
    adm1: record.kind === "province" || record.kind === "district" ? record.id.replace(/^(province|district):/, "") : undefined,
    code: record.country || undefined,
    lat: record.lat,
    lng: record.lng,
    bbox: b ? { west: b[0], south: b[1], east: b[2], north: b[3] } : undefined,
    population: record.population
  };
}

export function searchPlaces(index: PlaceIndex, query: string, limit = 8): SearchResult[] {
  const coordinates = parseCoordinates(query);
  if (coordinates) {
    return [{ id: `coordinates:${coordinates.lat},${coordinates.lng}`, kind: "coordinates", name: `${coordinates.lat}, ${coordinates.lng}`, detail: "Coordinates", lat: coordinates.lat, lng: coordinates.lng, population: 0 }];
  }
  const q = fold(query);
  if (q.length < 2) return [];
  const scored: { score: number; record: PlaceRecord; matched: string }[] = [];
  for (let i = 0; i < index.records.length; i++) {
    const names = index.folded[i];
    let best = 0;
    let bestName = -1;
    for (let n = 0; n < names.length; n++) {
      const name = names[n];
      const at = name.indexOf(q);
      if (at < 0) continue;
      // Exact beats a prefix, a prefix beats the start of a later word, which beats anywhere.
      const score = name === q ? 4 : at === 0 ? 3 : /[\s\-'(]/.test(name[at - 1]) ? 2 : 1;
      if (score > best) {
        best = score;
        bestName = n;
      }
    }
    if (!best) continue;
    const record = index.records[i];
    const kindWeight = record.kind === "country" ? 30 : record.kind === "province" ? 14 : record.kind === "district" ? 9 : 0;
    const weight = best * 100 + kindWeight + (record.capital ? 8 : 0) + Math.min(20, Math.log10(record.population + 1) * 2.5) - record.rank;
    scored.push({ score: weight, record, matched: Object.values(record.names)[bestName] });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => toResult(index, s.record, s.matched));
}

/** A zoom that frames a place of a given size in a 1080-line frame. */
export function zoomForPlace(population: number): number {
  if (population > 5_000_000) return 9.6;
  if (population > 1_000_000) return 10.4;
  if (population > 200_000) return 11.2;
  if (population > 50_000) return 12;
  return 12.8;
}

/**
 * A short name for what a view shows: the country when the view is wide, otherwise the nearest known
 * place (within a distance that shrinks as the view gets closer), or null.
 */
export function nameForView(index: PlaceIndex, center: { lat: number; lng: number }, zoom: number): string | null {
  const lng = ((((center.lng + 180) % 360) + 360) % 360) - 180;
  const cos = Math.cos((center.lat * Math.PI) / 180);
  const distance = (r: PlaceRecord) => {
    let dx = Math.abs(r.lng - lng);
    if (dx > 180) dx = 360 - dx;
    return Math.hypot(dx * cos, r.lat - center.lat);
  };
  if (zoom < 2.2) return null;
  if (zoom < 6.5) {
    // The country whose box holds the centre (the smallest such box), else the nearest label.
    let inside: PlaceRecord | null = null;
    let insideArea = Infinity;
    for (const r of index.records) {
      if (r.kind !== "country" || !r.bbox) continue;
      const [west, south, east, north] = r.bbox;
      const within = center.lat >= south && center.lat <= north && (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east);
      const area = (west <= east ? east - west : east + 360 - west) * (north - south);
      if (within && area < insideArea) {
        inside = r;
        insideArea = area;
      }
    }
    return inside ? nameOf(inside) : null;
  }
  // About the frame's width in degrees: at most 2 degrees, and never less than a large city's extent.
  const reach = Math.max(0.35, Math.min(2, (360 / Math.pow(2, zoom)) * 1.2));
  let best: PlaceRecord | null = null;
  let bestScore = Infinity;
  for (const r of index.records) {
    if (r.kind !== "place") continue;
    const d = distance(r);
    if (d > reach) continue;
    // Prefer larger places when several are in reach.
    const score = d / reach - Math.min(0.6, Math.log10(r.population + 1) / 12);
    if (score < bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best ? nameOf(best) : null;
}
