// Where the parts of a legend sit. The panel measures the text (only a browser can), core works out
// the box, the swatches and the baselines, and the host builds the layers from these numbers.

export type LegendRow = { color: string; label: string; width: number };

export type LegendOptions = {
  /** Comp height in pixels; every size here is for 1080 lines and scales with it. */
  height: number;
  title: string;
  titleWidth: number;
  /** Size of the title and of a row, in 1080-line pixels. */
  titleSize?: number;
  rowSize?: number;
};

export type LegendLayout = {
  width: number;
  height: number;
  scale: number;
  /** Text baseline of the title, from the top left of the box. */
  title: { x: number; y: number; size: number };
  rows: { color: string; label: string; swatch: { x: number; y: number; width: number; height: number }; text: { x: number; y: number }; size: number }[];
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
  const hasTitle = !!options.title.trim();
  const titleHeight = hasTitle ? titleSize * 1.15 + TITLE_GAP * scale : 0;
  const widest = rows.reduce((most, row) => Math.max(most, row.width), 0);
  const width = padding * 2 + Math.max(hasTitle ? options.titleWidth : 0, swatch + swatchGap + widest);
  const height = padding * 2 + titleHeight + rows.length * rowHeight + Math.max(0, rows.length - 1) * rowGap;
  const laid: LegendLayout["rows"] = rows.map((row, index) => {
    const top = padding + titleHeight + index * (rowHeight + rowGap);
    return {
      color: row.color,
      label: row.label,
      swatch: { x: padding, y: top + (rowHeight - swatch) / 2, width: swatch, height: swatch },
      // The baseline sits a little above the middle of the row, where text looks centred.
      text: { x: padding + swatch + swatchGap, y: top + rowHeight / 2 + rowSize * 0.36 },
      size: rowSize
    };
  });
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
