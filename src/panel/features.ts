// What the feature browser looks through: every shape the panel can put on a map, gathered from the
// bundled data, the downloaded district sets, the last import and the map's own areas, each with the
// properties it carries. core/data/featureList.ts does the filtering; this file only finds the rows
// and gives back the polygons of the one that was picked.

import type { FeatureRow, FeatureSource } from "../core/data/featureList.ts";
import type { AreaGeometry, Areas } from "../core/style/highlights.ts";
import type { DataFill } from "../core/style/dataFill.ts";
import type { ImportedArea } from "../core/data/importLines.ts";
import { areaKm2, centreOf } from "../core/geo/combine.ts";
import { provincesOf } from "./data/admin1.ts";
import { countryOutline } from "./data/countries.ts";
import { districtSetOf, districtsOf } from "./data/districts.ts";
import { placeIndex } from "./data/worldLabels.ts";
import type { HistoryYear } from "../core/history/historyPack.ts";
import { shapeAreaId } from "../core/history/historyFind.ts";

export type FeatureScope = FeatureSource;

export type FeatureSources = {
  /** The country whose provinces or districts are listed (their adm0_a3 code). */
  country?: string | null;
  /** The numbers joined to the map, so a value can be filtered and sorted on. */
  fill?: DataFill | null;
  /** The areas of the map being browsed, for the "area" scope. */
  areas?: Areas;
  /** The shapes of the last imported file. */
  imported?: ImportedArea[];
  /** How many points fall inside each feature, by row id, once it has been counted. */
  counts?: Record<string, number>;
  /** The year of the past on the map, for the "history" scope (D96). */
  history?: HistoryYear | null;
};

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** The country rows: every country the bundled data knows, with its code and its people. */
function countryRows(fill: DataFill | null | undefined): FeatureRow[] {
  const rows: FeatureRow[] = [];
  for (const record of placeIndex().records) {
    if (record.kind !== "country") continue;
    const props: Record<string, string | number> = { code: record.country, kind: "country" };
    if (record.population > 0) props.population = record.population;
    if (record.region) props.region = record.region;
    const value = fill?.values?.[record.country];
    if (typeof value === "number") props[fill?.column || "value"] = value;
    rows.push({ id: `country:${record.country}`, name: record.names.en ?? record.country, source: "country", props });
  }
  return rows;
}

function provinceRows(country: string, fill: DataFill | null | undefined): FeatureRow[] {
  return provincesOf(country).map((province) => {
    const props: Record<string, string | number> = { code: province.id, kind: "province", country };
    const value = fill?.values?.[province.id];
    if (typeof value === "number") props[fill?.column || "value"] = value;
    return { id: `province:${province.id}`, name: province.name, source: "province" as const, country, props };
  });
}

function districtRows(country: string, fill: DataFill | null | undefined): FeatureRow[] {
  const set = districtSetOf(country);
  return districtsOf(country).map((unit) => {
    const props: Record<string, string | number> = { code: unit.id, kind: set?.unit ?? "district", country };
    const value = fill?.values?.[unit.id];
    if (typeof value === "number") props[fill?.column || "value"] = value;
    return { id: `district:${unit.id}`, name: unit.name, source: "district" as const, country, props };
  });
}

function areaRows(areas: Areas): FeatureRow[] {
  return Object.entries(areas).map(([id, polygons]) => ({
    id: `area:${id}`,
    name: id,
    source: "area" as const,
    props: { kind: "area", parts: polygons.length, km2: round(areaKm2(polygons), 1) }
  }));
}

function importRows(imported: ImportedArea[]): FeatureRow[] {
  return imported.map((area, index) => ({
    id: `import:${index}`,
    name: area.name,
    source: "import" as const,
    props: { kind: "imported", points: area.points, km2: round(areaKm2(area.polygons), 1), ...(area.props ?? {}) }
  }));
}

/** The named shapes of the year on the map: who ruled them, how sure their borders are, how large they are. */
function historyRows(year: HistoryYear): FeatureRow[] {
  return year.features
    .filter((f) => f.name)
    .map((f) => ({
      id: `history:${shapeAreaId(f)}`,
      name: f.name,
      source: "history" as const,
      props: { kind: "historical", year: year.label, ruler: f.ruler, precision: f.precision, km2: round(areaKm2(f.polygons), 0), ...(f.partOf && f.partOf !== f.name ? { partOf: f.partOf } : {}) }
    }));
}

/** Every feature of one kind, ready for the browser to filter. */
export function featureRows(scope: FeatureScope, sources: FeatureSources = {}): FeatureRow[] {
  const fill = sources.fill ?? null;
  const rows =
    scope === "country"
      ? countryRows(fill)
      : scope === "province"
        ? sources.country
          ? provinceRows(sources.country, fill)
          : []
        : scope === "district"
          ? sources.country
            ? districtRows(sources.country, fill)
            : []
          : scope === "area"
            ? areaRows(sources.areas ?? {})
            : scope === "history"
              ? sources.history
                ? historyRows(sources.history)
                : []
              : importRows(sources.imported ?? []);
  const counts = sources.counts;
  if (!counts) return rows;
  return rows.map((row) => (counts[row.id] === undefined ? row : { ...row, props: { ...row.props, inside: counts[row.id] } }));
}

/** The polygons of a row, or null when this build has no outline for it. */
export function featurePolygons(row: FeatureRow, sources: FeatureSources = {}): AreaGeometry | null {
  const id = row.id.slice(row.id.indexOf(":") + 1);
  if (row.source === "country") return countryOutline(id)?.polygons ?? null;
  if (row.source === "province") return provincesOf(row.country ?? "").find((province) => province.id === id)?.polygons ?? null;
  if (row.source === "district") return districtsOf(row.country ?? "").find((unit) => unit.id === id)?.polygons ?? null;
  if (row.source === "area") return sources.areas?.[id] ?? null;
  if (row.source === "history") return sources.history?.features.find((f) => shapeAreaId(f) === id)?.polygons ?? null;
  const index = Number(id);
  return sources.imported?.[index]?.polygons ?? null;
}

/** Where a feature sits, for flying the camera to it. */
export function featureCentre(row: FeatureRow, sources: FeatureSources = {}): { lat: number; lng: number } | null {
  const polygons = featurePolygons(row, sources);
  return polygons ? centreOf(polygons) : null;
}
