// Turns imported GeoJSON (also what GPX and KML files become) into the two things the panel works
// with: lines (routes, tracks, borders of areas) and places (points with a name).

import type { LngLat } from "../geo/mercator.ts";
import { lineLengthKm } from "../geo/simplify.ts";

export type ImportedLine = {
  name: string;
  points: LngLat[];
  /** True for the outline of an area (a polygon's outer ring). */
  closed: boolean;
  lengthKm: number;
  /** Seconds from the first point, when the file carries times (GPS tracks); same length as points. */
  times?: number[];
};

export type ImportedPlace = { name: string; lat: number; lng: number };

export type Imported = { lines: ImportedLine[]; places: ImportedPlace[]; skipped: number };

type Position = number[];

const validPosition = (p: unknown): p is Position => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1] as number) <= 90;

function toPoints(coordinates: unknown): LngLat[] {
  if (!Array.isArray(coordinates)) return [];
  const out: LngLat[] = [];
  for (const p of coordinates) {
    if (!validPosition(p)) continue;
    const last = out[out.length - 1];
    if (last && last.lng === p[0] && last.lat === p[1]) continue;
    out.push({ lng: p[0], lat: p[1] });
  }
  return out;
}

function nameOf(properties: Record<string, unknown> | null | undefined, fallback: string): string {
  const p = properties ?? {};
  for (const key of ["name", "Name", "NAME", "title", "name_en", "NAME_EN", "admin", "ADMIN", "id"]) {
    const value = p[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim().slice(0, 80);
  }
  return fallback;
}

/** Track times as seconds from the start (togeojson puts GPX times into coordinateProperties.times). */
function timesOf(properties: Record<string, unknown> | null | undefined, count: number, part: number): number[] | undefined {
  const raw = (properties?.coordinateProperties as { times?: unknown } | undefined)?.times ?? properties?.coordTimes;
  let list: unknown = raw;
  if (Array.isArray(raw) && Array.isArray(raw[0])) list = raw[part];
  if (!Array.isArray(list) || list.length !== count) return undefined;
  const seconds = list.map((t) => (typeof t === "number" ? t / 1000 : Date.parse(String(t)) / 1000));
  if (seconds.some((s) => !Number.isFinite(s))) return undefined;
  const first = seconds[0];
  const out = seconds.map((s) => s - first);
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) return undefined;
  return out[out.length - 1] > 0 ? out : undefined;
}

export function importGeoJson(data: unknown, fileName = "Import"): Imported {
  const result: Imported = { lines: [], places: [], skipped: 0 };
  const base = fileName.replace(/\.[^.]+$/, "") || "Import";
  const features: { geometry: unknown; properties?: Record<string, unknown> | null }[] = [];
  const collect = (node: unknown): void => {
    const n = node as { type?: string; features?: unknown[]; geometry?: unknown; geometries?: unknown[]; properties?: Record<string, unknown> | null };
    if (!n || typeof n !== "object") return;
    if (n.type === "FeatureCollection" && Array.isArray(n.features)) n.features.forEach(collect);
    else if (n.type === "Feature") features.push({ geometry: n.geometry, properties: n.properties });
    else if (typeof n.type === "string") features.push({ geometry: n, properties: null });
  };
  collect(data);

  const addLine = (coordinates: unknown, name: string, closed: boolean, properties: Record<string, unknown> | null | undefined, part: number) => {
    const points = toPoints(coordinates);
    if (points.length < 2) {
      result.skipped++;
      return;
    }
    const rawCount = Array.isArray(coordinates) ? coordinates.length : 0;
    result.lines.push({ name, points, closed, lengthKm: lineLengthKm(points), times: points.length === rawCount ? timesOf(properties, rawCount, part) : undefined });
  };

  const addGeometry = (geometry: unknown, name: string, properties: Record<string, unknown> | null | undefined): void => {
    const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
    if (!g || typeof g !== "object") {
      result.skipped++;
      return;
    }
    const c = g.coordinates as unknown[];
    switch (g.type) {
      case "Point":
        if (validPosition(c)) result.places.push({ name, lng: (c as Position)[0], lat: (c as Position)[1] });
        else result.skipped++;
        break;
      case "MultiPoint":
        (c ?? []).forEach((p, i) => (validPosition(p) ? result.places.push({ name: `${name} ${i + 1}`, lng: p[0], lat: p[1] }) : result.skipped++));
        break;
      case "LineString":
        addLine(c, name, false, properties, 0);
        break;
      case "MultiLineString":
        (c ?? []).forEach((part, i) => addLine(part, (c ?? []).length > 1 ? `${name} (${i + 1})` : name, false, properties, i));
        break;
      case "Polygon":
        addLine((c ?? [])[0], name, true, null, 0);
        break;
      case "MultiPolygon":
        (c ?? []).forEach((polygon, i) => addLine((polygon as unknown[])[0], (c ?? []).length > 1 ? `${name} (${i + 1})` : name, true, null, 0));
        break;
      case "GeometryCollection":
        (g.geometries ?? []).forEach((inner) => addGeometry(inner, name, properties));
        break;
      default:
        result.skipped++;
    }
  };

  features.forEach((feature, i) => addGeometry(feature.geometry, nameOf(feature.properties, features.length > 1 ? `${base} ${i + 1}` : base), feature.properties));
  // The longest lines first: they are what people usually came for.
  result.lines.sort((a, b) => b.lengthKm - a.lengthKm);
  return result;
}
