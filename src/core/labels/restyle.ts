// How a label's text and dot are styled from the template, and how the labels already on a map are
// restyled when the template changes. The panel builds new labels through the same two functions,
// so a name placed today and a name restyled tomorrow look the same.

import { hexToRgb, type Rgb } from "../style/themes.ts";
import { templateFonts, type LabelTemplate } from "./labelTemplate.ts";
import { ITALIC_FONTS, scriptOf, SCRIPT_FONTS, type Script } from "./language.ts";
import { FEATURE_STYLES, featureClassOf, type FeatureClass } from "./nature.ts";

export const RTL_SCRIPTS: Script[] = ["arabic", "hebrew"];
/** Scripts that have capitals: only these are set in capitals when the template asks. */
export const UPPERCASE_SCRIPTS: Script[] = ["latin", "cyrillic", "greek"];

export type PlacedPart = "text" | "subtitle" | "dot" | "design";

/** A label layer as the host lists it: its label, which part it is, what it says, and (for a design of
 * the user's own) the room its comp takes. */
export type PlacedLabel = {
  labelId: string;
  part: PlacedPart;
  text: string;
  raw?: string | null;
  w?: number | null;
  h?: number | null;
  /** Where a name inside a city stands, kept in its tag (it has no record in the world data). */
  place?: { lat: number; lng: number; rank: number; minZoom: number; maxZoom: number; along: { from: { lat: number; lng: number }; to: { lat: number; lng: number } } | null } | null;
};

export type PlacedTextStyle = { size: number; color: Rgb; haloColor: Rgb; haloWidth: number; fonts: string[]; tracking: number; rtl: boolean };
export type PlacedDotStyle = { radius: number; color: Rgb; strokeColor: Rgb; strokeWidth: number; shape?: "circle" | "triangle" };

export type RestylePlan = {
  texts: { labelId: string; part: "text" | "subtitle"; text: string; style: PlacedTextStyle }[];
  dots: { labelId: string; style: PlacedDotStyle }[];
  /** Dots to take away, because the template has none. */
  remove: string[];
  /** Places whose names have no dot although the template asks for one: only placing again makes them. */
  dotsMissing: number;
};

/** A country's name, as the label ids are written ("country:IDN:Indonesia"). */
export const isCountryLabel = (labelId: string): boolean => labelId.startsWith("country:");

/**
 * Whether a name is set in capitals: country names, and the great landforms and oceans, when the
 * template asks and the script has capitals.
 */
export const capsFor = (template: LabelTemplate, country: boolean, script: Script, nature: FeatureClass | null = null): boolean =>
  template.caps && (nature ? FEATURE_STYLES[nature].caps : country) && UPPERCASE_SCRIPTS.includes(script);

/** The template colour a feature's name takes. */
function featureColour(template: LabelTemplate, nature: FeatureClass): string {
  switch (FEATURE_STYLES[nature].colour) {
    case "water":
      return template.waterColor;
    case "park":
      return template.parkColor;
    case "street":
      return template.streetColor;
    case "text":
      return template.color;
    default:
      return template.natureColor;
  }
}

/** A natural feature's name: the look's water or land colour, its own size, spacing and slant. */
function natureStyle(template: LabelTemplate, scale: number, nature: FeatureClass, script: Script, part: "text" | "subtitle"): PlacedTextStyle {
  const style = FEATURE_STYLES[nature];
  const size = Math.round((style.base === "country" ? template.countrySize : template.size) * style.scale * scale);
  const halo = { haloColor: hexToRgb(template.haloColor), haloWidth: template.halo > 0 ? Math.max(1, Math.round(template.halo * scale)) : 0 };
  const rtl = RTL_SCRIPTS.includes(script);
  if (part === "subtitle") {
    return { size: Math.max(1, Math.round(size * 0.66)), color: hexToRgb(template.subtitleColor), ...halo, fonts: templateFonts(template, SCRIPT_FONTS[script].regular, script), tracking: 20, rtl };
  }
  const colour = featureColour(template, nature);
  const italic = style.italic ? ITALIC_FONTS[script] : undefined;
  // Letter spacing only where letters stand apart; joined and shaped scripts are left as they are.
  const spaced = UPPERCASE_SCRIPTS.includes(script) ? (capsFor(template, false, script, nature) || !style.caps ? style.tracking : Math.round(style.tracking / 3)) : 0;
  return { size, color: hexToRgb(colour), ...halo, fonts: templateFonts(template, italic ?? SCRIPT_FONTS[script].regular, script), tracking: spaced, rtl };
}

/** The style of a name (or of the English line under it) at the comp's scale. */
export function textStyle(template: LabelTemplate, scale: number, options: { country: boolean; script: Script; part: "text" | "subtitle"; nature?: FeatureClass | null }): PlacedTextStyle {
  if (options.nature) return natureStyle(template, scale, options.nature, options.script, options.part);
  const size = Math.round((options.country ? template.countrySize : template.size) * scale);
  const halo = { haloColor: hexToRgb(template.haloColor), haloWidth: template.halo > 0 ? Math.max(1, Math.round(template.halo * scale)) : 0 };
  if (options.part === "subtitle") {
    return { size: Math.round(size * 0.62), color: hexToRgb(template.subtitleColor), ...halo, fonts: templateFonts(template, SCRIPT_FONTS[options.script].regular, options.script), tracking: 20, rtl: RTL_SCRIPTS.includes(options.script) };
  }
  return {
    size,
    color: hexToRgb(options.country ? template.countryColor : template.color),
    ...halo,
    fonts: templateFonts(template, SCRIPT_FONTS[options.script].bold, options.script),
    tracking: capsFor(template, options.country, options.script) ? 160 : 0,
    rtl: RTL_SCRIPTS.includes(options.script)
  };
}

/** The dot beside a city name, the triangle of a peak, the dot of a waterfall or a pole. */
export function dotStyle(template: LabelTemplate, scale: number, nature: FeatureClass | null = null): PlacedDotStyle {
  if (nature && FEATURE_STYLES[nature].marker === "triangle") {
    return { radius: 6 * scale, color: hexToRgb(template.natureColor), strokeColor: hexToRgb(template.haloColor), strokeWidth: 1.5 * scale, shape: "triangle" };
  }
  if (nature) {
    return { radius: 4 * scale, color: hexToRgb(featureColour(template, nature)), strokeColor: hexToRgb(template.haloColor), strokeWidth: 1.5 * scale, shape: "circle" };
  }
  return { radius: 4.5 * scale, color: hexToRgb(template.color), strokeColor: hexToRgb(template.haloColor), strokeWidth: 2 * scale, shape: "circle" };
}

/**
 * What to change on the labels already on a map so they follow `template`. A name keeps the words it
 * was placed with (`raw`, kept in its tag; older labels fall back to what they show), so capitals can
 * go on and come off again. Dots the template no longer wants go; dots it wants but the map lacks are
 * counted, not made: their places are only known when the names are placed.
 */
export function restylePlan(labels: PlacedLabel[], template: LabelTemplate, scale: number): RestylePlan {
  const plan: RestylePlan = { texts: [], dots: [], remove: [], dotsMissing: 0 };
  const dotted = new Set(labels.filter((label) => label.part === "dot").map((label) => label.labelId));
  for (const label of labels) {
    const country = isCountryLabel(label.labelId);
    const nature = featureClassOf(label.labelId);
    // A label built from the user's own comp wears what they drew; only its place is ours to set.
    if (label.part === "design") continue;
    if (label.part === "dot") {
      // A peak's triangle is part of the peak, not a city dot: it stays whatever the template says.
      if (nature) plan.dots.push({ labelId: label.labelId, style: dotStyle(template, scale, nature) });
      else if (template.dots) plan.dots.push({ labelId: label.labelId, style: dotStyle(template, scale) });
      else plan.remove.push(label.labelId);
      continue;
    }
    const raw = label.raw ?? label.text;
    const script = scriptOf(raw);
    const text = label.part === "text" && capsFor(template, country, script, nature) ? raw.toLocaleUpperCase() : raw;
    plan.texts.push({ labelId: label.labelId, part: label.part, text, style: textStyle(template, scale, { country, script, part: label.part, nature }) });
    if (label.part === "text" && !country && !nature && template.dots && !dotted.has(label.labelId)) plan.dotsMissing++;
  }
  return plan;
}
