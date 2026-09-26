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

// ---------------------------------------------------------------------------------------------
// Names inside a city, from a downloaded region: districts, parks, landmarks, stations, airports,
// campuses, the water that runs through it and its main streets. They share the natural names' way
// of being styled and placed, with two more colours (parks, streets) and names laid along a line.

export type CityClass = "district" | "park" | "landmark" | "station" | "airport" | "campus" | "cityWater" | "street";

export const CITY_CLASSES: CityClass[] = ["district", "park", "landmark", "station", "airport", "campus", "cityWater", "street"];

/** Any name that is not a country or a city of the world data. */
export type FeatureClass = NatureClass | CityClass;

/** Which switch in the Labels sheet a name answers to. */
export type FeatureGroup = NatureGroup | "city";

export const featureGroup = (kind: FeatureClass): FeatureGroup => ((CITY_CLASSES as string[]).includes(kind) ? "city" : natureGroup(kind as NatureClass));

export type FeatureStyle = NatureStyle & {
  /** Which of the template's colours it takes. */
  colour: "water" | "land" | "park" | "text" | "street";
  /** Laid along its line (a street, a river in town) rather than written level. */
  along: boolean;
};

const natural = (style: NatureStyle, colour: FeatureStyle["colour"]): FeatureStyle => ({ ...style, colour, along: false });

export const FEATURE_STYLES: Record<FeatureClass, FeatureStyle> = {
  continent: natural(NATURE_STYLES.continent, "land"),
  ocean: natural(NATURE_STYLES.ocean, "water"),
  sea: natural(NATURE_STYLES.sea, "water"),
  lake: natural(NATURE_STYLES.lake, "water"),
  river: natural(NATURE_STYLES.river, "water"),
  range: natural(NATURE_STYLES.range, "land"),
  desert: natural(NATURE_STYLES.desert, "land"),
  region: natural(NATURE_STYLES.region, "land"),
  island: natural(NATURE_STYLES.island, "land"),
  peak: natural(NATURE_STYLES.peak, "land"),
  waterfall: natural(NATURE_STYLES.waterfall, "water"),
  pole: natural(NATURE_STYLES.pole, "land"),
  district: { scale: 0.74, base: "place", tracking: 200, caps: true, italic: false, marker: "none", opacity: 90, colour: "land", along: false },
  park: { scale: 0.7, base: "place", tracking: 20, caps: false, italic: false, marker: "none", opacity: 95, colour: "park", along: false },
  landmark: { scale: 0.66, base: "place", tracking: 0, caps: false, italic: false, marker: "dot", opacity: 100, colour: "text", along: false },
  station: { scale: 0.64, base: "place", tracking: 0, caps: false, italic: false, marker: "dot", opacity: 100, colour: "text", along: false },
  airport: { scale: 0.7, base: "place", tracking: 0, caps: false, italic: false, marker: "dot", opacity: 100, colour: "text", along: false },
  campus: { scale: 0.64, base: "place", tracking: 0, caps: false, italic: false, marker: "none", opacity: 95, colour: "text", along: false },
  cityWater: { scale: 0.74, base: "place", tracking: 60, caps: false, italic: true, marker: "none", opacity: 95, colour: "water", along: true },
  street: { scale: 0.6, base: "place", tracking: 30, caps: false, italic: false, marker: "none", opacity: 95, colour: "street", along: true }
};

export const CITY_PREFIX = "city:";
export const cityLabelId = (kind: CityClass, key: string): string => `${CITY_PREFIX}${kind}:${key}`;

/** The kind of a name that is neither a country nor a world city, from its label id. */
export function featureClassOf(labelId: string): FeatureClass | null {
  const nature = natureClassOf(labelId);
  if (nature) return nature;
  if (!labelId.startsWith(CITY_PREFIX)) return null;
  const kind = labelId.slice(CITY_PREFIX.length).split(":")[0] as CityClass;
  return CITY_CLASSES.includes(kind) ? kind : null;
}

/**
 * The queue for room on the frame at city zooms, after the world's cities of the first ranks: an
 * airport and the districts first, the water that runs through town, the main streets (a boulevard
 * before a side street), then the landmarks and stations, and the parks and campuses, each in the
 * order of the zoom they appear at. Streets come before the smaller landmarks so a map of a city is
 * never only a list of its sights.
 */
export function cityPriority(kind: CityClass, rank: number): number {
  const r = Math.max(0, Math.min(10, rank));
  switch (kind) {
    case "airport":
      return 50 + r * 4;
    case "district":
      return 55 + r * 4;
    case "cityWater":
      return 58 + r * 4;
    case "street":
      return 62 + r * 6;
    case "landmark":
    case "station":
      return 66 + r * 5;
    default:
      return 72 + r * 5;
  }
}
