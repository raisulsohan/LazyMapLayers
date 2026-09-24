// The map's furniture: a scale bar and a north arrow. The panel works out where they sit and in what
// style; core writes the expressions that keep them honest; the host builds the layers.

import { DEFAULT_BAR_LENGTH, minimapBoxExpression, northArrowPath, northRotationExpression, scaleBarPathExpression, scaleBarTextExpression, type ScaleUnits } from "../../core/ae/mapFurniture.ts";
import { SCRIPT_FONTS, scriptOf } from "../../core/labels/language.ts";
import { templateFonts, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { legendPosition, type LegendCorner } from "../../core/style/legend.ts";
import type { LayerStyle } from "../../core/style/layerStyle.ts";
import { hexToRgb, themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import { callHost } from "../cep.ts";

type Info = { width: number; height: number };

export type FurnitureKind = "scaleBar" | "northArrow";

export type FurnitureOptions = {
  /** Where in the frame it sits. */
  corner?: LegendCorner;
  theme?: ThemeLike;
  style?: LayerStyle | null;
  /** The map's label template, so the furniture is set in the same font as the names. */
  template?: LabelTemplate | null;
};

export type ScaleBarOptions = FurnitureOptions & {
  /** Metres and kilometres, or feet and miles. */
  units?: ScaleUnits;
  /** How far the bar may reach, in comp pixels at 1080p. */
  length?: number;
};

export type NorthArrowOptions = FurnitureOptions & {
  /** The arrow's height in comp pixels at 1080p. */
  size?: number;
  /** The letter under the arrow, or nothing for the arrow alone. */
  letter?: string | null;
};

export type FurnitureResult = { name: string; index: number; removed: number; expressionErrors: string[] };

function fontsFor(text: string, template: LabelTemplate | null | undefined): string[] {
  const script = scriptOf(text || "A");
  return template ? templateFonts(template, SCRIPT_FONTS[script].regular, script) : SCRIPT_FONTS[script].regular;
}

/** A scale bar in a corner of the scene, measured against the map's own zoom and scale. */
export async function addScaleBar(mapId: string, options: ScaleBarOptions = {}): Promise<FurnitureResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const theme = themeFrom(options.theme);
  const scale = info.height / 1080;
  const length = (options.length ?? DEFAULT_BAR_LENGTH) * scale;
  const tick = 8 * scale;
  const textSize = 22 * scale;
  const units = options.units ?? "metric";
  const box = { width: length, height: tick + textSize + 6 * scale, scale };
  const at = legendPosition(box, info, options.corner ?? "bottomLeft");
  return callHost<FurnitureResult>("addScaleBar", {
    mapId,
    position: [Math.round(at.x), Math.round(at.y + box.height)],
    tick,
    fonts: fontsFor("100 km", options.template),
    style: {
      color: hexToRgb(theme.text),
      width: Math.max(1, Math.round(3 * scale)),
      textColor: hexToRgb(theme.text),
      haloColor: hexToRgb(theme.halo),
      haloWidth: Math.max(1, Math.round(2 * scale)),
      textSize,
      justify: "left"
    },
    expressions: {
      path: scaleBarPathExpression(length, units, tick),
      text: scaleBarTextExpression(length, units)
    }
  });
}

/** A north arrow in a corner of the scene, turning with the map's bearing and the globe's poles. */
export async function addNorthArrow(mapId: string, options: NorthArrowOptions = {}): Promise<FurnitureResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const theme = themeFrom(options.theme);
  const scale = info.height / 1080;
  const size = (options.size ?? 52) * scale;
  const letter = options.letter === null ? "" : (options.letter ?? "N");
  const textSize = 22 * scale;
  const box = { width: size, height: size + (letter ? textSize + 6 * scale : 0), scale };
  const at = legendPosition(box, info, options.corner ?? "topRight");
  return callHost<FurnitureResult>("addNorthArrow", {
    mapId,
    position: [Math.round(at.x + size / 2), Math.round(at.y + size / 2)],
    points: northArrowPath(size),
    letter,
    fonts: fontsFor(letter || "N", options.template),
    style: {
      color: hexToRgb(theme.text),
      textColor: hexToRgb(theme.text),
      haloColor: hexToRgb(theme.halo),
      haloWidth: Math.max(1, Math.round(2 * scale)),
      textSize,
      size,
      justify: "center"
    },
    expressions: { rotation: northRotationExpression() }
  });
}

/** An inset map in a corner - a locator - with a box on it showing where the big map is looking. */
export type MinimapOptions = FurnitureOptions & {
  /** How many zoom levels wider than the map itself the inset looks. */
  zoomOut?: number;
  /** How much of the frame the inset takes, as a share of its width. */
  share?: number;
  projection?: "mercator" | "globe";
};

export type MinimapResult = { insetId: string; insetComp: string; name: string; zoom: number; removed: number; expressionErrors: string[] };

export async function addMinimap(mapId: string, options: MinimapOptions = {}): Promise<MinimapResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const theme = themeFrom(options.theme);
  const scale = info.height / 1080;
  const share = Math.max(0.1, Math.min(0.5, options.share ?? 0.25));
  const box = { width: Math.round(info.width * share), height: Math.round(info.height * share), scale };
  const at = legendPosition(box, info, options.corner ?? "topLeft");
  return callHost<MinimapResult>("addMinimap", {
    mapId,
    name: "Inset map",
    width: box.width,
    height: box.height,
    position: [Math.round(at.x), Math.round(at.y)],
    zoomOut: options.zoomOut ?? 4,
    projection: options.projection ?? "mercator",
    frame: { color: hexToRgb(theme.border), width: Math.max(1, Math.round(2 * scale)) },
    box: { color: hexToRgb(theme.accent), width: Math.max(1, Math.round(2 * scale)) },
    expressions: { box: minimapBoxExpression() }
  });
}

export const removeMinimap = (mapId: string) => callHost<{ removed: number }>("removeMinimap", { mapId });

export const removeFurniture = (mapId: string, kind: FurnitureKind) => callHost<{ removed: number }>("removeFurniture", { mapId, kind });
