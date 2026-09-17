// Downloads one region of a remote PMTiles archive (for example a Protomaps OpenStreetMap planet
// build) into a local archive, using HTTP range requests only.
//
//   node tools/extract-region.ts --name paris --bbox 2.2,48.8,2.48,48.92 --max-zoom 15 [--dry-run]
//     [--url https://build.protomaps.com/20260917.pmtiles] [--out <file>]
//
// Without --url the newest build listed at build-metadata.protomaps.dev is used.
// Default output: %APPDATA%/LazyMapLayers/regions/<name>.pmtiles
// Data: © OpenStreetMap contributors (ODbL). Attribution is required wherever the map is shown.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planExtract, runExtract, type RangeReader } from "../src/core/pmtiles/extract.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

async function newestBuildUrl(): Promise<string> {
  const response = await fetch("https://build-metadata.protomaps.dev/builds.json");
  if (!response.ok) throw new Error(`build list: HTTP ${response.status}`);
  const builds = (await response.json()) as { key: string; version: string }[];
  const newest = builds[builds.length - 1];
  console.log(`newest Protomaps build: ${newest.key} (basemap schema ${newest.version})`);
  return `https://build.protomaps.com/${newest.key}`;
}

function httpReader(url: string, counters: { requests: number; bytes: number }): RangeReader {
  return async (offset, length) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, { headers: { range: `bytes=${offset}-${offset + length - 1}` } });
        if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        counters.requests++;
        counters.bytes += bytes.length;
        return response.status === 200 ? bytes.slice(offset, offset + length) : bytes;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  };
}

async function main() {
  const name = arg("name") ?? "region";
  const bboxText = arg("bbox");
  if (!bboxText) throw new Error("--bbox west,south,east,north is required");
  const [west, south, east, north] = bboxText.split(",").map(Number);
  const maxZoom = Number(arg("max-zoom") ?? 15);
  const minZoom = Number(arg("min-zoom") ?? 0);
  const url = arg("url") ?? (await newestBuildUrl());
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  const out = arg("out") ?? path.join(appData, "LazyMapLayers", "regions", `${name}.pmtiles`);
  const dryRun = process.argv.includes("--dry-run");

  const counters = { requests: 0, bytes: 0 };
  const read = httpReader(url, counters);
  const started = Date.now();
  const plan = await planExtract(read, { west, south, east, north }, minZoom, maxZoom);
  console.log(
    `plan: ${plan.tiles.length} tiles (z${plan.minZoom}-${plan.maxZoom}), download ${mb(plan.tileBytes)} of tile data; ` +
      `${plan.directoriesRead} directories read (${mb(counters.bytes)} in ${counters.requests} requests, ${((Date.now() - started) / 1000).toFixed(1)} s)`
  );
  if (dryRun) return;

  let lastPrint = 0;
  const archive = await runExtract(plan, read, (p) => {
    const now = Date.now();
    if (now - lastPrint > 2000 || p.downloadedBytes === p.totalBytes) {
      console.log(`  ${mb(p.downloadedBytes)} / ${mb(p.totalBytes)}`);
      lastPrint = now;
    }
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, archive);
  console.log(`wrote ${out}: ${mb(archive.length)} in ${((Date.now() - started) / 1000).toFixed(1)} s, ${counters.requests} requests`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
