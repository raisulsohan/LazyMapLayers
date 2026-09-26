// One name, measured and given its room on the frame: the same for a name placed by Auto labels and
// for a name placed again after a template change, so the two can never disagree about how big a
// label is, where it sits beside its point, or which zooms it is shown at.

import { scriptOf } from "../../core/labels/language.ts";
import type { LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { NATURE_STYLES, naturePriority, type NatureClass } from "../../core/labels/nature.ts";
import type { LabelCandidate } from "../../core/labels/placement.ts";
import { capsFor, isCountryLabel, textStyle, type PlacedTextStyle } from "../../core/labels/restyle.ts";
import { natureClassOf } from "../../core/labels/nature.ts";
import type { WorldLabel } from "../data/worldLabels.ts";
import { measure } from "./measure.ts";

export type MeasuredLabel = {
  candidate: LabelCandidate;
  /** What the name says, in capitals where the template sets them. */
  text: string;
  main: PlacedTextStyle;
  sub: PlacedTextStyle;
  /** Where the text's centre and baselines sit against the place's point, in comp pixels. */
  dx: number;
  mainDy: number;
  subDy: number;
};

/** How strongly a name shows at full strength, out of 100: countries and the widest names sit back. */
export function labelStrength(labelId: string): number {
  const nature = natureClassOf(labelId);
  if (nature) return NATURE_STYLES[nature].opacity;
  return isCountryLabel(labelId) ? 85 : 100;
}

/**
 * The zoom band a name shows in (512-pixel tiles). Natural Earth counts 256-pixel tiles, so its
 * zooms are one less here; cities fade at `placeMaxZoom`, where the map shows the city itself.
 */
export function zoomBand(record: WorldLabel, labelId: string, placeMaxZoom: number): { minZoom: number; maxZoom: number } {
  const minZoom = Math.max(0, record.minZoom - 1);
  if (isCountryLabel(labelId)) return { minZoom, maxZoom: Math.max(minZoom + 2, (record.maxZoom ?? 8) - 1) };
  if (natureClassOf(labelId)) return { minZoom, maxZoom: Math.max(minZoom + 1.5, (record.maxZoom ?? 11) - 1) };
  return { minZoom, maxZoom: placeMaxZoom };
}

/**
 * Measures a name and makes it a candidate for the frame.
 * `design`: the room a comp of the user's own takes, in 1080-line pixels, or null for a plain name.
 * `dot`: whether a city carries its dot (natural features decide their own mark).
 */
export function measureLabel(args: {
  record: WorldLabel;
  labelId: string;
  raw: string;
  subtitle: string | null;
  template: LabelTemplate;
  scale: number;
  design: { width: number; height: number } | null;
  dot: boolean;
  placeMaxZoom: number;
}): MeasuredLabel {
  const { record, labelId, raw, subtitle, template, scale } = args;
  const isCountry = isCountryLabel(labelId);
  const nature: NatureClass | null = natureClassOf(labelId);
  const natural = nature ? NATURE_STYLES[nature] : null;
  const design = nature ? null : args.design;
  const script = scriptOf(raw);
  const text = capsFor(template, isCountry, script, nature) ? raw.toLocaleUpperCase() : raw;
  // The same style a restyle gives later, so a name placed today and restyled tomorrow look the same.
  const main = textStyle(template, scale, { country: isCountry, script, part: "text", nature });
  const subScript = subtitle ? scriptOf(subtitle) : "latin";
  const sub = textStyle(template, scale, { country: isCountry, script: subScript, part: "subtitle", nature });
  const mainWidth = measure(text, script, main.size, natural ? 400 : 600, main.tracking, !!natural?.italic);
  const subWidth = subtitle ? measure(subtitle, subScript, sub.size, 400, sub.tracking) : 0;
  // A design keeps the room its comp takes at this comp's size; a plain name is measured.
  const width = design ? design.width * scale : Math.max(mainWidth, subWidth) + main.haloWidth * 2;
  const gap = main.size * 0.18;
  const height = design ? design.height * scale : main.size * 1.1 + (subtitle ? gap + sub.size * 1.1 : 0);
  // Baselines inside a block centred on the anchor.
  const top = -height / 2;
  const offset = Math.round(10 * scale);
  // Areas are named across their middle; a city, a peak, a waterfall or a pole beside its mark.
  const marked = natural ? natural.marker !== "none" : !design && !isCountry && args.dot;
  const centred = natural ? natural.marker === "none" : !!design || isCountry;
  const band = zoomBand(record, labelId, args.placeMaxZoom);
  const candidate: LabelCandidate = {
    id: labelId,
    lat: record.lat,
    lng: record.lng,
    priority: nature
      ? naturePriority(nature, record.rank, record.elevation)
      : isCountry
        ? record.rank * 10 + 5
        : record.rank * 10 - (record.capital ? 4 : 0) - Math.min(3, Math.log10(record.population + 1) / 3),
    width,
    height,
    // A design sits centred on its own anchor, wherever the designer put it.
    anchor: centred ? "center" : "right",
    offset,
    markerRadius: marked ? (natural ? 6 : 5) * scale : 0,
    minZoom: band.minZoom,
    maxZoom: band.maxZoom
  };
  return { candidate, text, main, sub, dx: centred ? 0 : offset + width / 2, mainDy: top + main.size * 0.85, subDy: top + main.size * 1.1 + gap + sub.size * 0.85 };
}
