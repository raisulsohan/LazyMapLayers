// Builds the bundled province data from Natural Earth's 1:10m admin-1 shapefile in .cache/ne
// (ne_10m_admin_1_states_provinces.zip, public domain):
//
//   data/generated/admin1-index.json     every province: id, country, names, label point, bounds
//   data/generated/admin1/<ADM0>.json    a country's provinces as thinned polygons
//
// Provinces of one country are simplified together as a topology, so neighbours keep sharing exactly
// the same border and two highlighted provinces never show a gap between them.
//
//   node tools/prepare-admin1.ts

import fs from "node:fs";
import path from "node:path";
import shp from "shpjs";
import { countPoints, simplifyTogether } from "../src/core/geo/sharedBorders.ts";

type Props = Record<string, unknown>;
type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon | null, Props>;

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, ".cache", "ne", "ne_10m_admin_1_states_provinces.zip");
const outDir = path.join(root, "data", "generated");
const LANGUAGES = ["ar", "bn", "de", "el", "en", "es", "fa", "fr", "he", "hi", "hu", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv", "tr", "uk", "ur", "vi", "zh", "zht"];
/** Points a province keeps on average; large countries with many provinces still stay small. */
const POINTS_PER_PROVINCE = 110;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const lower = (props: Props) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "-99" ? v.trim() : "");

async function main() {
  const started = Date.now();
  const zip = fs.readFileSync(source);
  let loaded = (await shp(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength))) as GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[];
  if (Array.isArray(loaded)) loaded = loaded[0];
  const byCountry = new Map<string, Feature[]>();
  for (const f of loaded.features as Feature[]) {
    const p = lower(f.properties ?? {});
    const country = text(p.adm0_a3) || text(p.sov_a3);
    if (!country || !f.geometry || !text(p.name)) continue;
    f.properties = p;
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country)!.push(f);
  }

  fs.rmSync(path.join(outDir, "admin1"), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "admin1"), { recursive: true });
  const index: unknown[] = [];
  let before = 0;
  let after = 0;
  let bytes = 0;

  for (const [country, features] of [...byCountry.entries()].sort()) {
    const total = features.reduce((n, f) => n + countPoints(f.geometry), 0);
    before += total;
    // One topology per country: shared borders are one arc, simplified once.
    const light = simplifyTogether(features, POINTS_PER_PROVINCE);

    const out: { id: string; name: string; polygons: number[][][][] }[] = [];
    features.forEach((original, i) => {
      const p = original.properties as Props;
      const polygons = light[i];
      if (!polygons.length) return;
      const id = (text(p.adm1_code) || `${country}-${i}`).toLowerCase().replace(/[^a-z0-9]/g, "");
      const name = text(p.name_en) || text(p.name);
      const names: Record<string, string> = {};
      for (const lang of LANGUAGES) {
        const value = text(p[`name_${lang}`]);
        if (value && value !== name) names[lang] = value;
      }
      const local = text(p.name_local) || text(p.name);
      if (local && local !== name && !Object.values(names).includes(local)) names.local = local;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      // Bounds of the largest polygon, so far islands do not blow the frame up.
      const largest = polygons.reduce((a, b) => (b[0].length > a[0].length ? b : a));
      for (const [lng, lat] of largest[0]) {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
      after += polygons.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0);
      out.push({ id, name, polygons });
      index.push({
        id,
        c: country,
        n: name,
        ...(Object.keys(names).length ? { a: names } : {}),
        ...(text(p.type_en) ? { t: text(p.type_en) } : {}),
        lat: round(Number(p.latitude) || (south + north) / 2, 3),
        lng: round(Number(p.longitude) || (west + east) / 2, 3),
        b: [round(west, 2), round(south, 2), round(east, 2), round(north, 2)]
      });
    });
    const file = path.join(outDir, "admin1", `${country}.json`);
    const json = JSON.stringify({ v: 1, country, source: "Natural Earth (public domain)", features: out });
    fs.writeFileSync(file, json);
    bytes += json.length;
  }

  const indexFile = path.join(outDir, "admin1-index.json");
  fs.writeFileSync(indexFile, JSON.stringify({ v: 1, source: "Natural Earth (public domain)", provinces: index }));
  const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`provinces: ${index.length} in ${byCountry.size} countries`);
  console.log(`points: ${before} -> ${after}`);
  console.log(`admin1/*.json ${mb(bytes)}, admin1-index.json ${mb(fs.statSync(indexFile).size)}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
