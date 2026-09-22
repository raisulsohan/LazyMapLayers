// The legend of the numbers on a map, as an After Effects precomp: the panel measures the text, core
// works out the box (core/style/legend.ts), and the host builds the layers.

import { dataFillColors, type DataFill } from "../../core/style/dataFill.ts";
import { legendLayout, legendPosition, type LegendCorner, type LegendSize } from "../../core/style/legend.ts";
import { resolveLayerStyle, type LayerStyle } from "../../core/style/layerStyle.ts";
import { hexToRgb, themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import { SCRIPT_FONTS, scriptOf } from "../../core/labels/language.ts";
import { templateFonts, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { callHost } from "../cep.ts";
import { measure } from "../labels/autoLabels.ts";

type Info = { width: number; height: number; frameRate: number };

export type LegendOptions = {
  /** Where in the frame it sits. */
  corner?: LegendCorner;
  /** The map's look, for the panel colour and the text colour. */
  theme?: ThemeLike;
  /** The style of the layers this map generates: the legend takes its panel colour from it. */
  style?: LayerStyle | null;
  /** The map's label template, so the legend is set in the same font as the names. */
  template?: LabelTemplate | null;
  /** A title of your own; without one the column's name is used. */
  title?: string;
  /** Circles for the bubbles on the map, largest first, with their radii in comp pixels. */
  sizes?: { radius: number; label: string }[];
};

export type LegendResult = { name: string; comp: string; rows: number; removed: number };

/** Builds (or rebuilds) the legend of a map's data fill. */
export async function addLegend(mapId: string, fill: DataFill, options: LegendOptions = {}): Promise<LegendResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const theme = themeFrom(options.theme);
  const look = options.style ?? resolveLayerStyle(theme);
  const colours = dataFillColors(fill);
  const title = (options.title ?? fill.column).trim();
  const script = scriptOf(title || "A");
  const fonts = options.template ? templateFonts(options.template, SCRIPT_FONTS[script].regular, script) : SCRIPT_FONTS[script].regular;
  const scale = info.height / 1080;
  const titleSize = 26 * scale;
  const rowSize = 20 * scale;
  const rows = colours.legend.map((step) => ({ color: step.color, label: step.label, width: measure(step.label, "latin", rowSize, 400, 0) }));
  const sizes: LegendSize[] = (options.sizes ?? []).map((size) => ({ radius: size.radius, label: size.label, width: measure(size.label, "latin", rowSize, 400, 0) }));
  const layout = legendLayout(rows, { height: info.height, title, titleWidth: measure(title, script, titleSize, 600, 0), sizes, sizeColor: look.accent });
  const position = legendPosition(layout, { width: info.width, height: info.height }, options.corner ?? "bottomLeft");
  return callHost<LegendResult>("addLegend", {
    mapId,
    name: `Legend: ${title || fill.column}`,
    width: Math.ceil(layout.width),
    height: Math.ceil(layout.height),
    position: [Math.round(position.x), Math.round(position.y)],
    background: { color: hexToRgb(look.panel), opacity: 88, radius: layout.radius },
    border: { color: hexToRgb(theme.border), width: Math.max(1, Math.round(layout.scale)) },
    title: title ? { text: title, x: layout.title.x, y: layout.title.y, size: layout.title.size } : null,
    textColor: hexToRgb(theme.text),
    fonts,
    rows: layout.rows.map((row) => ({
      color: hexToRgb(row.color),
      label: row.label,
      size: row.size,
      swatch: row.swatch,
      text: row.text,
      shape: row.shape,
      // A circle stands for a bubble on the map, which is drawn see-through as well.
      fillOpacity: row.shape === "circle" ? 70 : 100,
      radius: Math.round(2 * layout.scale)
    }))
  });
}

export const removeLegend = (mapId: string) => callHost<{ removed: number }>("removeLegend", { mapId });
