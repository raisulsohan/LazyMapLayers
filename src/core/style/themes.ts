// Map looks ("themes"): one palette drives the offline world map, downloaded OpenStreetMap regions, the
// globe's atmosphere and the colours of generated labels, so a map always looks like one design.

export type Rgb = [number, number, number];

export type Theme = {
  id: string;
  label: string;
  hint: string;
  /** Dark maps get light labels, light maps dark ones. */
  dark: boolean;
  ocean: string;
  land: string;
  /** Natural ground cover in detailed regions (forest, scrub, farmland). */
  landcover: string;
  park: string;
  urban: string;
  river: string;
  coast: string;
  /** A soft glow along coasts that gives the land depth (empty for none). */
  coastGlow: string;
  border: string;
  admin1: string;
  /** Fill colours per Natural Earth's seven-colour scheme (political map), or null for plain land. */
  countryFills: string[] | null;
  roadMinor: string;
  roadMajor: string;
  highway: string;
  rail: string;
  buildingLow: string;
  buildingMid: string;
  buildingHigh: string;
  /** Names of places, and of countries. */
  text: string;
  textCountry: string;
  halo: string;
  /** The colour of the layers the panel generates: pins, routes, callout leaders and outlines. */
  accent: string;
  sky: { sky: string; horizon: string; fog: string };
  /** The land and sea come from satellite imagery (an optional pack) instead of flat colours. */
  satellite?: boolean;
};

const theme = (t: Theme): Theme => t;

export const THEMES: Theme[] = [
  theme({
    id: "midnight",
    label: "Midnight",
    hint: "Deep navy with glowing coasts: the broadcast look",
    dark: true,
    ocean: "#07111f",
    land: "#1a2838",
    landcover: "#1b2d33",
    park: "#1b3a2e",
    urban: "#202d3b",
    river: "#0f2a45",
    coast: "#3f78a8",
    coastGlow: "#2f7fc4",
    border: "#93a9bd",
    admin1: "#43566a",
    countryFills: null,
    roadMinor: "#2c3d4f",
    roadMajor: "#446280",
    highway: "#36b3ff",
    rail: "#3d4a59",
    buildingLow: "#24364a",
    buildingMid: "#3d5a78",
    buildingHigh: "#86bfee",
    text: "#eef3f8",
    textCountry: "#c9d6e2",
    halo: "#07111f",
    accent: "#ffc740",
    sky: { sky: "#16324f", horizon: "#4f8fc4", fog: "#07111f" }
  }),
  theme({
    id: "satellite",
    label: "Satellite",
    hint: "NASA Blue Marble imagery: best for shots of continents and countries (it softens closer than a large city region)",
    dark: true,
    satellite: true,
    ocean: "#0a1c30",
    land: "#2b3527",
    landcover: "#2e3c2b",
    park: "#31492f",
    urban: "#3b3b37",
    river: "#0f2a45",
    coast: "#b9d6ea",
    coastGlow: "",
    border: "#ffffff",
    admin1: "#d5dde4",
    countryFills: null,
    roadMinor: "#4b4b45",
    roadMajor: "#8c8b7b",
    highway: "#ffd27a",
    rail: "#5b5b56",
    buildingLow: "#4a4a46",
    buildingMid: "#6b6b63",
    buildingHigh: "#cfcfc2",
    text: "#ffffff",
    textCountry: "#f3f3f3",
    halo: "#0a0f14",
    accent: "#ffd166",
    sky: { sky: "#0d2440", horizon: "#5f9bd1", fog: "#0a1c30" }
  }),
  theme({
    id: "daylight",
    label: "Daylight",
    hint: "Bright and clean, like a modern web map",
    dark: false,
    ocean: "#a8d4ec",
    land: "#f4f1e8",
    landcover: "#e4ecd6",
    park: "#cbe3b8",
    urban: "#ebe6da",
    river: "#8cc3e2",
    coast: "#6aa9cf",
    coastGlow: "#ffffff",
    border: "#8a7f9c",
    admin1: "#c0b8cc",
    countryFills: null,
    roadMinor: "#ffffff",
    roadMajor: "#fde9a8",
    highway: "#f5b94a",
    rail: "#b9b3a6",
    buildingLow: "#e2dccf",
    buildingMid: "#cfc7b6",
    buildingHigh: "#a79f8f",
    text: "#2a2a33",
    textCountry: "#4a4658",
    halo: "#ffffff",
    accent: "#e2582a",
    sky: { sky: "#8fc4ea", horizon: "#d9eefa", fog: "#f4f1e8" }
  }),
  theme({
    id: "atlas",
    label: "Atlas",
    hint: "A political map: every country in its own soft colour",
    dark: false,
    ocean: "#cfe6f3",
    land: "#efe9da",
    landcover: "#e3e8d2",
    park: "#cfe0bd",
    urban: "#e8e1d2",
    river: "#a9d3ea",
    coast: "#7fb3d1",
    coastGlow: "#ffffff",
    border: "#ffffff",
    admin1: "#ffffff",
    countryFills: ["#f3c9a5", "#c9dba3", "#f2e3a0", "#d5c3e0", "#b5d6b9", "#f0b8b3", "#e3c4a8"],
    roadMinor: "#ffffff",
    roadMajor: "#fbe7b0",
    highway: "#e9a23b",
    rail: "#b5ad9d",
    buildingLow: "#ded6c6",
    buildingMid: "#cbc2ae",
    buildingHigh: "#a39a86",
    text: "#2d2a26",
    textCountry: "#4b4438",
    halo: "#ffffff",
    accent: "#b03a2e",
    sky: { sky: "#9fcdec", horizon: "#e2f1fa", fog: "#efe9da" }
  }),
  theme({
    id: "blueprint",
    label: "Blueprint",
    hint: "White lines on engineering blue",
    dark: true,
    ocean: "#0a3566",
    land: "#0f4585",
    landcover: "#0f4585",
    park: "#124d8f",
    urban: "#11498b",
    river: "#0a3566",
    coast: "#cfe6ff",
    coastGlow: "",
    border: "#ffffff",
    admin1: "#7fb2e6",
    countryFills: null,
    roadMinor: "#3f78b8",
    roadMajor: "#8fc0f2",
    highway: "#ffffff",
    rail: "#5f93cc",
    buildingLow: "#1a5aa3",
    buildingMid: "#3c7fc9",
    buildingHigh: "#cfe6ff",
    text: "#ffffff",
    textCountry: "#d6e9ff",
    halo: "#0a3566",
    accent: "#ffd400",
    sky: { sky: "#0a3566", horizon: "#3c7fc9", fog: "#0a3566" }
  }),
  theme({
    id: "mono",
    label: "Mono",
    hint: "Neutral greys, made to be coloured and graded in After Effects",
    dark: true,
    ocean: "#0e0e0f",
    land: "#232325",
    landcover: "#262628",
    park: "#2a2b2a",
    urban: "#29292c",
    river: "#161618",
    coast: "#5a5a5f",
    coastGlow: "",
    border: "#a8a8ad",
    admin1: "#4a4a4f",
    countryFills: null,
    roadMinor: "#38383c",
    roadMajor: "#5b5b61",
    highway: "#d9d9de",
    rail: "#45454a",
    buildingLow: "#303034",
    buildingMid: "#4c4c52",
    buildingHigh: "#b9b9c0",
    text: "#f2f2f4",
    textCountry: "#c4c4c9",
    halo: "#0e0e0f",
    accent: "#ff4f4f",
    sky: { sky: "#1c1c1f", horizon: "#5a5a5f", fog: "#0e0e0f" }
  }),
  theme({
    id: "paper",
    label: "Paper",
    hint: "Warm, printed-atlas tones for history and documentary",
    dark: false,
    ocean: "#d8ccb0",
    land: "#f0e6cc",
    landcover: "#e6dfc0",
    park: "#d6d9ac",
    urban: "#e8dcc0",
    river: "#b9b398",
    coast: "#8a6f4d",
    coastGlow: "#f7f0dc",
    border: "#8b5e3c",
    admin1: "#b89b78",
    countryFills: null,
    roadMinor: "#fbf5e2",
    roadMajor: "#d9b77e",
    highway: "#a8633a",
    rail: "#9c8a6c",
    buildingLow: "#ddd0b0",
    buildingMid: "#c7b690",
    buildingHigh: "#8f7a55",
    text: "#3d2f1f",
    textCountry: "#5c4630",
    halo: "#f0e6cc",
    accent: "#c1440e",
    sky: { sky: "#cdbf9f", horizon: "#efe5cb", fog: "#f0e6cc" }
  })
];

/** Looks that need the satellite imagery pack; without it they fall back to their flat colours. */
export const SATELLITE_THEME_ID = "satellite";

export const DEFAULT_THEME_ID = "midnight";

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** "#rrggbb" as After Effects colour values (0 to 1). */
export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A colour between two hex colours (t from 0 to 1). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const channel = (i: number) => Math.round((x[i] + (y[i] - x[i]) * t) * 255).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
