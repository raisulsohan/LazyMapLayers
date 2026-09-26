// How the names on a map look: one template for every label the panel builds. The map's look sets it
// (light text on dark maps, dark on light ones), a map can override any part of it, and the whole
// template can be picked up from a text layer the user styled themselves.

import type { Theme } from "../style/themes.ts";
import { mixHex } from "../style/themes.ts";
import { fromHex, readableOn, toHex } from "../style/palette.ts";

export type LabelTemplateOverride = {
  /** City names. Null follows the map's look. */
  color: string | null;
  /** Country names. */
  countryColor: string | null;
  /** The outline that keeps a name readable over any map. */
  haloColor: string | null;
  /** Halo width in 1080-line pixels; 0 for none. */
  halo: number | null;
  /** City name size in 1080-line pixels (countries are a seventh larger). */
  size: number | null;
  /** Country names in capitals, with the letter spacing that suits them. */
  caps: boolean | null;
  /** The dot that marks a city next to its name. */
  dots: boolean | null;
  /**
   * A font to use for names in Latin, Cyrillic and Greek. Other scripts keep the fonts that shape
   * them correctly, so a brand font never breaks Bengali, Arabic or Chinese.
   */
  font: string | null;
};

export type LabelTemplate = {
  color: string;
  countryColor: string;
  /** Names of seas, rivers and lakes: the look's water colour, made to read on its sea. */
  waterColor: string;
  /** Names of ranges, deserts and islands: the country colour sunk into the land. */
  natureColor: string;
  /** Names of parks in a city: the park green drawn towards the names, made to read on the land. */
  parkColor: string;
  /** Street names: the city names' colour, a step back into the land. */
  streetColor: string;
  subtitleColor: string;
  haloColor: string;
  halo: number;
  size: number;
  countrySize: number;
  caps: boolean;
  dots: boolean;
  font: string | null;
};

export const NO_LABEL_OVERRIDE: LabelTemplateOverride = { color: null, countryColor: null, haloColor: null, halo: null, size: null, caps: null, dots: null, font: null };

/** City names at 1080 lines; everything else follows from this. */
export const DEFAULT_LABEL_SIZE = 21;
export const DEFAULT_HALO = 3;

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (value: unknown) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : null);
const number = (value: unknown, min: number, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value)) * 10) / 10 : null);
const flag = (value: unknown) => (typeof value === "boolean" ? value : null);

export function normaliseLabelTemplate(value: unknown): LabelTemplateOverride {
  const v = (value ?? {}) as Partial<LabelTemplateOverride>;
  return {
    color: colour(v.color),
    countryColor: colour(v.countryColor),
    haloColor: colour(v.haloColor),
    halo: number(v.halo, 0, 20),
    size: number(v.size, 6, 200),
    caps: flag(v.caps),
    dots: flag(v.dots),
    font: typeof v.font === "string" && v.font.trim() && v.font.length < 120 ? v.font.trim() : null
  };
}

/** What the labels really get: the look, with whatever the user overrode. */
export function resolveLabelTemplate(theme: Theme, override: LabelTemplateOverride = NO_LABEL_OVERRIDE): LabelTemplate {
  const countryColor = override.countryColor ?? theme.textCountry;
  const haloColor = override.haloColor ?? theme.halo;
  const size = override.size ?? DEFAULT_LABEL_SIZE;
  return {
    color: override.color ?? theme.text,
    countryColor,
    waterColor: toHex(readableOn(fromHex(theme.river), fromHex(theme.ocean), 3.2)),
    natureColor: toHex(readableOn(fromHex(mixHex(countryColor, theme.land, 0.4)), fromHex(theme.land), 3.2)),
    parkColor: toHex(readableOn(fromHex(mixHex(theme.park, countryColor, 0.45)), fromHex(theme.land), 3.2)),
    streetColor: toHex(readableOn(fromHex(mixHex(override.color ?? theme.text, theme.land, 0.3)), fromHex(theme.land), 3.5)),
    // The English line under a name sits back a little from the name itself.
    subtitleColor: mixHex(countryColor, haloColor, 0.25),
    haloColor,
    halo: override.halo ?? DEFAULT_HALO,
    size,
    countrySize: Math.round(size * (24 / DEFAULT_LABEL_SIZE)),
    caps: override.caps ?? true,
    dots: override.dots ?? true,
    font: override.font
  };
}

export const labelTemplateFollowsLook = (override: LabelTemplateOverride) =>
  (Object.keys(NO_LABEL_OVERRIDE) as (keyof LabelTemplateOverride)[]).every((key) => override[key] === null);

/**
 * The fonts a name is built from: the user's font first where it can shape the script, then the
 * fonts the panel knows for that script (the host picks the first one installed).
 */
export function templateFonts(template: LabelTemplate, scriptFonts: string[], script: string): string[] {
  const latin = script === "latin" || script === "cyrillic" || script === "greek";
  return template.font && latin ? [template.font, ...scriptFonts] : scriptFonts;
}
