// How a map draws the world of another year (docs/PLAN.md §9, D92): a colour per ruling power that
// stays the same in every year, so the British Empire keeps its colour from 1800 to 1945 and only what
// changed hands changes colour; and the borders between shapes as lines, with the coasts left to the
// map's own coastline.

import { mesh, neighbors } from "topojson-client";
import { topology } from "topojson-server";
import { mixHex, type Theme } from "../style/themes.ts";
import type { HistoryFeature } from "./historyPack.ts";
import { ringArea } from "../geo/sharedBorders.ts";

/** What a map keeps about the past it shows. */
export type HistorySetting = { year: number };

export function normaliseHistory(value: unknown): HistorySetting | null {
  const year = (value as { year?: unknown } | null)?.year;
  return typeof year === "number" && Number.isInteger(year) && year !== 0 ? { year } : null;
}

/** Hues the fills are mixed from: far apart, and none of them the sea's blue. */
const HUES = ["#e8a87c", "#9fc98b", "#e6cf72", "#b49ad6", "#7fc4b0", "#e48f8f", "#d6a86c", "#93b3d9", "#c9b38f", "#d4a0c4"];

/**
 * The fills of a look: its own political colours when it has them; otherwise colours mixed into its
 * land, so a dark look keeps dark, quiet fills and a light look pale ones.
 */
export function historyPalette(theme: Theme): string[] {
  if (theme.countryFills?.length) return theme.countryFills;
  return HUES.map((hue) => mixHex(theme.land, hue, theme.dark ? 0.32 : 0.5));
}

/** The palette slot a ruling power asks for: the same in every year and on every map with this look. */
export function preferredSlot(ruler: string, size: number): number {
  // FNV-1a: small, fast and spreads similar names apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < ruler.length; i++) {
    hash ^= ruler.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % size;
}

/** The ruling powers of a year, largest first, and which of them share a border. */
export type RulerMap = { order: string[]; neighbours: Map<string, Set<string>> };

/** Land nobody held is not a ruler: it keeps the land's colour. */
const ruled = (f: Pick<HistoryFeature, "name" | "ruler">) => !!f.name && !!f.ruler;

function shapesTopology(features: Pick<HistoryFeature, "ruler" | "polygons">[]) {
  const collection = {
    type: "FeatureCollection" as const,
    features: features.map((f, i) => ({ type: "Feature" as const, id: i, properties: { r: f.ruler }, geometry: { type: "MultiPolygon" as const, coordinates: f.polygons } }))
  };
  // Shared borders in the source share their points, so a fine grid keeps them as one arc.
  const topo = topology({ shapes: collection } as never, 1e6) as unknown as { objects: Record<string, { geometries: unknown[] }> };
  return { topo, object: topo.objects.shapes };
}

/** Who rules what in a year: the powers by the land they hold, and their neighbours. */
/** The ruling powers of a year by the land they hold, largest first. */
export function rulerOrder(features: Pick<HistoryFeature, "name" | "ruler" | "polygons">[]): string[] {
  const area = new Map<string, number>();
  for (const f of features) {
    if (!ruled(f)) continue;
    area.set(f.ruler, (area.get(f.ruler) ?? 0) + f.polygons.reduce((n, polygon) => n + ringArea(polygon[0]), 0));
  }
  return [...area.keys()].sort((a, b) => area.get(b)! - area.get(a)! || (a < b ? -1 : 1));
}

export function rulerMap(features: Pick<HistoryFeature, "name" | "ruler" | "polygons">[]): RulerMap {
  const neighbours = new Map<string, Set<string>>();
  const order = rulerOrder(features);
  for (const ruler of order) neighbours.set(ruler, new Set());
  if (features.length) {
    const { object } = shapesTopology(features);
    neighbors(object.geometries).forEach((list, i) => {
      if (!ruled(features[i])) return;
      for (const j of list) if (ruled(features[j]) && features[j].ruler !== features[i].ruler) neighbours.get(features[i].ruler)!.add(features[j].ruler);
    });
  }
  return { order, neighbours };
}

/**
 * The slot each power that is ever among the largest of a year asks for, settled once over every year
 * of the pack, so an empire keeps its colour from year to year: powers that are large in the same year
 * get different slots, and the power that is large in the most years chooses first (the British Empire
 * before the Russia of 1914 alone). `orders` are each year's rulerOrder. Other powers keep their name's
 * slot (preferredSlot).
 */
export function globalSlots(orders: string[][], paletteSize: number): Map<string, number> {
  const count = bigPowers(paletteSize);
  const together = new Map<string, Set<string>>();
  const years = new Map<string, number>();
  for (const order of orders) {
    const big = order.slice(0, count);
    for (const a of big) {
      years.set(a, (years.get(a) ?? 0) + 1);
      const set = together.get(a) ?? new Set<string>();
      for (const b of big) if (b !== a) set.add(b);
      together.set(a, set);
    }
  }
  const slots = new Map<string, number>();
  for (const ruler of [...years.keys()].sort((a, b) => years.get(b)! - years.get(a)! || (a < b ? -1 : 1))) {
    const taken = new Set<number>();
    for (const other of together.get(ruler) ?? []) {
      const slot = slots.get(other);
      if (slot !== undefined) taken.add(slot);
    }
    const wish = preferredSlot(ruler, paletteSize);
    let chosen = wish;
    for (let step = 0; step < paletteSize; step++) {
      const slot = (wish + step) % paletteSize;
      if (!taken.has(slot)) {
        chosen = slot;
        break;
      }
    }
    slots.set(ruler, chosen);
  }
  return slots;
}

/** How many of the largest powers always get colours of their own, whether they meet or not. */
export const bigPowers = (paletteSize: number) => Math.max(0, Math.min(8, paletteSize - 1));

/**
 * A colour per ruling power, neighbours apart. The largest powers choose first and take the slot their
 * name asks for, so an empire keeps its colour from year to year; a smaller power whose slot a
 * neighbour already holds takes the next free one, or, with every slot taken around it, the one its
 * neighbours use least. The largest few (bigPowers) also keep apart from each other wherever they
 * lie, so the British Raj and the Russian Empire never share a colour though Afghanistan lies
 * between them: on a world map the empires are what the colours are read for. `preferred` holds the
 * slots settled over every year (globalSlots); without it a power asks for its name's slot.
 */
export function rulerColours(map: RulerMap, palette: string[], preferred?: Map<string, number>): Map<string, string> {
  const slots = new Map<string, number>();
  const big = new Set(map.order.slice(0, bigPowers(palette.length)));
  for (const ruler of map.order) {
    const taken = new Map<number, number>();
    const apart = new Set(map.neighbours.get(ruler) ?? []);
    if (big.has(ruler)) for (const other of big) if (other !== ruler) apart.add(other);
    for (const other of apart) {
      const slot = slots.get(other);
      if (slot !== undefined) taken.set(slot, (taken.get(slot) ?? 0) + 1);
    }
    const wish = preferred?.get(ruler) ?? preferredSlot(ruler, palette.length);
    let chosen = -1;
    for (let step = 0; step < palette.length && chosen < 0; step++) {
      const slot = (wish + step) % palette.length;
      if (!taken.has(slot)) chosen = slot;
    }
    if (chosen < 0) chosen = [...taken.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
    slots.set(ruler, chosen);
  }
  return new Map([...slots].map(([ruler, slot]) => [ruler, palette[slot]]));
}

export type HistoryBorders = {
  /** Borders between different ruling powers: the lines a political map is about. */
  between: number[][][];
  /** Borders inside one power's lands, such as between two of its colonies. */
  within: number[][][];
};

/**
 * The borders between the year's shapes as lines, each drawn once. A shape's edge that touches no
 * other shape is a coast (or the edge of the known world) and is left out: the map draws its own
 * coastline. Land nobody held counts as a ruler of its own, so the frontier of an empire shows.
 */
export function historyBorders(features: Pick<HistoryFeature, "ruler" | "polygons">[]): HistoryBorders {
  if (!features.length) return { between: [], within: [] };
  const { topo, object } = shapesTopology(features);
  const ruler = (shape: unknown) => String((shape as { properties?: { r?: unknown } }).properties?.r ?? "");
  // Back on the pack's own 10 m grid, which the topology's quantisation leaves by a hair.
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const lines = (filter: (a: unknown, b: unknown) => boolean) => mesh(topo as never, object as never, filter).coordinates.map((line) => line.map(([lng, lat]) => [round(lng), round(lat)]));
  return {
    between: lines((a, b) => a !== b && ruler(a) !== ruler(b)),
    within: lines((a, b) => a !== b && ruler(a) === ruler(b))
  };
}

/** Rough ground area of a shape from its bounds, for ordering names: the large ones are placed first. */
export function boundsArea([west, south, east, north]: [number, number, number, number]): number {
  return Math.max(0, east - west) * Math.max(0, north - south) * Math.cos((((south + north) / 2) * Math.PI) / 180);
}

/**
 * The pack's years a History Year slider passes through while it moves between `from` and `to`: from
 * the last year at or before the lower end to the first at or after the upper end. Values beyond the
 * pack hold its first or last year.
 */
export function yearsForRange(packYears: number[], from: number, to: number): number[] {
  const years = [...packYears].sort((a, b) => a - b);
  if (!years.length) return [];
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  let first = 0;
  while (first + 1 < years.length && years[first + 1] <= low) first++;
  let last = years.length - 1;
  while (last - 1 >= 0 && years[last - 1] >= high) last--;
  return years.slice(first, Math.max(first, last) + 1);
}

/** Where a slider value falls between two of the years: `w` runs from 0 at `from` to 1 at `to`. */
export function historyMix(years: number[], t: number): { from: number; to: number; w: number } {
  const sorted = [...years].sort((a, b) => a - b);
  if (!sorted.length) return { from: t, to: t, w: 0 };
  if (!Number.isFinite(t) || t <= sorted[0]) return { from: sorted[0], to: sorted[0], w: 0 };
  if (t >= sorted[sorted.length - 1]) return { from: sorted[sorted.length - 1], to: sorted[sorted.length - 1], w: 0 };
  let i = 0;
  while (sorted[i + 1] <= t) i++;
  const from = sorted[i];
  const to = sorted[i + 1];
  return t === from ? { from, to: from, w: 0 } : { from, to, w: (t - from) / (to - from) };
}

/**
 * How strongly each year draws at a slider value. The earlier year of the pair keeps its fills whole
 * and the later one's come in over them, so what did not change hands never dims halfway; land that
 * becomes nobody's is covered by the later year's plain land. Lines and names cross-fade.
 */
export function historyWeights(years: number[], t: number): Map<number, { fill: number; line: number }> {
  const { from, to, w } = historyMix(years, t);
  const out = new Map<number, { fill: number; line: number }>();
  for (const year of years) {
    if (year === from && from === to) out.set(year, { fill: 1, line: 1 });
    else if (year === from) out.set(year, { fill: 1, line: 1 - w });
    else if (year === to) out.set(year, { fill: w, line: w });
    else out.set(year, { fill: 0, line: 0 });
  }
  return out;
}

/** The year a History Year slider value reads as: "1947", "AD 100", "323 BC". */
export function sliderYearLabel(t: number): string {
  const year = Math.floor(t + 0.0001);
  if (year < 0) return `${-year} BC`;
  return year < 1000 && year > 0 ? `AD ${year}` : String(year);
}
