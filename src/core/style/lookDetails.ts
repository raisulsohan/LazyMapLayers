// The smaller details of a look: how heavy its lines are, how wide its roads, how many names it
// draws. The colours are the look itself (customLook.ts); these are the knobs a colour cannot turn,
// applied to a finished style so every look, bundled or the designer's own, takes them the same way.

import { scaleValue } from "./scaleStyle.ts";

export type LabelDensity = "fewer" | "normal" | "more";

export type LookDetails = {
  /** Borders, coasts, rivers and province lines, as a multiple of the look's own width. */
  lines: number;
  /** Roads and railways of a detailed region, as a multiple of the look's own width. */
  roads: number;
  /** How many names the map itself draws. */
  labels: LabelDensity;
};

export const DEFAULT_DETAILS: LookDetails = { lines: 1, roads: 1, labels: "normal" };
export const MIN_DETAIL = 0.25;
export const MAX_DETAIL = 3;

const factor = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(MIN_DETAIL, Math.min(MAX_DETAIL, Math.round(value * 100) / 100)) : 1);

/** What a map carries, repaired. */
export function normaliseDetails(raw: unknown): LookDetails {
  const source = (raw ?? {}) as Partial<LookDetails>;
  return {
    lines: factor(source.lines),
    roads: factor(source.roads),
    labels: source.labels === "fewer" || source.labels === "more" ? source.labels : "normal"
  };
}

/** True when nothing is turned, so the look draws as it is. */
export const plainDetails = (details: LookDetails): boolean => details.lines === 1 && details.roads === 1 && details.labels === "normal";

type Layer = { type: string; layout?: Record<string, unknown>; paint?: Record<string, unknown>; metadata?: Record<string, unknown>; minzoom?: number };

function widthScaled(layer: Layer, k: number): Layer {
  const paint: Record<string, unknown> = { ...(layer.paint ?? {}) };
  // A line without a width is one pixel wide.
  paint["line-width"] = "line-width" in paint ? scaleValue(paint["line-width"], k) : k;
  if ("line-gap-width" in paint) paint["line-gap-width"] = scaleValue(paint["line-gap-width"], k);
  return { ...layer, paint };
}

/**
 * A copy of the style with the details applied (the style itself when they are all plain). Lines are
 * the line layers of the boundaries and water groups, roads those of the roads group; the names are
 * the symbol layers of the labels group, which keep more room around themselves and start a zoom
 * later for fewer, less room and a zoom earlier for more.
 */
export function applyLookDetails<T extends { layers: unknown[] }>(style: T, details: LookDetails): T {
  if (plainDetails(details)) return style;
  const layers = (style.layers as Layer[]).map((layer) => {
    const group = layer.metadata?.["lml:group"];
    if (layer.type === "line" && (group === "boundaries" || group === "water") && details.lines !== 1) return widthScaled(layer, details.lines);
    if (layer.type === "line" && group === "roads" && details.roads !== 1) return widthScaled(layer, details.roads);
    if (layer.type === "symbol" && group === "labels" && details.labels !== "normal") {
      const fewer = details.labels === "fewer";
      const next: Layer = { ...layer, layout: { ...(layer.layout ?? {}), "text-padding": fewer ? 24 : 0 } };
      if (typeof layer.minzoom === "number") next.minzoom = Math.max(0, layer.minzoom + (fewer ? 1 : -1));
      return next;
    }
    return layer;
  });
  return { ...style, layers };
}

/** What the sheet says about the details, or an empty string when nothing is turned. */
export function describeDetails(details: LookDetails): string {
  const parts: string[] = [];
  if (details.lines !== 1) parts.push(`lines ${details.lines}x`);
  if (details.roads !== 1) parts.push(`roads ${details.roads}x`);
  if (details.labels !== "normal") parts.push(`${details.labels} names`);
  return parts.join(", ");
}
