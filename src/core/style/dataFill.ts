// Numbers on the map: every country that has a value is filled with the colour of its step. It is
// one style layer with a colour per country, not one layer per country, so a table of two hundred
// rows costs the renderer the same as a single highlight and arrives in After Effects as one layer.

import { buildScale, colorForValue, legendSteps, rampById, type LegendStep, type RampId, type Scale, type ScaleMethod } from "./valueScale.ts";

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
};

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
  if (!Object.keys(values).length) return null;
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
    reverse: source.reverse === true
  };
}

export type DataColours = {
  scale: Scale;
  /** The colour of every country that has a value. */
  colors: Record<string, string>;
  codes: string[];
  legend: LegendStep[];
};

/** The colour each country gets, worked out from the numbers themselves. */
export function dataFillColors(fill: DataFill): DataColours {
  const codes = Object.keys(fill.values).sort();
  const built = buildScale(
    codes.map((code) => fill.values[code]),
    { ramp: fill.ramp, steps: fill.steps, method: fill.method }
  );
  const scale = fill.reverse ? { ...built, colors: [...built.colors].reverse() } : built;
  const colors: Record<string, string> = {};
  for (const code of codes) {
    const colour = colorForValue(fill.values[code], scale);
    if (colour) colors[code] = colour;
  }
  return { scale, colors, codes: Object.keys(colors), legend: legendSteps(scale) };
}

/** What the sheet and the log say about a fill. */
export const describeDataFill = (fill: DataFill, colours: DataColours): string =>
  `${colours.codes.length} ${fill.level === "province" ? "provinces" : fill.level === "district" ? "districts" : "countries"} coloured by ${fill.column}, ${colours.scale.colors.length} steps ${fill.method === "quantile" ? "with about as many each" : "of even size"}`;
