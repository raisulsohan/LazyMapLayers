// The historical borders pack (D92) in the user data folder, downloaded from the project's GitHub
// release when the user asks:
//
//   <user data>/history/manifest.json    the years, the credit, the licence and the source commit
//   <user data>/history/<year>.json      one year's shapes (1947.json, bc323.json)
//   <user data>/history/LICENSE.txt      the GNU GPL 3.0 the data is under
//
// A year is read once and kept, with the GeoJSON MapLibre draws and the borders between its shapes,
// since a render asks for the same year on every frame.

import { unzipSync } from "fflate";
import { fs, nodeRequire, path, userDataDir } from "../cep.ts";
import { httpsRequest } from "../net.ts";
import { HISTORY_PACK } from "../../core/history/packInfo.ts";
import type { HistoryFeature, HistoryManifest, HistoryYear } from "../../core/history/historyPack.ts";
import { boundsArea, historyBorders, rulerMap, type HistoryBorders, type RulerMap } from "../../core/history/historyStyle.ts";

const folder = () => path().join(userDataDir(), "history");
const manifestPath = () => path().join(folder(), "manifest.json");

let manifest: HistoryManifest | null | undefined;
const years = new Map<number, LoadedYear>();

/** A year ready to draw: its shapes, and the lines between them. */
export type LoadedYear = { year: HistoryYear; borders: HistoryBorders; rulers: RulerMap; byId: Map<string, HistoryFeature> };

/** The installed pack's manifest, or null when the pack is not on this computer. */
export function historyManifest(): HistoryManifest | null {
  if (manifest !== undefined) return manifest;
  try {
    const read = JSON.parse(fs().readFileSync(manifestPath(), "utf8")) as HistoryManifest;
    manifest = read && read.v === 1 && Array.isArray(read.years) && read.years.length ? read : null;
  } catch {
    manifest = null;
  }
  return manifest;
}

export const hasHistoryPack = () => historyManifest() !== null;

/** True when the installed pack is an older build than the one this panel knows (an update is offered). */
export const historyPackOutdated = () => {
  const installed = historyManifest();
  return !!installed && installed.pack !== HISTORY_PACK.tag;
};

/** The manifest entry of one of the pack's years, or null (the panel only offers the pack's own years). */
export function historyYearInfo(year: number) {
  const found = historyManifest()?.years.find((entry) => entry.year === year);
  return found ?? null;
}

/** A year of the installed pack, read once; null when the pack or the year is missing. */
export function loadHistoryYear(year: number): LoadedYear | null {
  const cached = years.get(year);
  if (cached) return cached;
  const info = historyYearInfo(year);
  if (!info) return null;
  try {
    const data = JSON.parse(fs().readFileSync(path().join(folder(), info.file), "utf8")) as HistoryYear;
    if (data.v !== 1 || data.year !== year || !Array.isArray(data.features)) return null;
    const loaded: LoadedYear = { year: data, borders: historyBorders(data.features), rulers: rulerMap(data.features), byId: new Map(data.features.map((f) => [f.id, f])) };
    years.set(year, loaded);
    return loaded;
  } catch {
    return null;
  }
}

/** The year's shapes as GeoJSON for MapLibre, each with the colour of its ruler; land nobody held gets `unclaimed`. */
export function historyShapes(loaded: LoadedYear, colours: Map<string, string>, unclaimed = "rgba(0,0,0,0)"): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: loaded.year.features.map((f) => ({
      type: "Feature",
      properties: { id: f.id, name: f.name, ruler: f.ruler, precision: f.precision, color: f.name ? colours.get(f.ruler) ?? unclaimed : unclaimed },
      geometry: { type: "MultiPolygon", coordinates: f.polygons }
    }))
  };
}

/** Name points of the year's named shapes, the largest first so they win the space. */
export function historyLabels(loaded: LoadedYear): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: loaded.year.features
      .filter((f) => f.name)
      .map((f) => ({ type: "Feature" as const, properties: { id: f.id, name: f.name, rank: -boundsArea(f.bounds) }, geometry: { type: "Point" as const, coordinates: f.label } }))
  };
}

/**
 * Downloads the pack from the project's GitHub release, checks its size and SHA-256, and unpacks it
 * into the user data folder, replacing an older one only once the new one is complete.
 */
export async function downloadHistoryPack(options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<HistoryManifest> {
  const answer = await httpsRequest(HISTORY_PACK.url, { signal: options.signal, onProgress: (done) => options.onProgress?.(done, HISTORY_PACK.bytes) });
  if (answer.status !== 200) throw new Error(`the download answered HTTP ${answer.status}`);
  if (answer.body.length !== HISTORY_PACK.bytes) throw new Error(`the download is ${answer.body.length} bytes, expected ${HISTORY_PACK.bytes}`);
  const digest = nodeRequire<typeof import("node:crypto")>("crypto").createHash("sha256").update(answer.body).digest("hex");
  if (digest !== HISTORY_PACK.sha256) throw new Error("the download is damaged (its checksum is wrong); try again");
  const files = unzipSync(answer.body);
  const nodeFs = fs();
  const target = folder();
  const temporary = `${target}.part`;
  nodeFs.rmSync(temporary, { recursive: true, force: true });
  nodeFs.mkdirSync(temporary, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    // Only the pack's own flat folder: nothing can be written outside it.
    const match = /^history\/([A-Za-z0-9_.-]+)$/.exec(name);
    if (match) nodeFs.writeFileSync(path().join(temporary, match[1]), bytes);
  }
  if (!nodeFs.existsSync(path().join(temporary, "manifest.json"))) throw new Error("the download holds no manifest");
  nodeFs.rmSync(target, { recursive: true, force: true });
  nodeFs.renameSync(temporary, target);
  manifest = undefined;
  years.clear();
  const installed = historyManifest();
  if (!installed) throw new Error("the downloaded manifest could not be read");
  return installed;
}
