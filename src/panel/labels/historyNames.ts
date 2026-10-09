// The names of the past a map's labels use (D96): with a year under Historical borders, the states and
// empires of that year stand in for today's countries. With a keyed History Year slider, each year's
// names are limited to the frames that year is nearest, so a name of 1945 fades out as the names of
// 1947 come in; a name that stays the same in the same place is one name across those years.

import type { AnimatedView } from "../../core/render/plan.ts";
import { historyNameRecords, yearIntervals, yearsPerFrame } from "../../core/history/historyLabels.ts";
import type { HistorySetting } from "../../core/history/historyStyle.ts";
import { historyManifest, loadHistoryYear } from "../data/history.ts";
import type { WorldLabel } from "../data/worldLabels.ts";

export type HistoryLabelSet = {
  records: WorldLabel[];
  /** The frames each name may show on; a name without an entry shows on any frame. */
  frames: Map<string, [number, number][]>;
};

/** The names of the past for a map's frames, or null for a map of today (or without the pack). */
export function historyLabelSet(cameras: AnimatedView[], setting: HistorySetting | null): HistoryLabelSet | null {
  if (!setting) return null;
  const packYears = historyManifest()?.years.map((y) => y.year) ?? [];
  if (!packYears.length) return null;
  const perFrame = yearsPerFrame(packYears, cameras.map((view) => view.animation?.historyYear), setting.year);
  const intervals = yearIntervals(perFrame);
  const several = intervals.size > 1;
  const records: WorldLabel[] = [];
  const frames = new Map<string, [number, number][]>();
  // A state that keeps its name and stays where it was (Nepal from 1945 to 1947) keeps one name across
  // the years, so it does not fade out and in again where nothing changed.
  const kept = new Map<string, WorldLabel[]>();
  for (const [year, spans] of intervals) {
    const loaded = loadHistoryYear(year);
    if (!loaded) continue;
    for (const record of historyNameRecords(loaded.year)) {
      const same = (kept.get(record.names.en) ?? []).find((other) => Math.abs(other.lat - record.lat) < 1 && Math.abs(other.lng - record.lng) < 1);
      if (same) {
        if (several) frames.set(same.id, [...(frames.get(same.id) ?? []), ...spans].sort((a, b) => a[0] - b[0]));
        continue;
      }
      records.push(record as unknown as WorldLabel);
      kept.set(record.names.en, [...(kept.get(record.names.en) ?? []), record as unknown as WorldLabel]);
      if (several) frames.set(record.id, spans);
    }
  }
  return records.length ? { records, frames } : null;
}
