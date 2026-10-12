// Fetches the Natural Earth shapefiles (public domain, https://www.naturalearthdata.com) that the
// prepare-* scripts read into .cache/ne: 26 zips, about 69 MB, from Natural Earth's own download
// server. A zip already there is kept, so running it again fetches only what is missing. CI runs it
// (DECISIONS D104); on a development PC it replaces fetching the zips by hand.
//
//   node tools/fetch-natural-earth.mjs            fetch what is missing
//   node tools/fetch-natural-earth.mjs --list     print the list (the CI cache keys on it)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".cache", "ne");
const SERVER = "https://naciscdn.org/naturalearth";

/** [scale, category, name] for every zip the prepare scripts read. */
export const NATURAL_EARTH = [
  ["10m", "cultural", "admin_0_boundary_lines_land"],
  ["10m", "cultural", "admin_0_countries"],
  ["10m", "cultural", "admin_1_states_provinces"],
  ["10m", "cultural", "admin_1_states_provinces_lines"],
  ["10m", "cultural", "populated_places"],
  ["10m", "cultural", "roads"],
  ["10m", "cultural", "urban_areas"],
  ["10m", "physical", "coastline"],
  ["10m", "physical", "geography_marine_polys"],
  ["10m", "physical", "geography_regions_elevation_points"],
  ["10m", "physical", "geography_regions_points"],
  ["10m", "physical", "geography_regions_polys"],
  ["10m", "physical", "lakes"],
  ["10m", "physical", "land"],
  ["10m", "physical", "ocean"],
  ["10m", "physical", "rivers_lake_centerlines"],
  ["50m", "cultural", "admin_0_boundary_lines_land"],
  ["50m", "cultural", "admin_0_countries"],
  ["50m", "physical", "lakes"],
  ["50m", "physical", "land"],
  ["50m", "physical", "ocean"],
  ["50m", "physical", "rivers_lake_centerlines"],
  ["110m", "cultural", "admin_0_countries"],
  ["110m", "physical", "lakes"],
  ["110m", "physical", "land"],
  ["110m", "physical", "ocean"]
];

const fileOf = ([scale, , name]) => `ne_${scale}_${name}.zip`;
const urlOf = (entry) => `${SERVER}/${entry[0]}/${entry[1]}/${fileOf(entry)}`;

async function fetchOne(entry) {
  const target = path.join(out, fileOf(entry));
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(urlOf(entry), { headers: { "user-agent": "LazyMapLayers build (https://github.com/raisulsohan/LazyMapLayers)" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      // A zip starts with "PK"; an error page from a cache in between does not.
      if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`not a zip (${bytes.length} bytes)`);
      fs.writeFileSync(`${target}.part`, bytes);
      fs.renameSync(`${target}.part`, target);
      return bytes.length;
    } catch (error) {
      if (attempt >= 3) throw new Error(`${fileOf(entry)}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
}

async function main() {
  if (process.argv.includes("--list")) {
    for (const entry of NATURAL_EARTH) console.log(urlOf(entry));
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  const missing = NATURAL_EARTH.filter((entry) => !fs.existsSync(path.join(out, fileOf(entry))));
  if (!missing.length) {
    console.log(`all ${NATURAL_EARTH.length} Natural Earth zips are in ${out}`);
    return;
  }
  let total = 0;
  // Four at a time: polite to the server, quick enough.
  for (let i = 0; i < missing.length; i += 4) {
    const sizes = await Promise.all(missing.slice(i, i + 4).map(fetchOne));
    total += sizes.reduce((a, b) => a + b, 0);
  }
  console.log(`fetched ${missing.length} Natural Earth zips (${(total / 1048576).toFixed(1)} MB) into ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[!] ${error.message}`);
    process.exit(1);
  });
}
