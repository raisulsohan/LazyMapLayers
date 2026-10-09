// The historical borders pack (docs/PLAN.md §9): the world's countries, empires, colonies and
// unclaimed lands at one moment, a file per year, from the historical-basemaps project (GPL-3.0).
//
// The source covers all land: a shape without a name is land that no state held, not a gap. This
// module turns one source snapshot into the pack's own form (rounded rings, a label point, bounds and
// an id per shape), and applies the corrections kept in data/history/corrections.json: fixes to a
// snapshot, and years LazyMapLayers derives from one (1947 and 1971, made from 1945 and 1960).

import { labelPoint } from "../geo/polylabel.ts";
import { mergeAreas, type Polygons } from "../geo/combine.ts";

export type HistoryFeature = {
  id: string;
  /** The shape's name; empty for land that no state held. */
  name: string;
  /** Who held it: its ruling power for a colony, else the shape's own name. Colour by this. */
  ruler: string;
  /** A larger cultural area it belongs to, when the source gives one. */
  partOf: string;
  /** 1 approximate, 2 moderately precise, 3 set by international law. */
  precision: 1 | 2 | 3;
  /** [lng, lat] where the name goes. */
  label: [number, number];
  /** [west, south, east, north]. */
  bounds: [number, number, number, number];
  polygons: Polygons;
};

export type HistoryYear = { v: 1; year: number; label: string; features: HistoryFeature[] };

/** One entry of the pack's manifest. */
export type HistoryYearInfo = {
  year: number;
  label: string;
  file: string;
  features: number;
  /** The source snapshot a derived year was made from. */
  from?: number;
  /** What LazyMapLayers changed in this year, in a sentence. */
  note?: string;
};

export type HistoryManifest = {
  v: 1;
  pack: string;
  credit: string;
  license: string;
  source: { name: string; url: string; commit: string };
  years: HistoryYearInfo[];
};

/** Ids of historical shapes start with this, so a highlight says where its shape came from. */
export const HISTORY_ID_PREFIX = "hb";

export const HISTORY_CREDIT = "Historical borders: historical-basemaps (GPL-3.0)";
export const HISTORY_LICENSE = "GPL-3.0";

/** What a correction gives a shape. Fields left out keep their value. */
export type ShapeProps = { name?: string; ruler?: string; partOf?: string; precision?: 1 | 2 | 3 };

export type CorrectionOp =
  /** Several shapes become one; where they touch, the border between them goes. */
  | { op: "merge"; names: string[]; into: ShapeProps; note?: string }
  /** A shape's name, ruler, area or precision changes. */
  | { op: "set"; name: string; to: ShapeProps; note?: string }
  /** The parts of a shape that lie wholly inside a box become a shape of their own. */
  | { op: "split"; name: string; box: [number, number, number, number]; into: ShapeProps; note?: string };

export type YearCorrection = {
  year: number;
  /** For a derived year: the source snapshot it starts from. */
  from?: number;
  note: string;
  ops: CorrectionOp[];
};

export type Corrections = { v: 1; years: YearCorrection[] };

type Draft = { name: string; ruler: string; partOf: string; precision: 1 | 2 | 3; polygons: Polygons };

/** The year of a source file name: world_1945 is 1945, world_bc323 is 323 BC (-323). */
export function yearOfSourceFile(file: string): number | null {
  const match = /^world_(bc)?(\d+)\.geojson$/i.exec(file);
  if (!match) return null;
  const year = Number(match[2]);
  return match[1] ? -year : year;
}

/** How a year reads in the panel: "123000 BC", "AD 100", "1947". There is no year 0. */
export function yearLabel(year: number): string {
  if (year < 0) return `${-year} BC`;
  if (year < 1000) return `AD ${year}`;
  return String(year);
}

/** The pack's file for a year: 1947.json, bc323.json. */
export function yearFile(year: number): string {
  return year < 0 ? `bc${-year}.json` : `${year}.json`;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Rings rounded to about 10 m, with repeated points and collapsed rings gone. */
function cleanRings(polygons: number[][][][]): Polygons {
  const out: Polygons = [];
  for (const polygon of polygons) {
    const rings: number[][][] = [];
    for (const ring of polygon) {
      const points: number[][] = [];
      for (const p of ring) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const q = [round(p[0]), round(p[1])];
        const last = points[points.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) points.push(q);
      }
      if (points.length && (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1])) points.push([points[0][0], points[0][1]]);
      // A hole that collapsed goes; an outline that collapsed takes its polygon with it.
      if (points.length >= 4) rings.push(points);
      else if (!rings.length) break;
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

/** The shapes of a source snapshot (a GeoJSON FeatureCollection) in the pack's terms. */
export function readSnapshot(data: unknown): Draft[] {
  const collection = data as { type?: string; features?: GeoJSON.Feature[] } | null;
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error("not a GeoJSON FeatureCollection");
  const drafts: Draft[] = [];
  for (const feature of collection.features) {
    const geometry = feature?.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const polygons = cleanRings(geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates);
    if (!polygons.length) continue;
    const p = (feature.properties ?? {}) as Record<string, unknown>;
    const name = text(p.NAME);
    const precision = Number(p.BORDERPRECISION);
    drafts.push({
      name,
      ruler: text(p.SUBJECTO) || name,
      partOf: text(p.PARTOF),
      precision: precision === 1 || precision === 2 || precision === 3 ? precision : 1,
      polygons
    });
  }
  return drafts;
}

const describe = (year: number, op: CorrectionOp) => `${yearLabel(year)}: ${op.op} ${op.op === "merge" ? op.names.join(" + ") : op.name}`;

function apply(props: ShapeProps, draft: Draft): Draft {
  return {
    name: props.name ?? draft.name,
    ruler: props.ruler ?? (props.name !== undefined && draft.ruler === draft.name ? props.name : draft.ruler),
    partOf: props.partOf ?? draft.partOf,
    precision: props.precision ?? draft.precision,
    polygons: draft.polygons
  };
}

const inBox = (polygon: number[][][], [west, south, east, north]: [number, number, number, number]) =>
  polygon[0].every(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north);

/**
 * A year's corrections applied in order. A correction that finds nothing to change throws: the source
 * moved on, and the correction must be looked at again rather than silently doing nothing.
 */
export function applyCorrections(drafts: Draft[], year: number, ops: CorrectionOp[]): Draft[] {
  let list = drafts.slice();
  for (const op of ops) {
    if (op.op === "set") {
      let found = 0;
      list = list.map((draft) => {
        if (draft.name !== op.name) return draft;
        found++;
        return apply(op.to, draft);
      });
      if (!found) throw new Error(`${describe(year, op)}: no shape of that name`);
    } else if (op.op === "merge") {
      const parts = list.filter((draft) => op.names.includes(draft.name));
      const missing = op.names.filter((name) => !parts.some((draft) => draft.name === name));
      if (missing.length) throw new Error(`${describe(year, op)}: no shape named ${missing.join(", ")}`);
      const merged = apply(op.into, { ...parts[0], precision: Math.min(...parts.map((draft) => draft.precision)) as 1 | 2 | 3 });
      merged.polygons = cleanRings(mergeAreas(parts.map((draft) => draft.polygons)));
      if (!op.into.ruler && op.into.name) merged.ruler = op.into.name;
      const first = list.indexOf(parts[0]);
      list = list.filter((draft) => !parts.includes(draft));
      list.splice(Math.min(first, list.length), 0, merged);
    } else {
      const index = list.findIndex((draft) => draft.name === op.name);
      if (index < 0) throw new Error(`${describe(year, op)}: no shape of that name`);
      const whole = list[index];
      const moved = whole.polygons.filter((polygon) => inBox(polygon, op.box));
      const kept = whole.polygons.filter((polygon) => !inBox(polygon, op.box));
      if (!moved.length || !kept.length) throw new Error(`${describe(year, op)}: the box takes ${moved.length ? "every" : "no"} part of the shape`);
      const part = apply(op.into, { ...whole, polygons: moved });
      if (!op.into.ruler && op.into.name) part.ruler = op.into.name;
      list.splice(index, 1, { ...whole, polygons: kept }, part);
    }
  }
  return list;
}

function boundsOf(polygons: Polygons): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0]) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return [round(west), round(south), round(east), round(north)];
}

/** A year of the pack: ids in the order of the shapes, a label point and bounds for each. */
export function buildYear(drafts: Draft[], year: number): HistoryYear {
  const tag = year < 0 ? `bc${-year}` : String(year);
  const features = drafts.map((draft, i): HistoryFeature => {
    const [lng, lat] = labelPoint({ type: "MultiPolygon", coordinates: draft.polygons });
    return {
      // Highlight codes allow 24 characters: "hb" + year + "-" + index fits with room to spare.
      id: `${HISTORY_ID_PREFIX}${tag}-${i}`,
      name: draft.name,
      ruler: draft.ruler,
      partOf: draft.partOf,
      precision: draft.precision,
      label: [round(lng), round(lat)],
      bounds: boundsOf(draft.polygons),
      polygons: draft.polygons
    };
  });
  return { v: 1, year, label: yearLabel(year), features };
}

/** Checks a corrections file has the shape this module reads, and names the first problem. */
export function readCorrections(data: unknown): Corrections {
  const file = data as Partial<Corrections> | null;
  if (!file || file.v !== 1 || !Array.isArray(file.years)) throw new Error("corrections: expected { v: 1, years: [...] }");
  const seen = new Set<number>();
  for (const entry of file.years) {
    if (!Number.isInteger(entry?.year) || entry.year === 0) throw new Error(`corrections: bad year ${JSON.stringify(entry?.year)}`);
    if (seen.has(entry.year)) throw new Error(`corrections: ${entry.year} is listed twice`);
    seen.add(entry.year);
    if (typeof entry.note !== "string" || !entry.note.trim()) throw new Error(`corrections: ${entry.year} has no note`);
    if (!Array.isArray(entry.ops) || !entry.ops.length) throw new Error(`corrections: ${entry.year} has no ops`);
    for (const op of entry.ops as { op?: unknown }[]) {
      if (op?.op !== "merge" && op?.op !== "set" && op?.op !== "split") throw new Error(`corrections: ${entry.year} has an unknown op ${JSON.stringify(op?.op)}`);
    }
  }
  return file as Corrections;
}

/**
 * Every year of the pack from the source snapshots: each snapshot with its own corrections, then the
 * derived years, each made from a source snapshot as it came (not from a corrected one), so a fix to
 * 1945 never leaks into the 1947 derived from it. Years come out oldest first.
 */
export function buildHistory(snapshots: Map<number, unknown>, corrections: Corrections): { year: HistoryYear; info: Omit<HistoryYearInfo, "file"> }[] {
  const byYear = new Map(corrections.years.map((entry) => [entry.year, entry]));
  const out: { year: HistoryYear; info: Omit<HistoryYearInfo, "file"> }[] = [];
  const years = new Set([...snapshots.keys(), ...corrections.years.map((entry) => entry.year)]);
  for (const year of [...years].sort((a, b) => a - b)) {
    const correction = byYear.get(year);
    const base = correction?.from ?? year;
    if (correction?.from !== undefined && snapshots.has(year)) throw new Error(`corrections: ${year} is derived but the source has it too`);
    const source = snapshots.get(base);
    if (source === undefined) throw new Error(`corrections: no source snapshot for ${yearLabel(base)}`);
    let drafts = readSnapshot(source);
    if (correction) drafts = applyCorrections(drafts, year, correction.ops);
    const built = buildYear(drafts, year);
    const info: Omit<HistoryYearInfo, "file"> = { year, label: built.label, features: built.features.length };
    if (correction?.from !== undefined) info.from = correction.from;
    if (correction) info.note = correction.note;
    out.push({ year: built, info });
  }
  return out;
}
