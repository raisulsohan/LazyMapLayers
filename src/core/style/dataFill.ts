// Numbers on the map: every country that has a value is filled with the colour of its step. It is
// one style layer with a colour per country, not one layer per country, so a table of two hundred
// rows costs the renderer the same as a single highlight and arrives in After Effects as one layer.

import { buildScale, colorForValue, legendSteps, rampById, type LegendStep, type RampId, type Scale, type ScaleMethod } from "./valueScale.ts";
import { categoryColours, categoryPaletteById, type CategoryPaletteId } from "./categories.ts";
import { valueAt } from "../data/series.ts";

/** The code the data layer carries, where a highlight carries a country code or an area id. */
export const DATA_CODE = "DATA";

export type DataFill = {
  /** The column the numbers came from: the layer's name and the legend's title. */
  column: string;
  /** What the numbers are about: countries, the provinces of one country, or its downloaded districts. */
  level: "country" | "province" | "district";
  /** For provinces and districts: the country they belong to (the code the map tiles carry). */
  country: string | null;
  /** The value of each country (by its map code), or of each province or district (by its id). */
  values: Record<string, number>;
  ramp: RampId;
  steps: number;
  method: ScaleMethod;
  /** 0 to 1. */
  opacity: number;
  /** Outline width in comp pixels around the countries that have a value (0 for none). */
  outline: number;
  outlineColor: string;
  /** Colour for the countries with no number; null leaves them as the map draws them. */
  noData: string | null;
  /**
   * The ramp the other way round. A ramp runs from pale to deep, which reads as "little to much" on
   * a light map; on a dark one the pale end shouts instead, so a dark look turns it over.
   */
  reverse: boolean;
  /**
   * Colour by kind instead of by amount: the category of each country (or province or district).
   * `values` is then empty, and bubbles, spikes and the like, which need amounts, are not offered.
   */
  categories?: Record<string, string> | null;
  palette?: CategoryPaletteId;
  /** A colour of the user's own for a category. */
  categoryColors?: Record<string, string>;
  /**
   * Amounts over time: the times, and each place's value at each (null for a gap). `values` then
   * holds the values at the first time, and the map follows the "Data Time" slider on its layer.
   */
  series?: { times: number[]; values: Record<string, (number | null)[]> } | null;
  /**
   * The places raised in 3D by their numbers (a prism map): the largest value `maxKm` kilometres
   * high, every other in proportion, so a height reads straight as an amount. Null keeps it flat.
   */
  extrude?: { maxKm: number } | null;
};

/** How high the largest value stands, by what the numbers are about: a country, a province, a district. */
export const DEFAULT_EXTRUDE_KM = { country: 900, province: 250, district: 40 } as const;
/** The smallest prism, as a share of the tallest: a small number still shows. */
const LEAST_HEIGHT_SHARE = 0.02;

export const DEFAULT_DATA_FILL = {
  level: "country" as const,
  country: null,
  ramp: "blues" as RampId,
  steps: 5,
  method: "equal" as ScaleMethod,
  opacity: 0.85,
  outline: 0,
  outlineColor: "#ffffff",
  noData: null,
  reverse: false
};

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (value: unknown, fallback: string | null) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback);

/** What a map carries, repaired: a fill without a single usable number is no fill. */
export function normaliseDataFill(raw: unknown): DataFill | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<DataFill>;
  const level = source.level === "province" ? "province" : source.level === "district" ? "district" : "country";
  const country = typeof source.country === "string" && /^[A-Z0-9_-]{2,8}$/i.test(source.country) ? source.country.toUpperCase() : null;
  if (level !== "country" && !country) return null;
  const values: Record<string, number> = {};
  for (const [code, value] of Object.entries((source.values ?? {}) as Record<string, unknown>)) {
    // A country is the upper-case code the tiles carry; a province or a district is the id its data writes.
    if (/^[A-Za-z0-9_-]{2,32}$/.test(code) && typeof value === "number" && Number.isFinite(value)) values[level === "country" ? code.toUpperCase() : code] = value;
  }
  // Categories: a short text per place.
  let categories: Record<string, string> | null = null;
  if (source.categories && typeof source.categories === "object") {
    categories = {};
    for (const [code, value] of Object.entries(source.categories as Record<string, unknown>)) {
      if (/^[A-Za-z0-9_-]{2,32}$/.test(code) && typeof value === "string" && value.trim()) categories[level === "country" ? code.toUpperCase() : code] = value.trim().slice(0, 80);
    }
    if (!Object.keys(categories).length) categories = null;
  }
  // A series: rising times, and per place a value (or null) at each.
  let series: DataFill["series"] = null;
  const given = source.series as { times?: unknown; values?: unknown } | null | undefined;
  if (given && Array.isArray(given.times) && given.values && typeof given.values === "object") {
    const times = (given.times as unknown[]).map(Number);
    if (times.length >= 2 && times.every((t, i) => Number.isFinite(t) && (i === 0 || t > times[i - 1]))) {
      const byCode: Record<string, (number | null)[]> = {};
      for (const [code, list] of Object.entries(given.values as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_-]{2,32}$/.test(code) || !Array.isArray(list) || list.length !== times.length) continue;
        const clean = list.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
        if (clean.some((v) => v !== null)) byCode[level === "country" ? code.toUpperCase() : code] = clean;
      }
      if (Object.keys(byCode).length) {
        series = { times, values: byCode };
        // The map before it moves: every place at the first time.
        for (const [code, list] of Object.entries(byCode)) {
          const first = valueAt(times, list, times[0]);
          if (first !== null) values[code] = first;
        }
      }
    }
  }
  if (!Object.keys(values).length && !categories) return null;
  const categoryColors: Record<string, string> = {};
  for (const [name, value] of Object.entries((source.categoryColors ?? {}) as Record<string, unknown>)) {
    const hex = colour(value, null);
    if (hex && name.trim()) categoryColors[name.trim().slice(0, 80)] = hex;
  }
  return {
    column: typeof source.column === "string" && source.column.trim() ? source.column.trim().slice(0, 80) : "Value",
    level,
    country,
    values,
    ramp: rampById(source.ramp).id,
    steps: Math.max(3, Math.min(9, Math.round(Number(source.steps) || DEFAULT_DATA_FILL.steps))),
    method: source.method === "quantile" ? "quantile" : "equal",
    opacity: Number.isFinite(source.opacity) ? Math.max(0, Math.min(1, source.opacity as number)) : DEFAULT_DATA_FILL.opacity,
    outline: Number.isFinite(source.outline) ? Math.max(0, Math.min(40, source.outline as number)) : DEFAULT_DATA_FILL.outline,
    outlineColor: colour(source.outlineColor, DEFAULT_DATA_FILL.outlineColor) ?? DEFAULT_DATA_FILL.outlineColor,
    noData: colour(source.noData, null),
    reverse: source.reverse === true,
    categories: categories && !series ? categories : null,
    palette: categoryPaletteById(source.palette).id,
    categoryColors,
    series,
    // Only amounts can stand for a height.
    extrude: !categories && source.extrude && Number.isFinite((source.extrude as { maxKm?: number }).maxKm) ? { maxKm: Math.max(1, Math.min(5000, Number((source.extrude as { maxKm: number }).maxKm))) } : null
  };
}

export type DataColours = {
  scale: Scale;
  /** The colour of every country that has a value. */
  colors: Record<string, string>;
  codes: string[];
  legend: LegendStep[];
};

/** The scale of a fill: over every value at every time when the numbers change, so a colour means the same in every year. */
export function dataFillScale(fill: DataFill): Scale {
  const all = fill.series ? Object.values(fill.series.values).flatMap((list) => list.filter((v): v is number => v !== null)) : Object.values(fill.values);
  const built = buildScale(all.length ? all : [0], { ramp: fill.ramp, steps: fill.steps, method: fill.method });
  return fill.reverse ? { ...built, colors: [...built.colors].reverse() } : built;
}

/** Each place's value at a moment of a series (or the fill's values when it has none). */
export function dataValuesAt(fill: DataFill, time: number | null): Record<string, number> {
  if (!fill.series || time === null) return fill.values;
  const out: Record<string, number> = {};
  for (const [code, list] of Object.entries(fill.series.values)) {
    const value = valueAt(fill.series.times, list, time);
    if (value !== null) out[code] = value;
  }
  return out;
}

/**
 * The colour each country gets, worked out from the numbers themselves, or from its category. For a
 * series, the colours at `time` (the first time when none is given), on the scale of all the years.
 */
export function dataFillColors(fill: DataFill, time: number | null = null): DataColours {
  const scale = dataFillScale(fill);
  if (fill.categories) {
    const cat = categoryColours(fill.categories, fill.palette ?? "safe", fill.categoryColors ?? {});
    return { scale, colors: cat.colors, codes: Object.keys(cat.colors).sort(), legend: cat.legend };
  }
  const values = dataValuesAt(fill, time);
  const colors: Record<string, string> = {};
  for (const code of Object.keys(values).sort()) {
    const colour = colorForValue(values[code], scale);
    if (colour) colors[code] = colour;
  }
  return { scale, colors, codes: Object.keys(colors), legend: legendSteps(scale) };
}

/** What the sheet and the log say about a fill. */
export const describeDataFill = (fill: DataFill, colours: DataColours): string => {
  const units = fill.level === "province" ? "provinces" : fill.level === "district" ? "districts" : "countries";
  if (fill.categories) return `${colours.codes.length} ${units} coloured by ${fill.column}, ${colours.legend.length} ${colours.legend.length === 1 ? "category" : "categories"}`;
  const over = fill.series ? ` over ${fill.series.times[0]}-${fill.series.times[fill.series.times.length - 1]}` : "";
  return `${colours.codes.length} ${units} coloured by ${fill.column}${over}, ${colours.scale.colors.length} steps ${fill.method === "quantile" ? "with about as many each" : "of even size"}`;
};

/** The largest amount a prism stands for: over every year of a series, so heights compare across years. */
export function extrudeTop(fill: DataFill): number {
  const all = fill.series ? Object.values(fill.series.values).flatMap((list) => list.filter((v): v is number => v !== null)) : Object.values(fill.values);
  return Math.max(0, ...all);
}

/** The height in metres of an amount on a prism map whose largest amount `top` stands `maxKm` high. */
export function prismHeight(value: number, top: number, maxKm: number): number {
  if (!(top > 0) || !(value > 0)) return 0;
  return Math.max(LEAST_HEIGHT_SHARE, Math.min(1, value / top)) * maxKm * 1000;
}

/** Every place's prism height in metres at a moment (the fill's values when it has no series). */
export function dataHeightsAt(fill: DataFill, time: number | null = null): Record<string, number> {
  if (!fill.extrude) return {};
  const top = extrudeTop(fill);
  const out: Record<string, number> = {};
  for (const [code, value] of Object.entries(dataValuesAt(fill, time))) out[code] = Math.round(prismHeight(value, top, fill.extrude.maxKm));
  return out;
}

/** What the renderer keeps on the data layer to colour a series at any moment. */
export type SeriesPaint = { times: number[]; values: Record<string, (number | null)[]>; scale: Scale; noData: string | null; key: unknown; extrude?: { maxKm: number; top: number } | null };

/** The height expression of a prism map at a moment of its series. */
export function seriesHeightAt(paint: SeriesPaint, time: number): unknown[] {
  if (!paint.extrude) return ["literal", 0];
  const match: unknown[] = ["match", paint.key];
  let any = false;
  for (const code of Object.keys(paint.values).sort()) {
    const value = valueAt(paint.times, paint.values[code], time);
    if (value === null) continue;
    match.push(code, Math.round(prismHeight(value, paint.extrude.top, paint.extrude.maxKm)));
    any = true;
  }
  if (!any) return ["literal", 0];
  match.push(0);
  return match;
}

export const SERIES_METADATA_KEY = "lml:series";

/** The fill colour expression of a series at a moment: one colour per place with a value then. */
export function seriesMatchAt(paint: SeriesPaint, time: number): unknown[] {
  const match: unknown[] = ["match", paint.key];
  let any = false;
  for (const code of Object.keys(paint.values).sort()) {
    const value = valueAt(paint.times, paint.values[code], time);
    if (value === null) continue;
    const colour = colorForValue(value, paint.scale);
    if (!colour) continue;
    match.push(code, colour);
    any = true;
  }
  // A match needs at least one pair; a moment with no values at all colours nothing.
  if (!any) return ["literal", paint.noData ?? "rgba(0, 0, 0, 0)"];
  match.push(paint.noData ?? "rgba(0, 0, 0, 0)");
  return match;
}
