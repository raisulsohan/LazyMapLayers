// A chart of the numbers on the map, as a precomp in the scene: one bar per place, longest first,
// each growing from nothing in turn. Core works out the box, the bars and the baselines in comp
// pixels (the panel measures the text, as only a browser can); the host builds the layers.

import { formatValue } from "./valueScale.ts";

export type ChartRow = {
  /** What the bar stands for. */
  label: string;
  value: number;
  color: string;
  /** Measured widths, in comp pixels. */
  labelWidth: number;
  valueWidth: number;
};

export type ChartOptions = {
  /** Comp height in pixels; every size here is for 1080 lines and scales with it. */
  height: number;
  title: string;
  titleWidth: number;
  titleSize?: number;
  rowSize?: number;
  /** How wide the bars are allowed to grow, in 1080-line pixels. */
  barLength?: number;
  /** Bars beyond this many are left out, longest first. */
  limit?: number;
  /** Frames: when the first bar starts growing, how long each takes, and the wait between bars. */
  startFrame?: number;
  growFrames?: number;
  staggerFrames?: number;
};

export type ChartBar = {
  label: string;
  value: number;
  color: string;
  /** The bar at its full length, in comp pixels from the top left of the chart. */
  bar: { x: number; y: number; width: number; height: number };
  /** Baselines of the place's name (left of the bar) and of its number (after the bar's end). */
  labelAt: { x: number; y: number };
  valueAt: { x: number; y: number };
  valueText: string;
  /** Frames at which this bar starts and finishes growing. */
  from: number;
  to: number;
};

export type ChartLayout = {
  width: number;
  height: number;
  scale: number;
  title: { x: number; y: number; size: number };
  rowSize: number;
  bars: ChartBar[];
  padding: number;
  radius: number;
  /** Places the limit left out. */
  dropped: number;
};

const PADDING = 22;
const TITLE_SIZE = 26;
const ROW_SIZE = 20;
const ROW_GAP = 10;
const BAR_HEIGHT = 22;
const BAR_LENGTH = 320;
const LABEL_GAP = 12;
const TITLE_GAP = 16;
export const DEFAULT_CHART_BARS = 8;

/**
 * The box, the bars and the baselines of a chart, in comp pixels. Values of zero or less draw no
 * bar (a bar cannot show "none"), and the longest bar is the largest value.
 */
export function chartLayout(rows: ChartRow[], options: ChartOptions): ChartLayout {
  const scale = Math.max(0.2, options.height / 1080);
  const titleSize = (options.titleSize ?? TITLE_SIZE) * scale;
  const rowSize = (options.rowSize ?? ROW_SIZE) * scale;
  const padding = PADDING * scale;
  const rowGap = ROW_GAP * scale;
  const barHeight = BAR_HEIGHT * scale;
  const barLength = (options.barLength ?? BAR_LENGTH) * scale;
  const labelGap = LABEL_GAP * scale;
  const limit = Math.max(1, Math.round(options.limit ?? DEFAULT_CHART_BARS));
  const usable = rows.filter((row) => Number.isFinite(row.value) && row.value > 0).sort((a, b) => b.value - a.value);
  const kept = usable.slice(0, limit);
  const most = kept[0]?.value ?? 0;
  const labelColumn = kept.reduce((widest, row) => Math.max(widest, row.labelWidth), 0);
  const valueColumn = kept.reduce((widest, row) => Math.max(widest, row.valueWidth), 0);
  const hasTitle = !!options.title.trim();
  const titleHeight = hasTitle ? titleSize * 1.15 + TITLE_GAP * scale : 0;
  const width = padding * 2 + Math.max(hasTitle ? options.titleWidth : 0, labelColumn + labelGap + barLength + labelGap + valueColumn);
  const start = options.startFrame ?? 0;
  const grow = Math.max(1, Math.round(options.growFrames ?? 12));
  const stagger = Math.max(0, Math.round(options.staggerFrames ?? 3));

  const bars: ChartBar[] = [];
  let top = padding + titleHeight;
  kept.forEach((row, index) => {
    const length = most > 0 ? Math.max(2 * scale, (row.value / most) * barLength) : 0;
    const x = padding + labelColumn + labelGap;
    bars.push({
      label: row.label,
      value: row.value,
      color: row.color,
      bar: { x, y: top, width: length, height: barHeight },
      // The name sits against the bar's left edge, the number just past its end.
      labelAt: { x: padding + labelColumn - row.labelWidth, y: top + barHeight / 2 + rowSize * 0.36 },
      valueAt: { x: x + length + labelGap, y: top + barHeight / 2 + rowSize * 0.36 },
      valueText: formatValue(row.value),
      from: start + index * stagger,
      to: start + index * stagger + grow
    });
    top += barHeight + rowGap;
  });
  const height = bars.length ? top - rowGap + padding : padding * 2 + titleHeight;
  return {
    width,
    height,
    scale,
    title: { x: padding, y: padding + titleSize * 0.85, size: titleSize },
    rowSize,
    bars,
    padding,
    radius: 8 * scale,
    dropped: usable.length - kept.length
  };
}
