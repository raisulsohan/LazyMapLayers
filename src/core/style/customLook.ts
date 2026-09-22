// A look of the designer's own: a handful of colours, and everything else worked out from them, so
// the map stays coherent and readable whatever is chosen. The same few colours can be taken from a
// picture (palette.ts), which is how a map is made to match the film it sits in.

import { contrast, fromHex, luminance, mix, palette, readableOn, saturation, toHex, type Rgb } from "./palette.ts";
import type { Theme } from "./themes.ts";

export type LookOverride = {
  /** The sea. */
  ocean: string | null;
  /** The land, which the roads, buildings and borders are worked out from. */
  land: string | null;
  /** The colour of the layers the panel makes, and of the map's brightest lines. */
  accent: string | null;
  /** Borders between countries; the rest follow it. */
  border: string | null;
  /** Names on the map. */
  text: string | null;
};

export const NO_LOOK: LookOverride = { ocean: null, land: null, accent: null, border: null, text: null };

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (value: unknown): string | null => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : null);

export function normaliseLook(raw: unknown): LookOverride {
  const source = (raw ?? {}) as Partial<LookOverride>;
  return { ocean: colour(source.ocean), land: colour(source.land), accent: colour(source.accent), border: colour(source.border), text: colour(source.text) };
}

export const followsTheLook = (override: LookOverride): boolean => (Object.keys(NO_LOOK) as (keyof LookOverride)[]).every((key) => override[key] === null);

const blend = (a: string, b: string, t: number) => toHex(mix(fromHex(a), fromHex(b), t));

/**
 * The whole look from the few colours chosen. Every other colour is worked out here rather than
 * taken from the look it started as: a map of someone else's ocean with your land would not hold
 * together, and a name that cannot be read on the land is not a style choice.
 */
export function applyLook(theme: Theme, override: LookOverride): Theme {
  if (followsTheLook(override)) return theme;
  const ocean = override.ocean ?? theme.ocean;
  const land = override.land ?? theme.land;
  const accent = override.accent ?? theme.accent;
  const landRgb = fromHex(land);
  const dark = luminance(landRgb) < 0.4;
  const away = dark ? "#ffffff" : "#000000";
  const text = toHex(readableOn(fromHex(override.text ?? (dark ? "#f3f6fb" : "#1b2430")), landRgb, 4.5));
  const border = override.border ?? toHex(readableOn(fromHex(blend(land, away, 0.4)), landRgb, 2.2));
  return {
    ...theme,
    id: "custom",
    label: "Your look",
    hint: "Your own colours",
    dark,
    ocean,
    land,
    landcover: blend(land, ocean, 0.14),
    park: blend(land, dark ? "#2f7d52" : "#cfe6d0", 0.4),
    urban: blend(land, away, 0.08),
    river: blend(ocean, away, dark ? 0.18 : 0.1),
    coast: blend(ocean, away, dark ? 0.3 : 0.2),
    coastGlow: dark ? blend(ocean, accent, 0.3) : "",
    border,
    admin1: blend(border, land, 0.45),
    // A look of your own paints the land in one colour, not a colour per country.
    countryFills: null,
    roadMinor: blend(land, away, 0.2),
    roadMajor: blend(land, away, 0.34),
    highway: blend(land, accent, 0.55),
    rail: blend(land, away, 0.26),
    buildingLow: blend(land, away, 0.12),
    buildingMid: blend(land, away, 0.2),
    buildingHigh: blend(land, away, 0.3),
    text,
    textCountry: toHex(readableOn(fromHex(blend(text, accent, 0.2)), landRgb, 4.5)),
    halo: dark ? blend(ocean, "#000000", 0.5) : "#ffffff",
    accent,
    sky: { sky: blend(ocean, dark ? "#000010" : "#8fb6e8", 0.45), horizon: blend(ocean, accent, 0.25), fog: blend(ocean, land, 0.5) },
    satellite: false
  };
}

/**
 * A look from the colours of a picture: the darkest (or lightest) becomes the sea, the next the
 * land, and the most colourful of the rest the accent. Everything else follows from those.
 */
export function lookFromPalette(colours: string[], options: { dark?: boolean } = {}): LookOverride {
  const usable = colours.map(colour).filter((hex): hex is string => !!hex);
  if (!usable.length) return NO_LOOK;
  const rgb = usable.map(fromHex);
  const average = rgb.reduce((total, value) => total + luminance(value), 0) / rgb.length;
  const dark = options.dark ?? average < 0.45;
  const byLight = [...usable].sort((a, b) => luminance(fromHex(a)) - luminance(fromHex(b)));
  const ordered = dark ? byLight : [...byLight].reverse();
  const ocean = ordered[0];
  // The land has to be told apart from the sea; if nothing in the picture is, it is nudged.
  const land = ordered.slice(1).find((hex) => contrast(fromHex(hex), fromHex(ocean)) >= 1.25) ?? blend(ocean, dark ? "#ffffff" : "#000000", 0.18);
  const rest = usable.filter((hex) => hex !== ocean && hex !== land);
  const accent = [...rest].sort((a, b) => saturation(fromHex(b)) - saturation(fromHex(a)))[0] ?? blend(land, dark ? "#ffd479" : "#c1440e", 0.7);
  return { ocean, land, accent, border: null, text: null };
}

/** A look straight from a picture. */
export const lookFromPicture = (rgba: Uint8Array | Uint8ClampedArray | number[], options: { dark?: boolean; colours?: number } = {}): LookOverride =>
  lookFromPalette(palette(rgba, options.colours ?? 6), options);

/** What a look is worth saying: the colours it really uses. */
export const describeLook = (look: Theme): string => `sea ${look.ocean}, land ${look.land}, lines ${look.accent}, names ${look.text}`;
