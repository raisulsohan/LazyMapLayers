// Downloaded OpenStreetMap regions (Protomaps planet builds) in the user data folder's "regions"
// (%APPDATA%/LazyMapLayers/regions on Windows, ~/Library/Application Support/LazyMapLayers/regions on macOS).
// Network access goes through Node's https module, so browser CORS rules do not apply.

import { PMTiles } from "pmtiles";
import { planExtract, runExtract, type ExtractPlan, type RangeReader } from "../core/pmtiles/extract.ts";
import type { Bbox } from "../core/tiles/tileMath.ts";
import { fs, path } from "./cep.ts";
import { httpsGet } from "./net.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { NodeFileSource } from "./basemap/nodeFileSource.ts";

export type RegionInfo = { name: string; file: string; sizeBytes: number; bbox: Bbox | null; maxZoom: number | null };

const BUILD_LIST = "https://build-metadata.protomaps.dev/builds.json";

export async function newestPlanetBuild(): Promise<{ url: string; key: string; version: string }> {
  const response = await httpsGet(BUILD_LIST);
  if (response.status !== 200) throw new Error(`Protomaps build list: HTTP ${response.status}`);
  const builds = JSON.parse(new TextDecoder().decode(response.body)) as { key: string; version: string }[];
  const newest = builds[builds.length - 1];
  return { url: `https://build.protomaps.com/${newest.key}`, key: newest.key, version: newest.version };
}

export function rangeReader(url: string): RangeReader {
  return async (offset, length) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await httpsGet(url, { range: `bytes=${offset}-${offset + length - 1}` });
        if (response.status === 206) return response.body;
        if (response.status === 200) return response.body.slice(offset, offset + length);
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  };
}

export async function planRegion(bbox: Bbox, maxZoom: number): Promise<{ plan: ExtractPlan; url: string; build: string }> {
  const build = await newestPlanetBuild();
  const plan = await planExtract(rangeReader(build.url), bbox, 0, maxZoom);
  return { plan, url: build.url, build: build.key };
}

export async function downloadRegion(
  name: string,
  planned: { plan: ExtractPlan; url: string },
  onProgress: (done: number, total: number) => void
): Promise<string> {
  const archive = await runExtract(planned.plan, rangeReader(planned.url), (p) => onProgress(p.downloadedBytes, p.totalBytes));
  const file = regionArchivePath(name);
  fs().mkdirSync(path().dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  fs().writeFileSync(temporary, archive);
  fs().renameSync(temporary, file);
  return file;
}

export function safeRegionName(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "region";
}

export async function listRegions(): Promise<RegionInfo[]> {
  const folder = path().dirname(regionArchivePath("x"));
  if (!fs().existsSync(folder)) return [];
  const out: RegionInfo[] = [];
  for (const entry of fs().readdirSync(folder)) {
    if (!entry.endsWith(".pmtiles")) continue;
    const file = path().join(folder, entry);
    const name = entry.slice(0, -".pmtiles".length);
    const source = new NodeFileSource(file, `region-info-${name}`);
    try {
      const archive = new PMTiles(source);
      const header = await archive.getHeader();
      out.push({
        name,
        file,
        sizeBytes: fs().statSync(file).size,
        bbox: { west: header.minLon, south: header.minLat, east: header.maxLon, north: header.maxLat },
        maxZoom: header.maxZoom
      });
    } catch {
      out.push({ name, file, sizeBytes: fs().statSync(file).size, bbox: null, maxZoom: null });
    } finally {
      source.close();
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
