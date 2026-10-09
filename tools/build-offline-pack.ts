// Builds the offline data pack: what the panel would otherwise download, so a release works without
// the internet from its first start (DECISIONS D91). The pack is laid out like the panel's user data
// folder, so the installer only copies it there:
//
//   offline/world.pmtiles        OpenStreetMap for the whole world to zoom 9 (a Protomaps planet build)
//   terrain/world.pmtiles        elevation for the whole world to zoom 6 (the Mapterhorn planet)
//   imagery/blue-marble.pmtiles  the satellite and shaded relief packs (this project's imagery-1 release)
//   imagery/relief.pmtiles
//   boundaries/manifest.json     every country's districts (geoBoundaries gbOpen ADM2), thinned and
//   boundaries/<ISO>-ADM2.json   written exactly as the panel's own district download writes them
//   offline/pack.json            what is in the pack and where each part came from
//   offline/CREDITS.txt          the credits the data's licences ask for
//
//   node tools/build-offline-pack.ts [--only world,terrain,imagery,districts] [--out <folder>]
//     [--world-zoom 9] [--terrain-zoom 6] [--bbox west,south,east,north] [--countries BGD,NPL]
//
// --bbox and --countries make a small pack for trying the tool. The large archives stream straight to
// disk, and a run that stopped continues where it was when the tool is started again. Ask Sohan before
// running it for the whole world: that downloads about 2.2 GB.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mergeRanges, planExtract, type ExtractPlan, type RangeReader } from "../src/core/pmtiles/extract.ts";
import { archiveHead, entriesForTiles } from "../src/core/pmtiles/writer.ts";
import { IMAGERY_INFO, type ImageryPack } from "../src/core/imagery/packInfo.ts";
import { buildBoundarySet, isoOfCountry, type BoundarySetInfo } from "../src/core/data/boundarySet.ts";
import { pointInPolygons, type Polygons } from "../src/core/geo/pointInPolygon.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = path.resolve(arg("out") ?? path.join(root, ".cache", "offline", "pack"));
const work = path.join(path.dirname(out), "work");
const only = new Set((arg("only") ?? "world,terrain,imagery,districts").split(","));
const worldZoom = Number(arg("world-zoom") ?? 9);
const terrainZoom = Number(arg("terrain-zoom") ?? 6);
const [west, south, east, north] = (arg("bbox") ?? "-180,-85.051129,180,85.051129").split(",").map(Number);
const bbox = { west, south, east, north };
const countryFilter = arg("countries")?.split(",").map((c) => c.trim().toUpperCase());

const PROTOMAPS_BUILDS = "https://build-metadata.protomaps.dev/builds.json";
const MAPTERHORN = "https://download.mapterhorn.com/planet.pmtiles";
const GEOBOUNDARIES = "https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM2/";
const USER_AGENT = "LazyMapLayers offline pack builder (https://github.com/raisulsohan/LazyMapLayers)";
const CHUNK = 32 * 1024 * 1024;

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const log = (line: string) => console.log(line);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries a network step a few times, waiting longer each time. */
async function retry<T>(what: string, step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      if (attempt >= 5) throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(2000 * attempt);
    }
  }
}

function rangeReader(url: string): RangeReader {
  return (offset, length) =>
    retry(`reading ${url}`, async () => {
      const response = await fetch(url, { headers: { range: `bytes=${offset}-${offset + length - 1}`, "user-agent": USER_AGENT } });
      if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return response.status === 200 ? bytes.slice(offset, offset + length) : bytes;
    });
}

/** Writes `length` bytes from `start` of a remote file into an open file at `position`, as they arrive. */
async function streamRange(url: string, start: number, length: number, fd: number, position: number): Promise<void> {
  await retry(`downloading ${url}`, async () => {
    const response = await fetch(url, { headers: { range: `bytes=${start}-${start + length - 1}`, "user-agent": USER_AGENT } });
    if (response.status !== 206 || !response.body) throw new Error(`HTTP ${response.status}`);
    let written = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      fs.writeSync(fd, chunk, 0, chunk.length, position + written);
      written += chunk.length;
    }
    if (written !== length) throw new Error(`short read: wanted ${length} bytes, got ${written}`);
  });
}

/** Downloads a whole file to disk, then checks its size and SHA-256. */
async function downloadFile(url: string, file: string, bytes: number, sha256: string): Promise<void> {
  const part = `${file}.part`;
  await retry(`downloading ${url}`, async () => {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (response.status !== 200 || !response.body) throw new Error(`HTTP ${response.status}`);
    const fd = fs.openSync(part, "w");
    const hash = crypto.createHash("sha256");
    let written = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        fs.writeSync(fd, chunk);
        hash.update(chunk);
        written += chunk.length;
      }
    } finally {
      fs.closeSync(fd);
    }
    if (written !== bytes) throw new Error(`got ${written} bytes, expected ${bytes}`);
    if (hash.digest("hex") !== sha256) throw new Error("the checksum is wrong");
  });
  fs.renameSync(part, file);
}

/**
 * Extracts every tile of `bbox` up to `maxZoom` from a remote PMTiles archive into `file`. The tile data
 * goes to disk range by range as it arrives (a .data.part file that a later run continues), then the
 * archive is written as a new head followed by that data, so nothing large is ever held in memory.
 */
async function extractToFile(label: string, url: string, maxZoom: number, file: string, note: Record<string, unknown>): Promise<{ bytes: number; tiles: number; plan: ExtractPlan }> {
  const read = rangeReader(url);
  const started = Date.now();
  const plan = await planExtract(read, bbox, 0, maxZoom);
  const ranges = mergeRanges(plan.tiles, 1024 * 1024);
  const bases: number[] = [];
  let total = 0;
  for (const range of ranges) {
    bases.push(total);
    total += range.length;
  }
  log(`${label}: ${plan.tiles.length} tiles to zoom ${plan.maxZoom}, ${mb(plan.tileBytes)} of tile data in ${ranges.length} ranges (${mb(total)} to download)`);
  if (fs.existsSync(file)) {
    log(`${label}: ${file} is already built`);
    return { bytes: fs.statSync(file).size, tiles: plan.tiles.length, plan };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const dataFile = path.join(work, `${path.basename(file)}.data.part`);
  const progressFile = path.join(work, `${path.basename(file)}.progress.json`);
  // The ranges in pieces of at most CHUNK bytes, fetched four at a time; finished pieces are noted, so
  // a later run fetches only the rest.
  const pieces: { position: number; start: number; length: number }[] = [];
  ranges.forEach((range, i) => {
    for (let at = 0; at < range.length; at += CHUNK) pieces.push({ position: bases[i] + at, start: plan.header.tileDataOffset + range.offset + at, length: Math.min(CHUNK, range.length - at) });
  });
  const signature = `${url}|${plan.tiles.length}|${plan.tileBytes}|${ranges.length}|${total}`;
  const finished = new Set<number>();
  try {
    const progress = JSON.parse(fs.readFileSync(progressFile, "utf8")) as { signature: string; pieces: number[] };
    if (progress.signature === signature && fs.existsSync(dataFile)) for (const position of progress.pieces) finished.add(position);
  } catch {
    // A fresh start.
  }
  let done = pieces.filter((p) => finished.has(p.position)).reduce((sum, p) => sum + p.length, 0);
  const resumedAt = done;
  if (done > 0) log(`${label}: continuing, ${mb(done)} already here`);
  const fd = fs.openSync(dataFile, finished.size ? "r+" : "w");
  let lastPrint = 0;
  try {
    const queue = pieces.filter((p) => !finished.has(p.position));
    const worker = async () => {
      for (let piece = queue.shift(); piece; piece = queue.shift()) {
        await streamRange(url, piece.start, piece.length, fd, piece.position);
        finished.add(piece.position);
        done += piece.length;
        fs.writeFileSync(progressFile, JSON.stringify({ signature, pieces: [...finished] }));
        if (Date.now() - lastPrint > 5000 || done === total) {
          const seconds = (Date.now() - started) / 1000;
          log(`${label}: ${mb(done)} / ${mb(total)} (${((done - resumedAt) / 1048576 / Math.max(1, seconds)).toFixed(1)} MB/s)`);
          lastPrint = Date.now();
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally {
    fs.closeSync(fd);
  }
  if (finished.size !== pieces.length) throw new Error(`${label}: ${pieces.length - finished.size} pieces are missing`);

  // Every tile's place in the downloaded data: its range's place plus where it sat inside the range.
  const rangeOf = (offset: number) => {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ranges[mid].offset <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const tiles = plan.tiles.map((t) => {
    const i = rangeOf(t.offset);
    return { tileId: t.tileId, offset: bases[i] + (t.offset - ranges[i].offset), length: t.length };
  });
  const entries = entriesForTiles(tiles);
  const { head } = archiveHead(entries, {
    tileType: plan.header.tileType,
    tileCompression: plan.header.tileCompression,
    metadata: {
      ...plan.metadata,
      lazymaplayers_extract: { ...note, bbox: [bbox.west, bbox.south, bbox.east, bbox.north], minzoom: plan.minZoom, maxzoom: plan.maxZoom, extracted_at: new Date().toISOString() }
    },
    bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
    center: { lng: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2, zoom: plan.minZoom },
    dataLength: total,
    contents: new Set(tiles.map((t) => t.offset)).size,
    minZoom: plan.minZoom,
    maxZoom: plan.maxZoom
  });
  const part = `${file}.part`;
  const outFd = fs.openSync(part, "w");
  try {
    fs.writeSync(outFd, head);
    const inFd = fs.openSync(dataFile, "r");
    const buffer = Buffer.alloc(CHUNK);
    try {
      for (let at = 0; at < total; ) {
        const n = fs.readSync(inFd, buffer, 0, Math.min(CHUNK, total - at), at);
        if (n <= 0) throw new Error(`the downloaded data ends at ${at} of ${total} bytes`);
        fs.writeSync(outFd, buffer, 0, n);
        at += n;
      }
    } finally {
      fs.closeSync(inFd);
    }
  } finally {
    fs.closeSync(outFd);
  }
  fs.renameSync(part, file);
  fs.rmSync(dataFile, { force: true });
  fs.rmSync(progressFile, { force: true });
  const bytes = fs.statSync(file).size;
  log(`${label}: wrote ${file} (${mb(bytes)}) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return { bytes, tiles: plan.tiles.length, plan };
}

async function newestProtomapsBuild(): Promise<{ key: string; version: string }> {
  const response = await retry("the Protomaps build list", () => fetch(PROTOMAPS_BUILDS, { headers: { "user-agent": USER_AGENT } }));
  const builds = (await response.json()) as { key: string; version: string }[];
  return builds[builds.length - 1];
}

type Credit = { what: string; text: string };

async function buildWorld(pack: Record<string, unknown>, credits: Credit[]): Promise<void> {
  const build = await newestProtomapsBuild();
  const url = `https://build.protomaps.com/${build.key}`;
  const result = await extractToFile("world", url, worldZoom, path.join(out, "offline", "world.pmtiles"), { source: url, schema: build.version });
  pack.world = { source: url, schema: build.version, maxZoom: result.plan.maxZoom, tiles: result.tiles, bytes: result.bytes };
  credits.push({
    what: "The world map to zoom 9 (offline/world.pmtiles)",
    text: `© OpenStreetMap contributors, available under the Open Database License (ODbL 1.0): https://www.openstreetmap.org/copyright\nTiles from the Protomaps basemap planet build ${build.key} (schema ${build.version}): https://protomaps.com`
  });
}

async function buildTerrain(pack: Record<string, unknown>, credits: Credit[]): Promise<void> {
  const result = await extractToFile("terrain", MAPTERHORN, terrainZoom, path.join(out, "terrain", "world.pmtiles"), { source: MAPTERHORN });
  const attribution = typeof result.plan.metadata.attribution === "string" ? result.plan.metadata.attribution.replace(/<[^>]+>/g, "") : "";
  pack.terrain = { source: MAPTERHORN, maxZoom: result.plan.maxZoom, tiles: result.tiles, bytes: result.bytes };
  credits.push({ what: "Elevation for the whole world to zoom 6 (terrain/world.pmtiles)", text: `© Mapterhorn: https://mapterhorn.com${attribution ? `\n${attribution}` : ""}` });
}

async function buildImagery(pack: Record<string, unknown>, credits: Credit[]): Promise<void> {
  const packs: Record<string, unknown> = {};
  for (const name of Object.keys(IMAGERY_INFO) as ImageryPack[]) {
    const info = IMAGERY_INFO[name];
    const file = path.join(out, "imagery", `${name}.pmtiles`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size === info.bytes) log(`imagery: ${name} is already there`);
    else {
      log(`imagery: downloading ${name} (${mb(info.bytes)})`);
      await downloadFile(info.url, file, info.bytes, info.sha256);
    }
    packs[name] = { source: info.url, bytes: info.bytes, sha256: info.sha256 };
    credits.push({ what: `${info.label} (imagery/${name}.pmtiles)`, text: info.attribution });
  }
  pack.imagery = packs;
}

type GeoBoundariesEntry = Record<string, unknown> & { boundaryISO: string };

async function buildDistricts(pack: Record<string, unknown>, credits: Credit[]): Promise<void> {
  const codesFile = [path.join(root, "data", "generated", "country-codes.json"), path.join(root, "dist", "data", "country-codes.json")].find((f) => fs.existsSync(f));
  if (!codesFile) throw new Error("no country-codes.json; run npm run data:country-codes first");
  const countries = (JSON.parse(fs.readFileSync(codesFile, "utf8")) as { countries: { code: string; iso3?: string; names: string[] }[] }).countries;
  // geoBoundaries names a country by ISO 3166-1 alpha-3; the panel by Natural Earth's adm0_a3.
  const byIso = new Map<string, { code: string; name: string }>();
  for (const c of countries) byIso.set(isoOfCountry(c.code, c.iso3), { code: c.code, name: c.names[0] ?? c.code });

  const response = await retry("the geoBoundaries list", () => fetch(GEOBOUNDARIES, { headers: { "user-agent": USER_AGENT } }));
  let list = (await response.json()) as GeoBoundariesEntry[];
  if (countryFilter) list = list.filter((entry) => countryFilter.includes(entry.boundaryISO));
  const folder = path.join(out, "boundaries");
  const infoFolder = path.join(work, "districts");
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(infoFolder, { recursive: true });
  const text = (value: unknown) => (typeof value === "string" && value !== "nan" ? value : "");
  const admin1Folder = [path.join(root, "data", "generated", "admin1"), path.join(root, "dist", "data", "admin1")].find((f) => fs.existsSync(f));
  const provincesOf = (code: string): { name: string; polygons: Polygons }[] => {
    try {
      return (JSON.parse(fs.readFileSync(path.join(admin1Folder ?? "", `${code}.json`), "utf8")) as { features: { name: string; polygons: Polygons }[] }).features;
    } catch {
      return [];
    }
  };

  const sets: BoundarySetInfo[] = [];
  const skipped: string[] = [];
  let next = 0;
  let finished = 0;
  const worker = async () => {
    for (;;) {
      const entry = list[next++];
      if (!entry) return;
      const iso = entry.boundaryISO;
      const country = byIso.get(iso);
      if (!country) {
        skipped.push(`${iso} (no country of that code in the world data)`);
        continue;
      }
      const setFile = path.join(folder, `${iso}-ADM2.json`);
      const infoFile = path.join(infoFolder, `${iso}.json`);
      if (fs.existsSync(setFile) && fs.existsSync(infoFile)) {
        sets.push(JSON.parse(fs.readFileSync(infoFile, "utf8")) as BoundarySetInfo);
        finished++;
        continue;
      }
      const url = text(entry.simplifiedGeometryGeoJSON) || text(entry.gjDownloadURL);
      try {
        const answer = await retry(`districts of ${iso}`, async () => {
          const r = await fetch(url, { headers: { "user-agent": USER_AGENT } });
          if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
          return r.json();
        });
        const license = text(entry.boundaryLicense);
        const source = text(entry.boundarySource);
        const built = buildBoundarySet(answer, {
          iso,
          country: country.code,
          countryName: country.name,
          level: "ADM2",
          unit: text(entry.boundaryCanonical).toLowerCase() || "district",
          source,
          license,
          licenseSource: text(entry.licenseSource),
          downloaded: new Date().toISOString().slice(0, 10)
        });
        // As the panel does: the province a unit lies in tells equal names apart in search.
        const provinces = provincesOf(country.code);
        for (const unit of built.info.units) {
          const province = provinces.find((p) => pointInPolygons({ lat: unit.lat, lng: unit.lng }, p.polygons));
          if (province && province.name !== unit.n) unit.p = province.name;
        }
        fs.writeFileSync(setFile, JSON.stringify({ v: 1, iso, level: "ADM2", source: `geoBoundaries gbOpen: ${source}`, license, features: built.features }));
        fs.writeFileSync(infoFile, JSON.stringify(built.info));
        sets.push(built.info);
      } catch (error) {
        skipped.push(`${iso} (${error instanceof Error ? error.message : String(error)})`);
      }
      finished++;
      if (finished % 10 === 0 || finished === list.length) log(`districts: ${finished} of ${list.length} countries`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  sets.sort((a, b) => a.countryName.localeCompare(b.countryName));
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ v: 1, sets }));
  const units = sets.reduce((sum, set) => sum + set.units.length, 0);
  let bytes = 0;
  for (const name of fs.readdirSync(folder)) bytes += fs.statSync(path.join(folder, name)).size;
  log(`districts: ${sets.length} countries, ${units} units, ${mb(bytes)}${skipped.length ? `; left out: ${skipped.join(", ")}` : ""}`);
  pack.districts = { source: GEOBOUNDARIES, countries: sets.length, units, bytes, skipped };
  const licences = new Map<string, string[]>();
  for (const set of sets) licences.set(set.license || "see the source", [...(licences.get(set.license || "see the source") ?? []), set.iso]);
  credits.push({
    what: "Districts of every country (boundaries/)",
    text:
      "geoBoundaries (gbOpen), William & Mary geoLab: https://www.geoboundaries.org\n" +
      "Each country's set keeps its own licence and source in boundaries/manifest.json. Licences:\n" +
      [...licences.entries()].map(([licence, isos]) => `  ${licence}: ${isos.join(" ")}`).join("\n")
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(path.join(out, "offline"), { recursive: true });
  const packFile = path.join(out, "offline", "pack.json");
  let pack: Record<string, unknown> = {};
  try {
    pack = JSON.parse(fs.readFileSync(packFile, "utf8")) as Record<string, unknown>;
  } catch {
    pack = {};
  }
  const credits: Credit[] = [];
  if (only.has("world")) await buildWorld(pack, credits);
  if (only.has("terrain")) await buildTerrain(pack, credits);
  if (only.has("imagery")) await buildImagery(pack, credits);
  if (only.has("districts")) await buildDistricts(pack, credits);
  pack.v = 1;
  pack.built = new Date().toISOString();
  pack.bbox = [bbox.west, bbox.south, bbox.east, bbox.north];
  const previous = (pack.credits as Credit[] | undefined) ?? [];
  pack.credits = [...previous.filter((c) => !credits.some((n) => n.what === c.what)), ...credits];
  fs.writeFileSync(packFile, JSON.stringify(pack, null, 2));
  const lines = ["LazyMapLayers offline data: where it comes from", "", "Natural Earth (the bundled world map, names and outlines): public domain, https://www.naturalearthdata.com", ""];
  for (const credit of pack.credits as Credit[]) lines.push(credit.what, credit.text, "");
  fs.writeFileSync(path.join(out, "offline", "CREDITS.txt"), lines.join("\n"));
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else total += fs.statSync(file).size;
    }
  };
  walk(out);
  log(`pack: ${out} holds ${mb(total)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
