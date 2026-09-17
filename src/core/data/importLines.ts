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
  /** Seconds from the first point at which each point was reached, when the file carries times (GPS tracks). */
  times?: number[];
  /** Seconds at which each point was left: later than `times` where the recording stood still. */
  leaves?: number[];
};

export type ImportedPlace = { name: string; lat: number; lng: number };

/** A filled shape: GeoJSON MultiPolygon coordinates ([polygon][ring][lng, lat]) and its size. */
export type ImportedArea = { name: string; polygons: number[][][][]; points: number; bbox: [number, number, number, number] };

export type Imported = { lines: ImportedLine[]; places: ImportedPlace[]; areas: ImportedArea[]; skipped: number };

type Position = number[];

const validPosition = (p: unknown): p is Position => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1] as number) <= 90;

/** The valid points of a coordinate list without immediate repeats; `first` and `last` are the raw indices each point stands for. */
function toPoints(coordinates: unknown): { points: LngLat[]; first: number[]; last: number[] } {
  const points: LngLat[] = [];
  const first: number[] = [];
  const last: number[] = [];
  if (!Array.isArray(coordinates)) return { points, first, last };
  coordinates.forEach((p, i) => {
    if (!validPosition(p)) return;
    const previous = points[points.length - 1];
    if (previous && previous.lng === p[0] && previous.lat === p[1]) {
      last[last.length - 1] = i;
      return;
    }
    points.push({ lng: p[0], lat: p[1] });
    first.push(i);
    last.push(i);
  });
  return { points, first, last };
}

function nameOf(properties: Record<string, unknown> | null | undefined, fallback: string): string {
  const p = properties ?? {};
  for (const key of ["name", "Name", "NAME", "title", "name_en", "NAME_EN", "admin", "ADMIN", "id"]) {
    const value = p[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim().slice(0, 80);
  }
  return fallback;
}

/** Seconds for a time written as a number (milliseconds, or seconds when small) or as a date. */
export function toSeconds(value: unknown): number {
  if (typeof value === "number") return Math.abs(value) > 1e11 ? value / 1000 : value;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  if (/^-?\d+(\.\d+)?$/.test(text)) return toSeconds(Number(text));
  return Date.parse(text) / 1000;
}

/**
 * Arrival and departure of each kept point as seconds from the start, from one raw time per raw
 * coordinate (togeojson puts GPX times into coordinateProperties.times). Undefined when times are
 * missing, unreadable or run backwards.
 */
export function trackTimes(rawTimes: unknown, rawCount: number, first: number[], last: number[]): { times: number[]; leaves?: number[] } | undefined {
  if (!Array.isArray(rawTimes) || rawTimes.length !== rawCount || first.length < 2) return undefined;
  const seconds = rawTimes.map(toSeconds);
  const times = first.map((i) => seconds[i]);
  const leaves = last.map((i) => seconds[i]);
  if (times.some((s) => !Number.isFinite(s)) || leaves.some((s) => !Number.isFinite(s))) return undefined;
  const start = times[0];
  for (let i = 0; i < times.length; i++) {
    times[i] -= start;
    leaves[i] -= start;
    if (leaves[i] < times[i] || (i > 0 && times[i] < leaves[i - 1])) return undefined;
  }
  if (!(leaves[leaves.length - 1] > 0)) return undefined;
  return leaves.some((s, i) => s > times[i]) ? { times, leaves } : { times };
}

function timesOf(properties: Record<string, unknown> | null | undefined, part: number): unknown {
  const raw = (properties?.coordinateProperties as { times?: unknown } | undefined)?.times ?? properties?.coordTimes;
  return Array.isArray(raw) && Array.isArray(raw[0]) ? raw[part] : raw;
}

export function importGeoJson(data: unknown, fileName = "Import"): Imported {
  const result: Imported = { lines: [], places: [], areas: [], skipped: 0 };
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
    const { points, first, last } = toPoints(coordinates);
    if (points.length < 2) {
      result.skipped++;
      return;
    }
    const rawCount = Array.isArray(coordinates) ? coordinates.length : 0;
    result.lines.push({ name, points, closed, lengthKm: lineLengthKm(points), ...(closed ? {} : trackTimes(timesOf(properties, part), rawCount, first, last)) });
  };

  const addArea = (polygons: unknown, name: string) => {
    const clean: number[][][][] = [];
    let points = 0;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
      const rings: number[][][] = [];
      for (const ring of Array.isArray(polygon) ? polygon : []) {
        const ringPoints = (Array.isArray(ring) ? ring : []).filter(validPosition).map((p) => [p[0], p[1]]);
        if (ringPoints.length < 4) continue;
        rings.push(ringPoints);
        points += ringPoints.length;
        if (rings.length === 1)
          for (const [lng, lat] of ringPoints) {
            west = Math.min(west, lng);
            east = Math.max(east, lng);
            south = Math.min(south, lat);
            north = Math.max(north, lat);
          }
      }
      if (rings.length) clean.push(rings);
    }
    if (clean.length) result.areas.push({ name, polygons: clean, points, bbox: [west, south, east, north] });
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
        addArea([c], name);
        break;
      case "MultiPolygon":
        (c ?? []).forEach((polygon, i) => addLine((polygon as unknown[])[0], (c ?? []).length > 1 ? `${name} (${i + 1})` : name, true, null, 0));
        addArea(c, name);
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
  result.areas.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
