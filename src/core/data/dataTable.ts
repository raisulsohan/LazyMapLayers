// A table of numbers about places: the rows of a CSV that has no coordinates, only names or codes
// and values. The panel reads which column names the place and which columns hold numbers, so the
// user only has to confirm, and then joins the rows to the countries it knows (join.ts).

/** Rows beyond this many are not a table a designer is colouring a map with. */
export const MAX_DATA_ROWS = 20000;

export type ColumnKind = "text" | "number";

export type DataColumn = {
  index: number;
  name: string;
  kind: ColumnKind;
  /** Rows with something in them. */
  filled: number;
  /** How many of the filled rows read as a number. */
  numeric: number;
  /** Different values, for finding the column that names the place. */
  distinct: number;
};

export type DataTable = {
  name: string;
  headings: string[];
  rows: string[][];
  columns: DataColumn[];
  /** The column that names the place, and the first column of numbers: what the sheet starts with. */
  keyColumn: number;
  valueColumn: number;
};

/** A number as people write it in a table: 1 234,5 | 1,234.5 | 45% | (12) for minus twelve | 1.2e3. */
export function toNumber(cell: string): number {
  const text = (cell ?? "").trim();
  if (!text) return NaN;
  const negative = /^\(.*\)$/.test(text);
  let body = text.replace(/^\(|\)$/g, "").replace(/[\s' ]/g, "").replace(/%$/, "");
  // Dots grouping thousands with a comma for the decimals: 1.234,5.
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(body)) body = body.replace(/\./g, "").replace(",", ".");
  // One comma with exactly three digits after it and nothing else is the English thousands
  // separator, which is how tables of data are usually written: 1,428 is one thousand four hundred.
  else if (/^[+-]?\d{1,3},\d{3}$/.test(body)) body = body.replace(",", "");
  // Any other single comma is a decimal point: 52,52 or 1,4285.
  else if (/^[+-]?\d+,\d+$/.test(body)) body = body.replace(",", ".");
  else body = body.replace(/,/g, "");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(body)) return NaN;
  const value = Number(body);
  return negative ? -value : value;
}

const isNumberCell = (cell: string) => Number.isFinite(toNumber(cell));

/**
 * The table a CSV holds, or null when it is not one: a heading row is needed, and a column of text
 * next to a column of numbers, or next to a second column of text to colour by (a party, a region).
 */
export function readDataTable(rows: string[][], name = "Table"): DataTable | null {
  const filled = (rows ?? []).filter((row) => Array.isArray(row) && row.some((cell) => (cell ?? "").trim() !== ""));
  if (filled.length < 2) return null;
  const width = Math.max(...filled.map((row) => row.length));
  const headings = Array.from({ length: width }, (_, i) => (filled[0][i] ?? "").trim() || `Column ${i + 1}`);
  // The first row is headings when it is not itself all numbers.
  const headingRow = filled[0].filter((cell) => (cell ?? "").trim() !== "");
  if (headingRow.length && headingRow.every(isNumberCell)) return null;
  const body = filled.slice(1, 1 + MAX_DATA_ROWS);
  if (!body.length) return null;

  const columns: DataColumn[] = headings.map((heading, index) => {
    const cells = body.map((row) => (row[index] ?? "").trim());
    const used = cells.filter((cell) => cell !== "");
    const numeric = used.filter(isNumberCell).length;
    return {
      index,
      name: heading,
      // A column is numbers when nearly all of what is in it reads as a number.
      kind: used.length && numeric >= used.length * 0.8 ? "number" : "text",
      filled: used.length,
      numeric,
      distinct: new Set(used.map((cell) => cell.toLowerCase())).size
    };
  });

  const texts = columns.filter((column) => column.kind === "text" && column.filled);
  const numbers = columns.filter((column) => column.kind === "number" && column.filled);
  if (!texts.length || (!numbers.length && texts.length < 2)) return null;
  // The column that names the place: the text column with the most different values, and the
  // shortest cells when two are as varied (a code column beats a column of sentences).
  const key = [...texts].sort((a, b) => b.distinct - a.distinct || a.index - b.index)[0];
  const category = texts.filter((column) => column.index !== key.index && isCategoryColumn(column))[0];
  const value = numbers[0] ?? category;
  if (!value) return null;
  return { name, headings, rows: body, columns, keyColumn: key.index, valueColumn: value.index };
}

/** A column of text that sorts places into a few kinds: few different values, each shared by several places. */
export const isCategoryColumn = (column: DataColumn): boolean => column.kind === "text" && column.filled > 1 && column.distinct >= 1 && column.distinct <= 40 && column.distinct < column.filled;

/** The category of each place, by the key in another column. */
export function columnCategories(table: DataTable, keyColumn: number, column: number): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const row of table.rows) {
    const key = (row[keyColumn] ?? "").trim();
    const value = (row[column] ?? "").trim();
    if (key && value) out.push({ key, value });
  }
  return out;
}

/** The values of one column, by the key in another: what the join works from. */
export function columnValues(table: DataTable, keyColumn: number, valueColumn: number): { key: string; value: number }[] {
  const out: { key: string; value: number }[] = [];
  for (const row of table.rows) {
    const key = (row[keyColumn] ?? "").trim();
    const value = toNumber(row[valueColumn] ?? "");
    if (!key || !Number.isFinite(value)) continue;
    out.push({ key, value });
  }
  return out;
}
