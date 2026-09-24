// How a label's text and dot are styled from the template, and how the labels already on a map are
// restyled when the template changes. The panel builds new labels through the same two functions,
// so a name placed today and a name restyled tomorrow look the same.

import { hexToRgb, type Rgb } from "../style/themes.ts";
import { templateFonts, type LabelTemplate } from "./labelTemplate.ts";
import { scriptOf, SCRIPT_FONTS, type Script } from "./language.ts";

export const RTL_SCRIPTS: Script[] = ["arabic", "hebrew"];
/** Scripts that have capitals: only these are set in capitals when the template asks. */
export const UPPERCASE_SCRIPTS: Script[] = ["latin", "cyrillic", "greek"];

export type PlacedPart = "text" | "subtitle" | "dot" | "design";

/** A label layer as the host lists it: its label, which part it is, what it says, and (for a design of
 * the user's own) the room its comp takes. */
export type PlacedLabel = { labelId: string; part: PlacedPart; text: string; raw?: string | null; w?: number | null; h?: number | null };

export type PlacedTextStyle = { size: number; color: Rgb; haloColor: Rgb; haloWidth: number; fonts: string[]; tracking: number; rtl: boolean };
export type PlacedDotStyle = { radius: number; color: Rgb; strokeColor: Rgb; strokeWidth: number };

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

/** Whether a name is set in capitals: country names, when the template asks and the script has capitals. */
export const capsFor = (template: LabelTemplate, country: boolean, script: Script): boolean => template.caps && country && UPPERCASE_SCRIPTS.includes(script);

/** The style of a name (or of the English line under it) at the comp's scale. */
export function textStyle(template: LabelTemplate, scale: number, options: { country: boolean; script: Script; part: "text" | "subtitle" }): PlacedTextStyle {
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

/** The dot beside a city name. */
export const dotStyle = (template: LabelTemplate, scale: number): PlacedDotStyle => ({ radius: 4.5 * scale, color: hexToRgb(template.color), strokeColor: hexToRgb(template.haloColor), strokeWidth: 2 * scale });

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
    // A label built from the user's own comp wears what they drew; only its place is ours to set.
    if (label.part === "design") continue;
    if (label.part === "dot") {
      if (template.dots) plan.dots.push({ labelId: label.labelId, style: dotStyle(template, scale) });
      else plan.remove.push(label.labelId);
      continue;
    }
    const raw = label.raw ?? label.text;
    const script = scriptOf(raw);
    const text = label.part === "text" && capsFor(template, country, script) ? raw.toLocaleUpperCase() : raw;
    plan.texts.push({ labelId: label.labelId, part: label.part, text, style: textStyle(template, scale, { country, script, part: label.part }) });
    if (label.part === "text" && !country && template.dots && !dotted.has(label.labelId)) plan.dotsMissing++;
  }
  return plan;
}
