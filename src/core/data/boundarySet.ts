// A downloaded set of administrative boundaries (the districts of one country, from geoBoundaries)
// made ready for the panel: thinned together so neighbours share their borders, with an id, a name,
// a label point and bounds per unit.

import { simplifyTogether } from "../geo/sharedBorders.ts";
import type { PlaceRecord } from "../search/placeSearch.ts";

export type BoundaryUnit = { id: string; name: string; polygons: number[][][][] };

/** What search needs to know about a unit, kept apart from the polygons. */
export type BoundaryUnitInfo = { id: string; n: string; lat: number; lng: number; b: [number, number, number, number]; /** The province the unit lies in, when known: it tells equal names apart. */ p?: string };

export type BoundarySetInfo = {
  /** ISO 3166-1 alpha-3 code the set was downloaded under. */
  iso: string;
  /** The country's code in the bundled world data (Natural Earth adm0_a3). */
  country: string;
  countryName: string;
  level: "ADM2";
  /** What the country calls these units ("district", "county", "department"). */
  unit: string;
  source: string;
  license: string;
  licenseSource: string;
  downloaded: string;
  units: BoundaryUnitInfo[];
};

/** Natural Earth's own codes where they differ from ISO 3166-1 alpha-3. */
const ISO_OF_ADM0: Record<string, string> = { KOS: "XKX", SDS: "SSD", PSX: "PSE", SAH: "ESH" };

/** The ISO code of a country of the world data: its iso_a3 when Natural Earth has one (it writes -99 for France and Norway), else its adm0_a3. */
export function isoOfCountry(adm0: string, isoA3: unknown): string {
  if (typeof isoA3 === "string" && /^[A-Z]{3}$/.test(isoA3)) return isoA3;
  return ISO_OF_ADM0[adm0] ?? adm0;
}

/** Ids of downloaded units start with this, so a highlight says where its shape came from. */
export const BOUNDARY_ID_PREFIX = "gb";

/** Average points a unit keeps; large sets stay small and a single unit stays under the highlight budget. */
export const POINTS_PER_UNIT = 160;

export function buildBoundarySet(
  data: unknown,
  meta: Omit<BoundarySetInfo, "units">
): { info: BoundarySetInfo; features: BoundaryUnit[] } {
  const collection = data as { type?: string; features?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>[] } | null;
  const all = collection?.type === "FeatureCollection" && Array.isArray(collection.features) ? collection.features : [];
  const usable = all.filter((f) => f && f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"));
  if (!usable.length) throw new Error("the downloaded file holds no areas");
  const light = simplifyTogether(usable, POINTS_PER_UNIT);

  const features: BoundaryUnit[] = [];
  const units: BoundaryUnitInfo[] = [];
  const seen = new Set<string>();
  usable.forEach((f, i) => {
    const polygons = light[i];
    if (!polygons.length) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const name = String(p.shapeName ?? p.name ?? p.NAME ?? "").trim().slice(0, 80) || `${meta.unit} ${i + 1}`;
    // Highlight codes allow 24 characters: the country and the end of geoBoundaries' own id (its start is the same for a whole set).
    const own = String(p.shapeID ?? `n${i}`).toLowerCase().replace(/[^a-z0-9]/g, "").slice(-14) || `n${i}`;
    let id = `${BOUNDARY_ID_PREFIX}${meta.iso.toLowerCase()}${own}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    // Bounds and label point of the largest polygon, so far islands do not pull them away.
    const largest = polygons.reduce((a, b) => (b[0].length > a[0].length ? b : a));
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of largest[0]) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
    features.push({ id, name, polygons });
    units.push({ id, n: name, lat: round((south + north) / 2, 3), lng: round((west + east) / 2, 3), b: [round(west, 2), round(south, 2), round(east, 2), round(north, 2)] });
  });
  if (!features.length) throw new Error("the downloaded file holds no usable areas");
  return { info: { ...meta, units }, features };
}

/** Search records of a downloaded set: found by name, framed by their bounds. */
export function boundaryRecords(info: BoundarySetInfo): PlaceRecord[] {
  const kind = info.unit ? info.unit.charAt(0).toUpperCase() + info.unit.slice(1).toLowerCase() : "District";
  return info.units.map((u) => ({
    id: `district:${u.id}`,
    kind: "district" as const,
    lat: u.lat,
    lng: u.lng,
    country: info.country,
    region: u.p ? `${kind}, ${u.p}` : kind,
    rank: 5,
    population: 0,
    bbox: u.b,
    names: { en: u.n }
  }));
}
