// Where the parts of a legend sit. The panel measures the text (only a browser can), core works out
// the box, the swatches and the baselines, and the host builds the layers from these numbers.
//
// A legend can show colours (a square per step), sizes (a circle per bubble size, a spike per spike
// height), or both.

export type LegendRow = { color: string; label: string; width: number };
/** A size on the map and what it stands for, in comp pixels: a bubble's radius, or a spike's width and height. */
export type LegendSize = { label: string; width: number; radius?: number; spike?: { width: number; height: number } };

export type LegendOptions = {
  /** Comp height in pixels; every size here is for 1080 lines and scales with it. */
  height: number;
  title: string;
  titleWidth: number;
  /** Size of the title and of a row, in 1080-line pixels. */
  titleSize?: number;
  rowSize?: number;
  /** Circles for a bubble legend and spikes for a spike legend, largest first. */
  sizes?: LegendSize[];
  /** The colour the circles and spikes are drawn in. */
  sizeColor?: string;
};

export type LegendItem = {
  color: string;
  label: string;
  shape: "rect" | "circle" | "spike";
  /** The box the shape fills: for a circle, the square around it. */
  swatch: { x: number; y: number; width: number; height: number };
  text: { x: number; y: number };
  size: number;
};

export type LegendLayout = {
  width: number;
  height: number;
  scale: number;
  /** Text baseline of the title, from the top left of the box. */
  title: { x: number; y: number; size: number };
  rows: LegendItem[];
  padding: number;
  radius: number;
};

const PADDING = 22;
const TITLE_SIZE = 26;
const ROW_SIZE = 20;
const ROW_GAP = 12;
const SWATCH = 22;
const SWATCH_GAP = 12;
const TITLE_GAP = 16;

/** The box, the swatches and the baselines of a legend, in comp pixels. */
export function legendLayout(rows: LegendRow[], options: LegendOptions): LegendLayout {
  const scale = Math.max(0.2, options.height / 1080);
  const titleSize = (options.titleSize ?? TITLE_SIZE) * scale;
  const rowSize = (options.rowSize ?? ROW_SIZE) * scale;
  const padding = PADDING * scale;
  const swatch = SWATCH * scale;
  const swatchGap = SWATCH_GAP * scale;
  const rowGap = ROW_GAP * scale;
  const rowHeight = Math.max(swatch, rowSize * 1.2);
  const sizes = options.sizes ?? [];
  const widestSize = sizes.reduce((most, size) => Math.max(most, size.spike ? size.spike.width : (size.radius ?? 0) * 2), 0);
  // One column for every swatch, wide enough for the largest circle or spike as well.
  const column = Math.max(swatch, widestSize);
  const hasTitle = !!options.title.trim();
  const titleHeight = hasTitle ? titleSize * 1.15 + TITLE_GAP * scale : 0;
  const widest = Math.max(rows.reduce((most, row) => Math.max(most, row.width), 0), sizes.reduce((most, size) => Math.max(most, size.width), 0));
  const width = padding * 2 + Math.max(hasTitle ? options.titleWidth : 0, column + swatchGap + widest);

  const laid: LegendItem[] = [];
  let top = padding + titleHeight;
  for (const row of rows) {
    laid.push({
      color: row.color,
      label: row.label,
      shape: "rect",
      swatch: { x: padding + (column - swatch) / 2, y: top + (rowHeight - swatch) / 2, width: swatch, height: swatch },
      // The baseline sits a little above the middle of the row, where text looks centred.
      text: { x: padding + column + swatchGap, y: top + rowHeight / 2 + rowSize * 0.36 },
      size: rowSize
    });
    top += rowHeight + rowGap;
  }
  for (const size of sizes) {
    // A circle for a bubble, a triangle for a spike, each centred in the column.
    const box = size.spike ? { width: size.spike.width, height: size.spike.height } : { width: (size.radius ?? 0) * 2, height: (size.radius ?? 0) * 2 };
    const height = Math.max(rowHeight, box.height);
    laid.push({
      color: options.sizeColor ?? "#ffffff",
      label: size.label,
      shape: size.spike ? "spike" : "circle",
      swatch: { x: padding + column / 2 - box.width / 2, y: top + height / 2 - box.height / 2, width: box.width, height: box.height },
      text: { x: padding + column + swatchGap, y: top + height / 2 + rowSize * 0.36 },
      size: rowSize
    });
    top += height + rowGap;
  }
  const height = laid.length ? top - rowGap + padding : padding * 2 + titleHeight;
  return { width, height, scale, title: { x: padding, y: padding + titleSize * 0.85, size: titleSize }, rows: laid, padding, radius: 8 * scale };
}

export type LegendCorner = "bottomLeft" | "bottomRight" | "topLeft" | "topRight";

/** Where the box sits in the comp: a corner, a margin in from the frame. */
export function legendPosition(layout: LegendLayout, comp: { width: number; height: number }, corner: LegendCorner, margin = 48): { x: number; y: number } {
  const inset = margin * layout.scale;
  const left = corner === "bottomLeft" || corner === "topLeft";
  const top = corner === "topLeft" || corner === "topRight";
  return { x: left ? inset : comp.width - inset - layout.width, y: top ? inset : comp.height - inset - layout.height };
}
