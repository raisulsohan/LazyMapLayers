// Builds the country code table from Natural Earth's 1:10m admin-0 shapefile in .cache/ne
// (ne_10m_admin_0_countries.zip, public domain):
//
//   data/generated/country-codes.json   one row per country: the code the map tiles carry, its two
//                                       and three letter ISO codes, and the names the source holds
//
// This is what a table of numbers is joined to (src/core/data/join.ts): a CSV that names countries
// in English, or by ISO code, or by a longer official name, finds them here. The codes come from the
// source data, never from memory.
//
//   node tools/prepare-country-codes.ts

import fs from "node:fs";
import path from "node:path";
import shp from "shpjs";

type Props = Record<string, unknown>;

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, ".cache", "ne", "ne_10m_admin_0_countries.zip");
const outFile = path.join(root, "data", "generated", "country-codes.json");

const lower = (props: Props) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "-99" && v.trim() !== "-99.0" ? v.trim() : "");

async function main() {
  const started = Date.now();
  const zip = fs.readFileSync(source);
  let loaded = (await shp(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength))) as GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[];
  if (Array.isArray(loaded)) loaded = loaded[0];
  const rows: { code: string; iso2: string | null; iso3: string | null; isoN: string | null; names: string[] }[] = [];
  const seen = new Set<string>();
  for (const feature of loaded.features) {
    const p = lower(feature.properties ?? {});
    const code = text(p.adm0_a3) || text(p.iso_a3) || text(p.sov_a3);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    // Every spelling the source holds, so a table written any of those ways still finds the country.
    const names = [p.name_en, p.name, p.name_long, p.admin, p.formal_en, p.name_ciawf, p.name_sort, p.brk_name, p.geounit, p.subunit]
      .map(text)
      .filter(Boolean);
    // Natural Earth leaves ISO_A2 and ISO_A3 at -99 for a few countries (France among them) and
    // fills the "_EH" fields instead; the World Bank fields are the last resort.
    const iso2 = text(p.iso_a2) || text(p.iso_a2_eh) || text(p.wb_a2);
    const iso3 = text(p.iso_a3) || text(p.iso_a3_eh) || text(p.wb_a3) || text(p.adm0_iso);
    const isoN = String(p.iso_n3 ?? "").trim() !== "-99" && String(p.iso_n3 ?? "").trim() ? String(p.iso_n3).trim() : String(p.iso_n3_eh ?? p.un_a3 ?? "").trim();
    rows.push({ code, iso2: iso2 || null, iso3: iso3 || null, isoN: /^[0-9]{1,3}$/.test(isoN) ? isoN.padStart(3, "0") : null, names: [...new Set(names)] });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  const json = JSON.stringify({ v: 1, source: "Natural Earth (public domain)", countries: rows });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, json);
  const withIso2 = rows.filter((row) => row.iso2).length;
  const withIsoN = rows.filter((row) => row.isoN).length;
  console.log(`country codes: ${rows.length} (${withIso2} with a two-letter code, ${withIsoN} with a number), ${(json.length / 1024).toFixed(1)} KB`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

void main();
