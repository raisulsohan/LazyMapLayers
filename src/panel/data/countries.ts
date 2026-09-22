// Outlines of every country, from Natural Earth: one file per country, read when a country is first
// turned into an After Effects shape layer. The rendered highlight comes from the map tiles instead,
// so these files are only read on demand.

import type { JoinTarget } from "../../core/data/join.ts";
import { extensionRoot, fs, path } from "../cep.ts";
import { placeIndex } from "./worldLabels.ts";

export type CountryOutline = { id: string; name: string; polygons: number[][][][] };

const cache = new Map<string, CountryOutline | null>();

/** The outline of a country (by its adm0_a3 code), or null when this build has no file for it. */
export function countryOutline(code: string): CountryOutline | null {
  const cached = cache.get(code);
  if (cached !== undefined) return cached;
  let outline: CountryOutline | null = null;
  try {
    if (/^[A-Z0-9_-]{2,8}$/i.test(code)) {
      const data = JSON.parse(fs().readFileSync(path().join(extensionRoot(), "data", "countries", `${code}.json`), "utf8")) as CountryOutline;
      if (Array.isArray(data.polygons) && data.polygons.length) outline = data;
    }
  } catch {
    outline = null;
  }
  cache.set(code, outline);
  return outline;
}

export type CountryCodeRow = { code: string; iso2: string | null; iso3: string | null; isoN: string | null; names: string[] };

let codeRows: CountryCodeRow[] | null = null;

/**
 * The code table: every country with the codes and names it answers to (data/country-codes.json,
 * built from Natural Earth). Read once, when a table of numbers is first joined.
 */
export function countryCodeRows(): CountryCodeRow[] {
  if (codeRows) return codeRows;
  try {
    const data = JSON.parse(fs().readFileSync(path().join(extensionRoot(), "data", "country-codes.json"), "utf8")) as { countries?: CountryCodeRow[] };
    codeRows = Array.isArray(data.countries) ? data.countries : [];
  } catch {
    codeRows = [];
  }
  return codeRows;
}

/**
 * Every way a table may name a country: the code the map tiles carry, its ISO codes, the names the
 * source data holds, and its name in each of the languages the panel bundles.
 */
export function countryJoinTargets(): JoinTarget[] {
  const names = new Map<string, string[]>();
  try {
    for (const record of placeIndex().records) {
      if (record.kind !== "country") continue;
      names.set(record.country, [...(names.get(record.country) ?? []), ...Object.values(record.names)]);
    }
  } catch {
    // Without the place index the code table alone still joins English names and codes.
  }
  return countryCodeRows().map((row) => ({ code: row.code, codes: [row.iso2, row.iso3, row.isoN], names: [...row.names, ...(names.get(row.code) ?? [])] }));
}
