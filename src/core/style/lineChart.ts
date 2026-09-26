// A chart of numbers over the years, as a precomp in the scene: a line per place (or a filled area
// under it) that grows year by year in step with the map. Core works out the plot box, the scales,
// the ticks and every point in comp pixels; the host builds the layers and the expressions that grow
// the lines (core/ae/chartExpressions.ts).
//
// The precomp runs from the first year at its start to the last at its end; the chart's layer in the
// scene is time-remapped by the map's Data Time slider, so the lines always stand at the year the
// map shows, however the slider is keyed.

import { valueAt } from "../data/series.ts";
import { formatValue } from "./valueScale.ts";

export type LineChartRow = { label: string; color: string; values: (number | null)[]; labelWidth: number };

export type LineChartOptions = {
  /** Comp height in pixels; every size here is for 1080 lines and scales with it. */
  height: number;
  times: number[];
  title: string;
  titleWidth: number;
  /** Lines beyond this many are left out, the largest at the last year first. */
  limit?: number;
  /** Filled areas under the lines instead of lines alone. */
  area?: boolean;
};

export type LineChartLine = {
  label: string;
  color: string;
  /** Every year's point, in chart pixels (y down); a gap is filled straight between its neighbours. */
  points: [number, number][];
  /** The values at those years, for the number that rides the head of the line. */
  values: number[];
  labelWidth: number;
};

export type LineChartLayout = {
  width: number;
  height: number;
  scale: number;
  padding: number;
  radius: number;
  title: { x: number; y: number; size: number } | null;
  /** The plot area, in chart pixels. */
  plot: { x: number; y: number; width: number; height: number };
  /** Baseline (value 0) in chart pixels. */
  baseline: number;
  times: number[];
  xTicks: { x: number; text: string }[];
  yTicks: { y: number; text: string }[];
  lines: LineChartLine[];
  textSize: number;
  area: boolean;
  dropped: number;
};

const PADDING = 22;
const TITLE_SIZE = 26;
const TEXT_SIZE = 16;
const PLOT_WIDTH = 460;
const PLOT_HEIGHT = 240;
export const DEFAULT_CHART_LINES = 5;

/** A round top for the value axis: 1, 2 or 5 times a power of ten, at or above the largest value. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/** Up to `count` years to write under the axis: the first, the last and evenly between, on whole years. */
export function yearTicks(times: number[], count = 5): number[] {
  if (!times.length) return [];
  const first = times[0];
  const last = times[times.length - 1];
  if (first === last) return [first];
  const span = last - first;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => span / s <= count - 1) ?? Math.ceil(span / (count - 1));
  const out: number[] = [first];
  for (let year = Math.ceil(first / step) * step; year < last; year += step) if (year - first >= step / 2 && last - year >= step / 2) out.push(year);
  out.push(last);
  return out;
}

export function lineChartLayout(rows: LineChartRow[], options: LineChartOptions): LineChartLayout {
  const scale = Math.max(0.2, options.height / 1080);
  const padding = PADDING * scale;
  const titleSize = TITLE_SIZE * scale;
  const textSize = TEXT_SIZE * scale;
  const times = options.times;
  const first = times[0];
  const last = times[times.length - 1];
  const limit = Math.max(1, Math.round(options.limit ?? DEFAULT_CHART_LINES));
  const lastValue = (row: LineChartRow) => valueAt(times, row.values, last) ?? -Infinity;
  const usable = rows.filter((row) => row.values.some((v) => v !== null)).sort((a, b) => lastValue(b) - lastValue(a));
  const kept = usable.slice(0, limit);
  let most = 0;
  for (const row of kept) for (let i = 0; i < times.length; i++) most = Math.max(most, valueAt(times, row.values, times[i]) ?? 0);
  const top = niceCeiling(most);
  const hasTitle = !!options.title.trim();
  const titleHeight = hasTitle ? titleSize * 1.15 + 14 * scale : 0;
  const axisWidth = Math.max(...[top, top / 2, 0].map((v) => formatValue(v).length)) * textSize * 0.6 + 8 * scale;
  const labelColumn = kept.reduce((widest, row) => Math.max(widest, row.labelWidth), 0) + 70 * scale;
  const plot = { x: padding + axisWidth, y: padding + titleHeight + textSize * 0.6, width: PLOT_WIDTH * scale, height: PLOT_HEIGHT * scale };
  const width = Math.max(hasTitle ? padding * 2 + options.titleWidth : 0, plot.x + plot.width + 12 * scale + labelColumn + padding);
  const height = plot.y + plot.height + textSize * 1.8 + padding;
  const xOf = (time: number) => (last === first ? plot.x : plot.x + ((time - first) / (last - first)) * plot.width);
  const yOf = (value: number) => plot.y + plot.height - (top > 0 ? (value / top) * plot.height : 0);
  const lines: LineChartLine[] = kept.map((row) => {
    const values = times.map((time) => valueAt(times, row.values, time) ?? 0);
    return { label: row.label, color: row.color, labelWidth: row.labelWidth, values, points: times.map((time, i) => [xOf(time), yOf(values[i])] as [number, number]) };
  });
  return {
    width,
    height,
    scale,
    padding,
    radius: 10 * scale,
    title: hasTitle ? { x: padding, y: padding + titleSize, size: titleSize } : null,
    plot,
    baseline: yOf(0),
    times,
    xTicks: yearTicks(times).map((year) => ({ x: xOf(year), text: String(year) })),
    yTicks: [0, top / 2, top].map((value) => ({ y: yOf(value), text: formatValue(value) })),
    lines,
    textSize,
    area: options.area === true,
    dropped: usable.length - kept.length
  };
}
