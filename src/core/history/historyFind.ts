// Finding the past on the map (D95): the shape under a click, every land of one ruling power, and the
// shapes and powers whose names match what was typed in the search. A shape or a power becomes a
// custom area highlight ("area:hb1914x3", "area:hb1914r…"), so everything a highlight can do - its
// own render pass, a shape layer, the export - works with the past unchanged.

import { pointInPolygons } from "../geo/pointInPolygon.ts";
import { hash64 } from "../render/frameKey.ts";
import { foldText } from "../search/placeSearch.ts";
import type { HistoryFeature, HistoryYear } from "./historyPack.ts";

/** Something of the past that can be highlighted: one shape, or all the lands of one power. */
export type HistoryTarget = {
  /** The highlight's area id (without "area:"): letters and digits only, as highlight codes allow. */
  id: string;
  kind: "shape" | "ruler";
  name: string;
  /** "1914 · United Kingdom", "1914 · 23 lands". */
  detail: string;
  ruler: string;
  polygons: number[][][][];
  bounds: [number, number, number, number];
  label: [number, number];
};

const tag = (year: number) => (year < 0 ? `bc${-year}` : String(year));

function joinBounds(list: [number, number, number, number][]): [number, number, number, number] {
  return [Math.min(...list.map((b) => b[0])), Math.min(...list.map((b) => b[1])), Math.max(...list.map((b) => b[2])), Math.max(...list.map((b) => b[3]))];
}

/** A shape's area id: its pack id with the hyphen as an "x" ("hb1914-75" is "hb1914x75"). */
export const shapeAreaId = (f: Pick<HistoryFeature, "id">) => f.id.replace(/[^a-z0-9]/gi, "x");

function shapeTarget(year: HistoryYear, f: HistoryFeature): HistoryTarget {
  return { id: shapeAreaId(f), kind: "shape", name: f.name, detail: `${year.label} · ${f.ruler === f.name ? "independent" : f.ruler}`, ruler: f.ruler, polygons: f.polygons, bounds: f.bounds, label: f.label };
}

/** All the lands of one ruling power in a year, as one target; null when it holds none. */
export function rulerTarget(year: HistoryYear, ruler: string): HistoryTarget | null {
  const lands = year.features.filter((f) => f.name && f.ruler === ruler);
  if (!lands.length) return null;
  // The largest land carries the name.
  const largest = lands.reduce((a, b) => ((b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]) > (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) ? b : a));
  return {
    // Highlight codes allow 24 letters and digits: "hb" + year + "r" + 8 of a hash of the name.
    id: `hb${tag(year.year)}r${hash64(ruler).slice(0, 8)}`,
    kind: "ruler",
    name: lands.length > 1 ? `${ruler} and its lands` : ruler,
    detail: `${year.label} · ${lands.length} ${lands.length === 1 ? "land" : "lands"}`,
    ruler,
    polygons: lands.flatMap((f) => f.polygons),
    bounds: joinBounds(lands.map((f) => f.bounds)),
    label: largest.label
  };
}

/** The named shape under a position, or null over the sea or land that no state held. */
export function shapeAt(year: HistoryYear, position: { lat: number; lng: number }): HistoryFeature | null {
  for (const f of year.features) {
    if (!f.name) continue;
    const [west, south, east, north] = f.bounds;
    if (position.lng < west || position.lng > east || position.lat < south || position.lat > north) continue;
    if (pointInPolygons(position, f.polygons)) return f;
  }
  return null;
}

/** What a click picks: the shape under it, or with `wholeRuler` every land of its power. */
export function targetAt(year: HistoryYear, position: { lat: number; lng: number }, wholeRuler: boolean): HistoryTarget | null {
  const f = shapeAt(year, position);
  if (!f) return null;
  return wholeRuler ? rulerTarget(year, f.ruler) : shapeTarget(year, f);
}

/**
 * Shapes and powers of the year whose names match the search: an exact name first, then a name that
 * starts with it, then a word that does, then anywhere. A power that holds more than one land is offered
 * as a whole too ("United Kingdom and its lands"). Equal names (a power and its home land) appear once
 * each kind.
 */
export function searchHistory(year: HistoryYear, query: string, limit = 4): HistoryTarget[] {
  const q = foldText(query);
  if (q.length < 2) return [];
  const score = (name: string) => {
    const folded = foldText(name);
    const at = folded.indexOf(q);
    if (at < 0) return 0;
    return folded === q ? 4 : at === 0 ? 3 : /[\s\-'(]/.test(folded[at - 1]) ? 2 : 1;
  };
  const found: { score: number; size: number; target: HistoryTarget }[] = [];
  const seenNames = new Set<string>();
  for (const f of year.features) {
    if (!f.name || seenNames.has(f.name)) continue;
    const s = score(f.name);
    if (!s) continue;
    seenNames.add(f.name);
    found.push({ score: s, size: (f.bounds[2] - f.bounds[0]) * (f.bounds[3] - f.bounds[1]), target: shapeTarget(year, f) });
  }
  const rulers = new Set(year.features.filter((f) => f.name).map((f) => f.ruler));
  for (const ruler of rulers) {
    const s = score(ruler);
    if (!s) continue;
    const target = rulerTarget(year, ruler);
    if (!target || target.kind !== "ruler" || !target.name.endsWith("its lands")) continue;
    const [w, so, e, n] = target.bounds;
    found.push({ score: s + 0.5, size: (e - w) * (n - so), target });
  }
  found.sort((a, b) => b.score - a.score || b.size - a.size);
  return found.slice(0, limit).map((f) => f.target);
}
