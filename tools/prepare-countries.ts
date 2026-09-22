// Builds the bundled country outlines from Natural Earth's 1:10m admin-0 shapefile in .cache/ne
// (ne_10m_admin_0_countries.zip, public domain):
//
//   data/generated/countries/<ADM0>.json    one country as thinned polygons
//
// These are the outlines a country becomes when it is added to After Effects as a shape layer (the
// rendered highlight comes from the map tiles instead). Every country is simplified inside one
// topology, so two neighbours keep exactly the same border and their shape layers never show a gap.
//
//   node tools/prepare-countries.ts

import fs from "node:fs";
import path from "node:path";
import shp from "shpjs";
import { countPoints, simplifyTogether } from "../src/core/geo/sharedBorders.ts";

type Props = Record<string, unknown>;
type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon | null, Props>;

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, ".cache", "ne", "ne_10m_admin_0_countries.zip");
const outDir = path.join(root, "data", "generated", "countries");
/** Points a country keeps on average; a shape layer thins its own copy further (SHAPE_MAX_POINTS). */
const POINTS_PER_COUNTRY = 1600;

const lower = (props: Props) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "-99" ? v.trim() : "");

async function main() {
  const started = Date.now();
  const zip = fs.readFileSync(source);
  let loaded = (await shp(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength))) as GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[];
  if (Array.isArray(loaded)) loaded = loaded[0];
  const features: Feature[] = [];
  const codes: string[] = [];
  for (const f of loaded.features as Feature[]) {
    const p = lower(f.properties ?? {});
    const code = text(p.adm0_a3) || text(p.iso_a3) || text(p.sov_a3);
    if (!code || !f.geometry || codes.includes(code)) continue;
    f.properties = p;
    features.push(f);
    codes.push(code);
  }

  const before = features.reduce((n, f) => n + countPoints(f.geometry), 0);
  // One topology for the whole world: shared borders are one arc, simplified once.
  const light = simplifyTogether(features, POINTS_PER_COUNTRY);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let after = 0;
  let bytes = 0;
  let written = 0;
  features.forEach((feature, i) => {
    const polygons = light[i];
    if (!polygons.length) return;
    const p = feature.properties as Props;
    const name = text(p.name_en) || text(p.name) || codes[i];
    after += polygons.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0);
    const json = JSON.stringify({ v: 1, id: codes[i], name, source: "Natural Earth (public domain)", polygons });
    fs.writeFileSync(path.join(outDir, `${codes[i]}.json`), json);
    bytes += json.length;
    written++;
  });

  const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`countries: ${written} of ${features.length}`);
  console.log(`points: ${before} -> ${after}`);
  console.log(`countries/*.json ${mb(bytes)}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
