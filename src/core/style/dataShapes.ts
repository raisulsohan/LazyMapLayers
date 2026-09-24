// Shape layers driven by the numbers: every place with a value becomes an editable After Effects
// shape layer whose fill colour, fill strength and stroke width come from that value. The panel
// already colours the map as one rendered layer (dataFill.ts); this is for when the designer wants
// the outlines themselves - to animate one country, to put a glow on the biggest, to restyle by hand.

import { dataFillColors, type DataFill } from "./dataFill.ts";

export type DataShapeOptions = {
  /** Shapes beyond this many are left out, largest value first: each one costs expressions per frame. */
  limit?: number;
  /** Fill strength of the largest value, and of the smallest (0 to 1). */
  fillMost?: number;
  fillLeast?: number;
  /** Stroke width in 1080-line pixels of the largest and the smallest value. */
  strokeMost?: number;
  strokeLeast?: number;
  /** Every shape in the step's colour (the default), or all in one colour. */
  colorByValue?: boolean;
  /** The one colour, when the colours are not from the ramp. */
  color?: string;
};

export const MAX_DATA_SHAPES = 40;
export const DEFAULT_DATA_SHAPES = { fillMost: 0.85, fillLeast: 0.25, strokeMost: 4, strokeLeast: 1 };

export type DataShape = {
  /** The map's own code for the place (a country code, a province or district id). */
  code: string;
  value: number;
  color: string;
  fill: number;
  outline: number;
};

export type DataShapeSet = {
  shapes: DataShape[];
  /** Places left out by the limit. */
  dropped: number;
  /** The values the largest and the smallest shape stand for. */
  most: number;
  least: number;
};

const between = (share: number, least: number, most: number) => least + (most - least) * share;

/**
 * A shape per place that has a number, largest first. The share of a value between the smallest and
 * the largest decides its fill strength and stroke width; its colour is the step of the ramp the
 * choropleth would give it, so the shapes and the rendered layer agree.
 */
export function dataShapes(fill: DataFill, options: DataShapeOptions = {}): DataShapeSet {
  const colours = dataFillColors(fill);
  const limit = Math.max(1, Math.round(options.limit ?? MAX_DATA_SHAPES));
  const fillMost = options.fillMost ?? DEFAULT_DATA_SHAPES.fillMost;
  const fillLeast = options.fillLeast ?? DEFAULT_DATA_SHAPES.fillLeast;
  const strokeMost = options.strokeMost ?? DEFAULT_DATA_SHAPES.strokeMost;
  const strokeLeast = options.strokeLeast ?? DEFAULT_DATA_SHAPES.strokeLeast;
  const entries = Object.entries(fill.values)
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1]);
  const most = entries[0]?.[1] ?? 0;
  const least = entries[entries.length - 1]?.[1] ?? 0;
  const span = most - least;
  const kept = entries.slice(0, limit);
  const shapes = kept.map(([code, value]) => {
    // One value alone, or all the same: every shape is the strongest, not the weakest.
    const share = span > 0 ? (value - least) / span : 1;
    return {
      code,
      value,
      color: (options.colorByValue ?? true ? colours.colors[code] : options.color) ?? options.color ?? colours.colors[code] ?? "#ffffff",
      fill: Math.round(between(share, fillLeast, fillMost) * 100) / 100,
      outline: Math.round(between(share, strokeLeast, strokeMost) * 100) / 100
    };
  });
  return { shapes, dropped: entries.length - kept.length, most, least };
}
