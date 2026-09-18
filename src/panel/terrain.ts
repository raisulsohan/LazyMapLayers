// Elevation packs: extracts of Mapterhorn's open elevation tiles (Terrarium encoding, 512 px WebP,
// zoom 0 to 12; built from the Copernicus 30 m model and national open data) in the user data
// folder's "terrain". A pack is cut out of the planet archive with range requests, like a region, so
// only the area that was asked for is downloaded, and its exact size is known before the download.

import { PMTiles } from "pmtiles";
import { planExtract, runExtract, type ExtractPlan } from "../core/pmtiles/extract.ts";
import type { Bbox } from "../core/tiles/tileMath.ts";
import { NodeFileSource } from "./basemap/nodeFileSource.ts";
import { fs, path, userDataDir } from "./cep.ts";
import { rangeReader } from "./regions.ts";

export const TERRAIN_ARCHIVE_URL = "https://download.mapterhorn.com/planet.pmtiles";
export const TERRAIN_MAX_ZOOM = 12;
export const TERRAIN_CREDIT = "Terrain: © Mapterhorn";

export type TerrainPackInfo = { name: string; file: string; sizeBytes: number; bbox: Bbox | null; maxZoom: number | null };

export const terrainArchivePath = (name: string) => path().join(userDataDir(), "terrain", `${name}.pmtiles`);

export const hasTerrainPack = (name: string) => /^[a-z0-9_-]{1,60}$/.test(name) && fs().existsSync(terrainArchivePath(name));

/** Reads the archive's directories for the area (a few hundred kilobytes) and returns what a download would hold. */
export async function planTerrain(bbox: Bbox, maxZoom: number): Promise<{ plan: ExtractPlan; url: string }> {
  const plan = await planExtract(rangeReader(TERRAIN_ARCHIVE_URL), bbox, 0, Math.min(TERRAIN_MAX_ZOOM, Math.max(0, Math.round(maxZoom))));
  return { plan, url: TERRAIN_ARCHIVE_URL };
}

export async function downloadTerrain(name: string, planned: { plan: ExtractPlan; url: string }, onProgress: (done: number, total: number) => void): Promise<string> {
  const archive = await runExtract(planned.plan, rangeReader(planned.url), (p) => onProgress(p.downloadedBytes, p.totalBytes));
  const file = terrainArchivePath(name);
  fs().mkdirSync(path().dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  fs().writeFileSync(temporary, archive);
  fs().renameSync(temporary, file);
  return file;
}

export async function listTerrainPacks(): Promise<TerrainPackInfo[]> {
  const folder = path().dirname(terrainArchivePath("x"));
  if (!fs().existsSync(folder)) return [];
  const out: TerrainPackInfo[] = [];
  for (const entry of fs().readdirSync(folder)) {
    if (!entry.endsWith(".pmtiles")) continue;
    const file = path().join(folder, entry);
    const name = entry.slice(0, -".pmtiles".length);
    const source = new NodeFileSource(file, `terrain-info-${name}`);
    try {
      const header = await new PMTiles(source).getHeader();
      out.push({ name, file, sizeBytes: fs().statSync(file).size, bbox: { west: header.minLon, south: header.minLat, east: header.maxLon, north: header.maxLat }, maxZoom: header.maxZoom });
    } catch {
      out.push({ name, file, sizeBytes: fs().statSync(file).size, bbox: null, maxZoom: null });
    } finally {
      source.close();
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
