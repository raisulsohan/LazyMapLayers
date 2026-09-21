// Outlines of every country, from Natural Earth: one file per country, read when a country is first
// turned into an After Effects shape layer. The rendered highlight comes from the map tiles instead,
// so these files are only read on demand.

import { extensionRoot, fs, path } from "../cep.ts";

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
