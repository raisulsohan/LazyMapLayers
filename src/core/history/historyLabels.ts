// Names of the past for Auto labels (D96): a year's states, empires and colonies as country names,
// and, when the History Year slider moves, which frames each year's names belong to.

import { historyMix } from "./historyStyle.ts";
import type { HistoryYear } from "./historyPack.ts";

/** A name of the past in the shape the label placement reads (a country of the world data). */
export type HistoryNameRecord = {
  id: string;
  kind: "country";
  lat: number;
  lng: number;
  country: string;
  rank: number;
  minZoom: number;
  maxZoom: number;
  population: number;
  bbox: [number, number, number, number];
  names: { en: string };
};

/** Label ids of the past: a country label ("country:…") with the pack's id, unique across years. */
export const historyLabelId = (featureId: string) => `country:${featureId}`;
export const isHistoryLabel = (labelId: string) => /^country:hb/.test(labelId);

/**
 * One name per named state of a year, on its largest shape (an empire's scattered islands are not
 * named one by one), ranked and shown from a zoom by the size of that shape: the largest first and
 * from the farthest out, as Natural Earth ranks today's countries.
 */
export function historyNameRecords(year: HistoryYear): HistoryNameRecord[] {
  const largest = new Map<string, HistoryYear["features"][number]>();
  const size = (f: HistoryYear["features"][number]) => {
    const [west, south, east, north] = f.bounds;
    return Math.max(0, east - west) * Math.max(0, north - south) * Math.cos((((south + north) / 2) * Math.PI) / 180);
  };
  for (const f of year.features) {
    if (!f.name) continue;
    const kept = largest.get(f.name);
    if (!kept || size(f) > size(kept)) largest.set(f.name, f);
  }
  return [...largest.values()].map((f) => {
    // Natural Earth's zooms (256-pixel tiles): a shape 45 degrees across from 0, 10 degrees from about
    // 2, one degree from 4.5.
    const across = Math.log2(Math.sqrt(size(f)) + 1);
    return {
      id: historyLabelId(f.id),
      kind: "country",
      lat: f.label[1],
      lng: f.label[0],
      country: "",
      rank: Math.max(0, Math.min(9, Math.round(6 - across))),
      minZoom: Math.round(Math.max(0, Math.min(6, 5.5 - across)) * 10) / 10,
      maxZoom: 8,
      population: 0,
      bbox: f.bounds,
      names: { en: f.name }
    };
  });
}

/**
 * The pack's year each frame shows: the nearest to the History Year slider's value there, or `fixed`
 * on frames without a value (a slider that is not there).
 */
export function yearsPerFrame(packYears: number[], values: (number | undefined)[], fixed: number): number[] {
  return values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || !packYears.length) return fixed;
    const mix = historyMix(packYears, value);
    return mix.w < 0.5 ? mix.from : mix.to;
  });
}

/** The frames [start, end) each year is shown on, in order. */
export function yearIntervals(perFrame: number[]): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  let start = 0;
  for (let f = 1; f <= perFrame.length; f++) {
    if (f < perFrame.length && perFrame[f] === perFrame[start]) continue;
    const list = out.get(perFrame[start]) ?? [];
    list.push([start, f]);
    out.set(perFrame[start], list);
    start = f;
  }
  return out;
}
