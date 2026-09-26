// Numbers over time: a table with a value per place per year becomes a map that changes as the years
// go by. Tables come two ways round: wide, with a column per year (as the World Bank and the UN
// publish them), or long, with a row per place per year (as Our World in Data does). Both are read
// into the same thing - the years, and each place's value in each year, or nothing where the table
// has a gap.

import { toNumber, type DataTable } from "./dataTable.ts";

export type SeriesShape = { kind: "wide"; columns: { index: number; time: number }[] } | { kind: "long"; timeColumn: number };

export type Series = {
  /** The times, rising: years, or any numbers the table counts in. */
  times: number[];
  rows: { key: string; values: (number | null)[] }[];
};

/** A heading or a cell that names a year: 1990, "1990", "1990.0", "YR1990", "[1990]". */
export function yearOf(text: string): number | null {
  const match = String(text ?? "").trim().match(/^\[?(?:YR)?(1[5-9]\d\d|2[01]\d\d)(?:\.0+)?\]?$/i);
  return match ? Number(match[1]) : null;
}

/** How a table holds its years, or null when it holds none. */
export function detectSeries(table: DataTable): SeriesShape | null {
  const wide = table.headings.map((heading, index) => ({ index, time: yearOf(heading) })).filter((c): c is { index: number; time: number } => c.time !== null && table.columns[c.index]?.kind === "number");
  if (wide.length >= 2) return { kind: "wide", columns: wide.sort((a, b) => a.time - b.time) };
  // A column called year or date, or one whose every cell is a year, next to a key that repeats.
  const named = table.headings.findIndex((heading) => /^(year|years|date|time|period|jahr|année|annee|año|ano|anno)$/i.test(heading.trim()));
  const candidates = named >= 0 ? [named] : table.columns.map((c) => c.index);
  for (const index of candidates) {
    const cells = table.rows.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    if (cells.length < 2 || !cells.every((cell) => yearOf(cell) !== null)) continue;
    const distinct = new Set(cells).size;
    if (distinct >= 2 && distinct < cells.length) return { kind: "long", timeColumn: index };
  }
  return null;
}

/**
 * The series of one value column (wide tables have one value per year column instead). Rows with the
 * same key are one place; a year a place has no number for stays empty.
 */
export function readSeries(table: DataTable, shape: SeriesShape, keyColumn: number, valueColumn: number): Series {
  if (shape.kind === "wide") {
    const times = shape.columns.map((c) => c.time);
    const rows: Series["rows"] = [];
    const seen = new Set<string>();
    for (const row of table.rows) {
      const key = (row[keyColumn] ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const values = shape.columns.map((c) => {
        const value = toNumber(row[c.index] ?? "");
        return Number.isFinite(value) ? value : null;
      });
      if (values.some((v) => v !== null)) rows.push({ key, values });
    }
    return { times, rows };
  }
  const times = [...new Set(table.rows.map((row) => yearOf(row[shape.timeColumn] ?? "")).filter((t): t is number => t !== null))].sort((a, b) => a - b);
  const at = new Map(times.map((t, i) => [t, i]));
  const byKey = new Map<string, (number | null)[]>();
  for (const row of table.rows) {
    const key = (row[keyColumn] ?? "").trim();
    const time = yearOf(row[shape.timeColumn] ?? "");
    const value = toNumber(row[valueColumn] ?? "");
    if (!key || time === null) continue;
    const values = byKey.get(key) ?? times.map(() => null);
    if (Number.isFinite(value)) values[at.get(time)!] = value;
    byKey.set(key, values);
  }
  return { times, rows: [...byKey.entries()].filter(([, values]) => values.some((v) => v !== null)).map(([key, values]) => ({ key, values })) };
}

/**
 * A place's value at any moment: straight between the years around it, the first known value before
 * its first year and the last after its last, so a map never flickers to empty in a gap.
 */
export function valueAt(times: number[], values: (number | null)[], time: number): number | null {
  let before = -1;
  let after = -1;
  for (let i = 0; i < times.length; i++) {
    if (values[i] === null || values[i] === undefined) continue;
    if (times[i] <= time) before = i;
    if (times[i] >= time && after < 0) after = i;
  }
  if (before < 0 && after < 0) return null;
  if (before < 0) return values[after] as number;
  if (after < 0) return values[before] as number;
  if (before === after || times[after] === times[before]) return values[before] as number;
  const t = (time - times[before]) / (times[after] - times[before]);
  return (values[before] as number) + ((values[after] as number) - (values[before] as number)) * t;
}

/** The years a series covers, as the sheet says them: "1990-2020 (31 years)". */
export const describeSeries = (series: Series): string =>
  series.times.length ? `${series.times[0]}-${series.times[series.times.length - 1]} (${series.times.length} ${series.times.length === 1 ? "year" : "years"})` : "no years";
