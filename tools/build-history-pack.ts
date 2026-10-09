// Builds the historical borders pack (docs/PLAN.md §9): the world's borders at every year the
// historical-basemaps project has, plus the years LazyMapLayers derives (data/history/corrections.json),
// as one zip the panel downloads from this project's GitHub release:
//
//   history/manifest.json     the years, the credit, the licence and the source commit
//   history/<year>.json       one year's shapes (1947.json, bc323.json), see src/core/history/historyPack.ts
//   history/LICENSE.txt       the GNU GPL 3.0, which the source data is under
//
//   node tools/build-history-pack.ts [--commit <sha>] [--out <folder>]
//
// The source is read at a pinned commit and kept in .cache/history/source-<commit>; only missing files
// are downloaded (about 70 MB the first time). The zip and its size and SHA-256, for
// src/core/history/packInfo.ts, are written to .cache/history/.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { buildHistory, readCorrections, yearFile, yearOfSourceFile, HISTORY_CREDIT, HISTORY_LICENSE, type HistoryManifest } from "../src/core/history/historyPack.ts";
import { HISTORY_PACK } from "../src/core/history/packInfo.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const REPO = "aourednik/historical-basemaps";
const commit = arg("commit") ?? HISTORY_PACK.commit;
const cache = path.join(root, ".cache", "history");
const sourceDir = path.join(cache, `source-${commit}`);
const out = path.resolve(arg("out") ?? path.join(cache, "pack"));
const raw = (file: string) => `https://raw.githubusercontent.com/${REPO}/${commit}/${file}`;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

async function download(file: string, into: string): Promise<void> {
  if (fs.existsSync(into)) return;
  const answer = await fetch(raw(file), { headers: { "User-Agent": "LazyMapLayers history pack builder (https://github.com/raisulsohan/LazyMapLayers)" } });
  if (!answer.ok) throw new Error(`${file}: HTTP ${answer.status}`);
  const body = Buffer.from(await answer.arrayBuffer());
  fs.mkdirSync(path.dirname(into), { recursive: true });
  fs.writeFileSync(`${into}.part`, body);
  fs.renameSync(`${into}.part`, into);
  console.log(`downloaded ${file} (${mb(body.length)})`);
}

async function main() {
  const started = Date.now();
  await download("LICENSE", path.join(sourceDir, "LICENSE"));
  await download("index.json", path.join(sourceDir, "index.json"));
  const index = JSON.parse(fs.readFileSync(path.join(sourceDir, "index.json"), "utf8")) as { years: { filename: string }[] };
  const files = index.years.map((entry) => entry.filename).filter((file) => yearOfSourceFile(file) !== null);
  for (let i = 0; i < files.length; i += 8) await Promise.all(files.slice(i, i + 8).map((file) => download(`geojson/${file}`, path.join(sourceDir, file))));

  const snapshots = new Map<number, unknown>();
  for (const file of files) snapshots.set(yearOfSourceFile(file)!, JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf8")));
  const corrections = readCorrections(JSON.parse(fs.readFileSync(path.join(root, "data", "history", "corrections.json"), "utf8")));
  const years = buildHistory(snapshots, corrections);

  const folder = path.join(out, "history");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const zipped: Record<string, Uint8Array> = {};
  const put = (name: string, content: string) => {
    fs.writeFileSync(path.join(folder, name), content);
    zipped[`history/${name}`] = Buffer.from(content, "utf8");
  };
  const manifest: HistoryManifest = {
    v: 1,
    pack: HISTORY_PACK.tag,
    credit: HISTORY_CREDIT,
    license: HISTORY_LICENSE,
    source: { name: "historical-basemaps", url: `https://github.com/${REPO}`, commit },
    years: []
  };
  let points = 0;
  for (const { year, info } of years) {
    const file = yearFile(year.year);
    put(file, JSON.stringify(year));
    manifest.years.push({ ...info, file });
    for (const feature of year.features) for (const polygon of feature.polygons) for (const ring of polygon) points += ring.length;
  }
  put("manifest.json", JSON.stringify(manifest, null, 1));
  put("LICENSE.txt", fs.readFileSync(path.join(sourceDir, "LICENSE"), "utf8"));

  // A fixed date in every entry, so the same source and corrections always give the same SHA-256.
  const zip = zipSync(zipped, { level: 9, mtime: new Date(2026, 0, 1) });
  const zipFile = path.join(cache, `${HISTORY_PACK.tag}.zip`);
  fs.writeFileSync(zipFile, zip);
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  const derived = manifest.years.filter((y) => y.from !== undefined).map((y) => `${y.label} (from ${y.from})`);
  const corrected = manifest.years.filter((y) => y.note && y.from === undefined).map((y) => y.label);
  console.log(`years: ${manifest.years.length}; derived ${derived.join(", ") || "none"}; corrected ${corrected.join(", ") || "none"}`);
  console.log(`shapes: ${manifest.years.reduce((n, y) => n + y.features, 0)}, points: ${points}`);
  console.log(`folder: ${folder}`);
  console.log(`zip: ${zipFile}`);
  console.log(`bytes: ${zip.length} (${mb(zip.length)})`);
  console.log(`sha256: ${sha256}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
