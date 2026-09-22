// Flows: a table of "from, to, how much" - migration, trade, flights, calls - drawn as one arc per
// row whose width follows the value. Core reads the rows and works out the widths; the panel finds
// the places and builds the routes.

import type { DataTable } from "./dataTable.ts";
import { toNumber } from "./dataTable.ts";
import { formatValue } from "../style/valueScale.ts";

export type FlowRow = { from: string; to: string; value: number; row: number };

/** The two text columns and the number column a table of flows is most likely to use. */
export function guessFlowColumns(table: DataTable): { from: number; to: number; value: number } | null {
  const texts = table.columns.filter((column) => column.kind === "text" && column.filled);
  const numbers = table.columns.filter((column) => column.kind === "number" && column.filled);
  if (texts.length < 2 || !numbers.length) return null;
  const named = (words: RegExp) => texts.find((column) => words.test(column.name.toLowerCase()));
  const from = named(/^(from|origin|source|start|departure|dep)\b|_from$|^o$/) ?? texts[0];
  const to = named(/^(to|destination|dest|target|end|arrival|arr)\b|_to$|^d$/) ?? texts.find((column) => column !== from) ?? texts[1];
  if (from === to) return null;
  const value = numbers.find((column) => /value|count|flow|amount|volume|passengers|trade|migrants|weight|total|number/.test(column.name.toLowerCase())) ?? numbers[0];
  return { from: from.index, to: to.index, value: value.index };
}

/** The rows of a flow table, with the empty and the valueless ones left out. */
export function flowRows(table: DataTable, from: number, to: number, value: number): FlowRow[] {
  const out: FlowRow[] = [];
  table.rows.forEach((cells, row) => {
    const a = (cells[from] ?? "").trim();
    const b = (cells[to] ?? "").trim();
    const amount = toNumber(cells[value] ?? "");
    if (!a || !b || !Number.isFinite(amount) || amount <= 0) return;
    out.push({ from: a, to: b, value: amount, row });
  });
  return out;
}

export type FlowWidths = { widthFor: (value: number) => number; min: number; max: number; legend: { value: number; width: number; label: string }[] };

/**
 * Line widths for the values, in 1080-line pixels: the largest value gets `maxWidth`, the rest
 * follow in proportion, and nothing draws thinner than `minWidth`. Width, not area: a line twice as
 * wide reads as twice as much.
 */
export function flowWidths(values: number[], options: { minWidth?: number; maxWidth?: number } = {}): FlowWidths {
  const minWidth = options.minWidth ?? 1.5;
  const maxWidth = Math.max(minWidth, options.maxWidth ?? 14);
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  const top = usable.length ? Math.max(...usable) : 0;
  const widthFor = (value: number) => (top > 0 && value > 0 ? Math.max(minWidth, (value / top) * maxWidth) : minWidth);
  // A legend of three: the largest, a half and a quarter of it.
  const legend = top > 0 ? [1, 0.5, 0.25].map((share) => ({ value: top * share, width: widthFor(top * share), label: formatValue(top * share) })) : [];
  return { widthFor, min: minWidth, max: maxWidth, legend };
}

/** The distinct place names a set of flows needs, so each is looked up once. */
export function flowPlaceNames(rows: FlowRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.from);
    seen.add(row.to);
  }
  return [...seen];
}
