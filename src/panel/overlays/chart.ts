// The chart of a map's numbers, as an After Effects precomp: the panel measures the text (only a
// browser can), core works out the box and the bars (core/style/chart.ts), and the host builds the
// layers and the growth keys.

import { chartLayout, DEFAULT_CHART_BARS, type ChartRow } from "../../core/style/chart.ts";
import { DEFAULT_CHART_LINES, lineChartLayout, type LineChartRow } from "../../core/style/lineChart.ts";
import { chartTimeRemapExpression, growingLineExpression, lineHeadExpression, lineLabelExpression, lineValueExpression } from "../../core/ae/chartExpressions.ts";
import { categoryPaletteById } from "../../core/style/categories.ts";
import { dataFillColors, type DataFill } from "../../core/style/dataFill.ts";
import { SCRIPT_FONTS, scriptOf } from "../../core/labels/language.ts";
import { templateFonts, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { legendPosition, type LegendCorner } from "../../core/style/legend.ts";
import { resolveLayerStyle, type LayerStyle } from "../../core/style/layerStyle.ts";
import { hexToRgb, themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import { callHost } from "../cep.ts";
import { measure } from "../labels/autoLabels.ts";

type Info = { width: number; height: number; frameRate: number };

export type ChartOptions = {
  /** Where in the frame it sits. */
  corner?: LegendCorner;
  theme?: ThemeLike;
  style?: LayerStyle | null;
  /** The map's label template, so the chart is set in the same font as the names. */
  template?: LabelTemplate | null;
  /** A title of your own; without one the column's name is used. */
  title?: string;
  /** Bars beyond this many are left out, longest first. */
  limit?: number;
  /** The frame the first bar starts growing on. */
  startFrame?: number;
  /** Every bar in the colour of its step (the default), or all in the map's layer colour. */
  colorByValue?: boolean;
};

export type ChartResult = { name: string; comp: string; bars: number; removed: number; dropped: number };

/** What each place is called, for the bar beside it. */
export type ChartPlace = { code: string; name: string; value: number };

/** Builds (or rebuilds) the chart of a map's numbers. */
export async function addChart(mapId: string, fill: DataFill, places: ChartPlace[], options: ChartOptions = {}): Promise<ChartResult> {
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
  const rows: ChartRow[] = places.map((place) => ({
    label: place.name,
    value: place.value,
    color: (options.colorByValue ?? true ? colours.colors[place.code] : look.accent) ?? look.accent,
    labelWidth: measure(place.name, scriptOf(place.name), rowSize, 400, 0),
    valueWidth: measure(place.value.toLocaleString("en-US"), "latin", rowSize, 400, 0)
  }));
  const layout = chartLayout(rows, {
    height: info.height,
    title,
    titleWidth: measure(title, script, titleSize, 600, 0),
    limit: options.limit ?? DEFAULT_CHART_BARS,
    startFrame: options.startFrame ?? 0,
    growFrames: Math.round(info.frameRate * 0.5),
    staggerFrames: Math.round(info.frameRate * 0.12)
  });
  const position = legendPosition(layout, { width: info.width, height: info.height }, options.corner ?? "bottomRight");
  const made = await callHost<Omit<ChartResult, "dropped">>("addChart", {
    mapId,
    name: `Chart: ${title || fill.column}`,
    width: Math.ceil(layout.width),
    height: Math.ceil(layout.height),
    position: [Math.round(position.x), Math.round(position.y)],
    scale,
    background: { color: hexToRgb(look.panel), opacity: 88, radius: layout.radius },
    border: { color: hexToRgb(theme.border), width: Math.max(1, Math.round(layout.scale)) },
    title: title ? { text: title, x: layout.title.x, y: layout.title.y, size: layout.title.size } : null,
    textColor: hexToRgb(theme.text),
    fonts,
    rowSize: layout.rowSize,
    bars: layout.bars.map((bar) => ({ label: bar.label, valueText: bar.valueText, color: hexToRgb(bar.color), bar: bar.bar, labelAt: bar.labelAt, valueAt: bar.valueAt, from: bar.from, to: bar.to }))
  });
  return { ...made, dropped: layout.dropped };
}

export type LineChartResult = { name: string; comp: string; lines: number; removed: number; dropped: number; expressionErrors: string[] };

/**
 * Builds (or rebuilds) the chart of a map's numbers over the years: a line per place (or an area),
 * each in its own colour, that stands at the year the map shows.
 */
export async function addLineChart(mapId: string, fill: DataFill, places: { code: string; name: string }[], options: ChartOptions & { area?: boolean } = {}): Promise<LineChartResult> {
  if (!fill.series) throw new Error("a chart over the years needs a table with years");
  const info = await callHost<Info & { frames: number }>("renderInfo", { mapId });
  const theme = themeFrom(options.theme);
  const look = options.style ?? resolveLayerStyle(theme);
  const title = (options.title ?? fill.column).trim();
  const script = scriptOf(title || "A");
  const fonts = options.template ? templateFonts(options.template, SCRIPT_FONTS[script].regular, script) : SCRIPT_FONTS[script].regular;
  const scale = info.height / 1080;
  const textSize = 16 * scale;
  const times = fill.series.times;
  // Lines need telling apart, not ranking: each gets its own colour of the colour-blind safe set.
  const palette = categoryPaletteById("safe").colours;
  const rows: LineChartRow[] = places
    .filter((place) => fill.series!.values[place.code])
    .map((place, index) => ({ label: place.name, color: palette[index % palette.length], values: fill.series!.values[place.code], labelWidth: measure(`${place.name}  000,000`, scriptOf(place.name), textSize, 400, 0) }));
  const layout = lineChartLayout(rows, { height: info.height, times, title, titleWidth: measure(title, script, 26 * scale, 600, 0), limit: options.limit ?? DEFAULT_CHART_LINES, area: options.area });
  // Colours by final rank, so the largest place is always the first colour.
  layout.lines.forEach((line, index) => (line.color = palette[index % palette.length]));
  const position = legendPosition(layout, { width: info.width, height: info.height }, options.corner ?? "bottomRight");
  const duration = info.frames / info.frameRate;
  const span = Math.max(1 / info.frameRate, duration - 1 / info.frameRate);
  const radius = Math.max(2, layout.textSize / 3.2);
  const made = await callHost<Omit<LineChartResult, "dropped">>("addLineChart", {
    mapId,
    name: `Chart: ${title || fill.column}`,
    width: Math.ceil(layout.width),
    height: Math.ceil(layout.height),
    position: [Math.round(position.x), Math.round(position.y)],
    background: { color: hexToRgb(look.panel), opacity: 88, radius: layout.radius },
    border: { color: hexToRgb(theme.border), width: Math.max(1, Math.round(layout.scale)) },
    title: layout.title && title ? { text: title, ...layout.title } : null,
    textColor: hexToRgb(theme.text),
    mutedColor: hexToRgb(theme.border),
    fonts,
    textSize: layout.textSize,
    padding: layout.padding,
    plot: layout.plot,
    baseline: layout.baseline,
    xTicks: layout.xTicks,
    yTicks: layout.yTicks,
    area: layout.area,
    lines: layout.lines.map((line, index) => ({
      label: line.label,
      color: hexToRgb(line.color),
      expressions: {
        path: growingLineExpression(line.points, times, span, layout.area ? { baseline: layout.baseline } : null),
        head: lineHeadExpression(line.points, times, span),
        value: lineValueExpression(line.values, times, span, `${line.label}  `),
        label: lineLabelExpression(layout.lines.map((l) => l.points), index, times, span, radius * 2.2, layout.textSize * 0.35, layout.textSize * 1.15)
      }
    })),
    remap: chartTimeRemapExpression(times, span)
  });
  return { ...made, dropped: layout.dropped };
}

export const removeChart = (mapId: string) => callHost<{ removed: number }>("removeChart", { mapId });
