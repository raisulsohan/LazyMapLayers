// The feature browser's list: every shape the panel can put on a map - countries, provinces,
// districts, imported areas and the map's own areas - with the properties each one carries, so a
// designer can look through them, filter them by a property and act on what is left.

export type FeatureSource = "country" | "province" | "district" | "area" | "import";

export type FeatureRow = {
  /** Unique in the list: the source and the feature's own id. */
  id: string;
  name: string;
  source: FeatureSource;
  /** The country a province or a district belongs to. */
  country?: string;
  /** Everything the feature carries: what a filter can test and the list can show. */
  props: Record<string, string | number>;
};

export type FilterOp = "has" | "=" | "!=" | ">" | ">=" | "<" | "<=";

export type FeatureFilter = { key: string; op: FilterOp; value: string | number };

export type FeatureQuery = {
  /** Words the name or any text property must hold. */
  text?: string;
  filter?: FeatureFilter | null;
  sort?: { key: string; descending?: boolean } | null;
  /** How many rows come back; the rest are counted as hidden. */
  limit?: number;
};

/** More rows than this in one list and the panel is a spreadsheet, not a browser. */
export const MAX_FEATURE_ROWS = 400;

const OPS: FilterOp[] = [">=", "<=", "!=", "=", ">", "<", "has"];

/** Every property name in a list, most common first, for the filter's menu. */
export function featureKeys(rows: FeatureRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of Object.keys(row.props)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
}

/**
 * A filter written as one line: `population > 1000000`, `kind = city`, `name has delta`. A bare word
 * is not a filter (that is what the text box is for), and an unknown operator gives nothing.
 */
export function parseFilter(text: string): FeatureFilter | null {
  const line = (text ?? "").trim();
  if (!line) return null;
  for (const op of OPS) {
    const at = op === "has" ? line.toLowerCase().indexOf(" has ") : line.indexOf(op);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + (op === "has" ? 5 : op.length)).trim();
    if (!key || !raw) return null;
    const asNumber = Number(raw.replace(/,/g, ""));
    const numeric = raw !== "" && Number.isFinite(asNumber);
    if (!numeric && (op === ">" || op === ">=" || op === "<" || op === "<=")) return null;
    return { key, op, value: numeric ? asNumber : raw };
  }
  return null;
}

function asNumber(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  return Number(value.replace(/,/g, "").trim());
}

/** Whether one feature passes a filter. A feature without the property never passes. */
export function matchesFilter(row: FeatureRow, filter: FeatureFilter): boolean {
  const own = filter.key === "name" ? row.name : row.props[filter.key];
  if (own === undefined) return false;
  if (filter.op === "has") return String(own).toLowerCase().includes(String(filter.value).toLowerCase());
  if (filter.op === "=" || filter.op === "!=") {
    const same = typeof filter.value === "number" ? asNumber(own) === filter.value : String(own).toLowerCase() === String(filter.value).toLowerCase();
    return filter.op === "=" ? same : !same;
  }
  const mine = asNumber(own);
  const theirs = asNumber(filter.value);
  if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return false;
  if (filter.op === ">") return mine > theirs;
  if (filter.op === ">=") return mine >= theirs;
  if (filter.op === "<") return mine < theirs;
  return mine <= theirs;
}

function hasText(row: FeatureRow, words: string[]): boolean {
  if (!words.length) return true;
  const hay = [row.name, ...Object.values(row.props).map((value) => String(value))].join(" ").toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** The rows a query leaves, sorted and cut to the limit. */
export function filterFeatures(rows: FeatureRow[], query: FeatureQuery = {}): { rows: FeatureRow[]; total: number; hidden: number } {
  const words = (query.text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  let kept = rows.filter((row) => hasText(row, words));
  if (query.filter) kept = kept.filter((row) => matchesFilter(row, query.filter as FeatureFilter));
  const sort = query.sort;
  if (sort) {
    const value = (row: FeatureRow) => (sort.key === "name" ? row.name : row.props[sort.key]);
    kept = [...kept].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const missing = (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);
      if (missing) return missing;
      const ln = asNumber(left);
      const rn = asNumber(right);
      const order = Number.isFinite(ln) && Number.isFinite(rn) ? ln - rn : String(left ?? "").localeCompare(String(right ?? ""));
      return sort.descending ? -order : order;
    });
  }
  const limit = Math.max(1, Math.min(MAX_FEATURE_ROWS, query.limit ?? MAX_FEATURE_ROWS));
  return { rows: kept.slice(0, limit), total: kept.length, hidden: Math.max(0, kept.length - limit) };
}
