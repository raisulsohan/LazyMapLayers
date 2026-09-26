// Names of the land and the water that no border draws: oceans and seas, rivers and lakes, mountain
// ranges, deserts, islands, peaks. They come from Natural Earth's physical themes (public domain) and
// are placed by Auto labels beside the countries and cities, in the manner maps have always written
// them: water in italic in the colour of water, the great landforms in widely spaced capitals, a peak
// with a small triangle and its height.

export type NatureClass = "continent" | "ocean" | "sea" | "lake" | "river" | "range" | "desert" | "region" | "island" | "peak" | "waterfall" | "pole";

export const NATURE_CLASSES: NatureClass[] = ["continent", "ocean", "sea", "lake", "river", "range", "desert", "region", "island", "peak", "waterfall", "pole"];

/** Water or land: which of the two switches in the Labels sheet a name answers to. */
export type NatureGroup = "water" | "land";

const WATER: NatureClass[] = ["ocean", "sea", "lake", "river", "waterfall"];

export const natureGroup = (kind: NatureClass): NatureGroup => (WATER.includes(kind) ? "water" : "land");

export type NatureStyle = {
  /** Size against the template: city names for most, country names for the largest. */
  scale: number;
  base: "place" | "country";
  /** After Effects tracking, thousandths of an em. */
  tracking: number;
  /** Set in capitals when the template sets names in capitals and the script has them. */
  caps: boolean;
  italic: boolean;
  /** The mark at the point itself: none for areas, a dot for a waterfall or a pole, a triangle for a peak. */
  marker: "none" | "dot" | "triangle";
  /** Opacity at full strength, out of 100: the largest names sit back so the map stays in front. */
  opacity: number;
};

export const NATURE_STYLES: Record<NatureClass, NatureStyle> = {
  continent: { scale: 1.35, base: "country", tracking: 600, caps: true, italic: false, marker: "none", opacity: 70 },
  ocean: { scale: 1.05, base: "country", tracking: 450, caps: true, italic: true, marker: "none", opacity: 80 },
  sea: { scale: 0.9, base: "place", tracking: 60, caps: false, italic: true, marker: "none", opacity: 90 },
  lake: { scale: 0.8, base: "place", tracking: 30, caps: false, italic: true, marker: "none", opacity: 95 },
  river: { scale: 0.78, base: "place", tracking: 40, caps: false, italic: true, marker: "none", opacity: 95 },
  range: { scale: 0.82, base: "place", tracking: 320, caps: true, italic: false, marker: "none", opacity: 85 },
  desert: { scale: 0.82, base: "place", tracking: 320, caps: true, italic: false, marker: "none", opacity: 85 },
  region: { scale: 0.76, base: "place", tracking: 240, caps: true, italic: false, marker: "none", opacity: 85 },
  island: { scale: 0.78, base: "place", tracking: 0, caps: false, italic: false, marker: "none", opacity: 95 },
  peak: { scale: 0.72, base: "place", tracking: 0, caps: false, italic: false, marker: "triangle", opacity: 100 },
  waterfall: { scale: 0.72, base: "place", tracking: 0, caps: false, italic: true, marker: "dot", opacity: 100 },
  pole: { scale: 0.8, base: "place", tracking: 0, caps: false, italic: false, marker: "dot", opacity: 100 }
};

/** Label ids carry the class, so a restyle knows a name's kind from its layer alone. */
export const NATURE_PREFIX = "nature:";
export const natureLabelId = (kind: NatureClass, key: string): string => `${NATURE_PREFIX}${kind}:${key}`;

export function natureClassOf(labelId: string): NatureClass | null {
  if (!labelId.startsWith(NATURE_PREFIX)) return null;
  const kind = labelId.slice(NATURE_PREFIX.length).split(":")[0] as NatureClass;
  return NATURE_CLASSES.includes(kind) ? kind : null;
}

/**
 * Where a name stands in the queue for room on the frame: lower goes first. Countries sit at 15 to
 * 105 and cities at about -7 to 100 (core placement), so a continent or an ocean claims its water
 * early, a sea or a range comes with the larger countries, and a river, a lake or a peak waits for
 * the cities of its rank.
 */
export function naturePriority(kind: NatureClass, rank: number, elevation = 0): number {
  const r = Math.max(0, Math.min(10, rank));
  switch (kind) {
    case "continent":
      return r * 10 + 1;
    case "ocean":
      return r * 10 + 3;
    case "sea":
    case "range":
    case "desert":
      return r * 10 + 7;
    case "peak":
      return r * 10 + 9 - Math.min(3, elevation / 3000);
    default:
      return r * 10 + 9;
  }
}

/** What a natural feature is called in a list, such as a search result. */
export const NATURE_NAMES: Record<NatureClass, string> = {
  continent: "Continent",
  ocean: "Ocean",
  sea: "Sea",
  lake: "Lake",
  river: "River",
  range: "Mountains",
  desert: "Desert",
  region: "Region",
  island: "Island",
  peak: "Peak",
  waterfall: "Waterfall",
  pole: "Pole"
};

/**
 * The zoom a flight to a natural feature ends at (512-pixel tiles). Natural Earth gives the zoom its
 * name first appears at (256-pixel tiles); an ocean or a desert is framed a little inside that, a
 * river, a lake or an island closer, and a peak close enough to see its ridges.
 */
export function natureViewZoom(kind: NatureClass, minZoom: number): number {
  const shown = Math.max(0, minZoom - 1);
  if (kind === "peak" || kind === "waterfall") return Math.max(8.5, shown + 3);
  if (kind === "river" || kind === "lake" || kind === "island") return Math.min(11, Math.max(3, shown + 1.5));
  if (kind === "continent" || kind === "ocean") return Math.max(1.2, shown + 0.4);
  return Math.min(10, Math.max(2, shown + 0.8));
}

/** A peak's height as it is written under its name: "8,849 m". */
export function formatElevation(metres: number): string {
  const rounded = Math.round(metres);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}${digits} m`;
}
