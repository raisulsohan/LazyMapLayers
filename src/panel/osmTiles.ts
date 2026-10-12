// The OpenStreetMap tiles behind street detail on demand (DECISIONS D101).
//
// The basemap's OpenStreetMap detail is one tile pyramid, the Protomaps planet build. MapLibre asks for
// its tiles through the lmlosm:// protocol, and a tile comes from the first place that has it:
//
//   1. the installed world (offline/world.pmtiles from the Full or Light pack), up to its own top zoom;
//   2. the tile cache, <user data>/osm-cache/<z>/<x>/<y>.mvt, one file per tile exactly as the planet
//      stores it (gzip), an empty file for a tile the planet does not have;
//   3. a downloaded region whose bounds and zooms hold the tile;
//   4. the planet itself, by range requests, when the computer is online and About > Street detail from
//      the internet is on. What comes is kept in the cache.
//
// Nothing else is sent: the build list from build-metadata.protomaps.dev and byte ranges of the planet
// file from build.protomaps.com. The cache keeps one build while the server still offers it.

import * as maplibregl from "maplibre-gl";
import { gunzipSync } from "fflate";
import { PMTiles, tileIdToZxy } from "pmtiles";
import { fetchTiles, planTiles, type RangeReader } from "../core/pmtiles/extract.ts";
import { parseTileKey, tileKey, type TileId } from "../core/tiles/coveringTiles.ts";
import { tileRangeForBbox, type Bbox } from "../core/tiles/tileMath.ts";
import { fs, isInCep, path, userDataDir } from "./cep.ts";
import { httpsGet, isOfflineError } from "./net.ts";
import { offlineWorldPath, regionArchivePath } from "./basemap/maplibreSetup.ts";
import { NodeFileSource } from "./basemap/nodeFileSource.ts";
import { planetBuilds, planetUrl } from "./regions.ts";
import { readPrefs } from "./prefs.ts";

export const OSM_PROTOCOL = "lmlosm";

/** The tile addresses MapLibre is given for one source ("world" or "streets": the same pyramid). */
export const osmTileUrl = (source: "world" | "streets") => `${OSM_PROTOCOL}://${source}/{z}/{x}/{y}`;

// ---------------------------------------------------------------------------------------------------
// Where the tiles are. The in-AE test SD1 points these at a test folder (a light pack, an empty cache).

type Overrides = { world?: string | null; cache?: string; regions?: boolean };
let overrides: Overrides = {};

/** For tests: another installed world (null: none), another cache folder, downloaded regions left out. */
export function setOsmTileOverrides(next: Overrides | null): void {
  overrides = next ?? {};
  worldArchive = null;
  regionList = null;
  planetPromise = null;
}

export const osmCacheDir = (): string => overrides.cache ?? path().join(userDataDir(), "osm-cache");

const worldFile = (): string | null => (overrides.world === undefined ? offlineWorldPath() : overrides.world);

type Archive = { file: string; bounds: Bbox; minZoom: number; maxZoom: number; size: number; modified: number; reader: PMTiles; source: NodeFileSource };

/** Bounds and zooms from a PMTiles v3 header, read at once (127 bytes). */
function readArchive(file: string, key: string): Archive | null {
  try {
    const nodeFs = fs();
    const stat = nodeFs.statSync(file);
    const fd = nodeFs.openSync(file, "r");
    const head = new Uint8Array(127);
    try {
      nodeFs.readSync(fd, head, 0, 127, 0);
    } finally {
      nodeFs.closeSync(fd);
    }
    const view = new DataView(head.buffer);
    if (view.getUint16(0, true) !== 0x4d50 || head[7] !== 3) return null;
    const source = new NodeFileSource(file, key);
    return {
      file,
      bounds: { west: view.getInt32(102, true) / 1e7, south: view.getInt32(106, true) / 1e7, east: view.getInt32(110, true) / 1e7, north: view.getInt32(114, true) / 1e7 },
      minZoom: head[100],
      maxZoom: head[101],
      size: stat.size,
      modified: Math.round(stat.mtimeMs),
      reader: new PMTiles(source),
      source
    };
  } catch {
    return null;
  }
}

let worldArchive: Archive | null = null;

/** The installed world (Full pack: to zoom 9, Light pack: to zoom 6), or null for an Online install. */
export function installedWorld(): { file: string; maxZoom: number } | null {
  if (!isInCep()) return null;
  const file = worldFile();
  if (!file) return null;
  try {
    const stat = fs().statSync(file);
    if (worldArchive && worldArchive.file === file && worldArchive.size === stat.size && worldArchive.modified === Math.round(stat.mtimeMs)) return worldArchive;
  } catch {
    return null;
  }
  worldArchive?.source.close();
  worldArchive = readArchive(file, `lml-osm-world-${Date.now()}`);
  return worldArchive;
}

type RegionArchive = Archive & { name: string };
let regionList: { read: number; list: RegionArchive[] } | null = null;

/** Downloaded regions on disk (listed again at most every ten seconds, or after `forgetOsmArchives`). */
function regionArchives(): RegionArchive[] {
  if (overrides.regions === false) return [];
  if (regionList && Date.now() - regionList.read < 10000) return regionList.list;
  const folder = path().dirname(regionArchivePath("x"));
  const list: RegionArchive[] = [];
  try {
    for (const entry of fs().readdirSync(folder)) {
      if (!entry.endsWith(".pmtiles")) continue;
      const name = entry.slice(0, -".pmtiles".length);
      const old = regionList?.list.find((r) => r.name === name);
      const file = path().join(folder, entry);
      const stat = fs().statSync(file);
      if (old && old.size === stat.size && old.modified === Math.round(stat.mtimeMs)) list.push(old);
      else {
        old?.source.close();
        const archive = readArchive(file, `lml-osm-region-${name}-${Date.now()}`);
        if (archive) list.push({ ...archive, name });
      }
    }
  } catch {
    // No regions folder yet.
  }
  for (const old of regionList?.list ?? []) if (!list.includes(old)) old.source.close();
  regionList = { read: Date.now(), list };
  return list;
}

/** After a download or a deletion, the next tile looks at the folders again. */
export function forgetOsmArchives(): void {
  regionList = null;
  worldArchive = null;
}

const regionHolding = (tile: TileId): RegionArchive | undefined =>
  regionArchives().find((r) => {
    if (tile.z < r.minZoom || tile.z > r.maxZoom || !(r.bounds.west < r.bounds.east) || !(r.bounds.south < r.bounds.north)) return false;
    const range = tileRangeForBbox(r.bounds, tile.z);
    return tile.x >= range.minX && tile.x <= range.maxX && tile.y >= range.minY && tile.y <= range.maxY;
  });

const cacheFile = (tile: TileId) => path().join(osmCacheDir(), String(tile.z), String(tile.x), `${tile.y}.mvt`);

function cachedSize(tile: TileId): number | null {
  try {
    return fs().statSync(cacheFile(tile)).size;
  } catch {
    return null;
  }
}

/** Where a tile would be read from, without reading it: "world", "cache:<bytes>", "region:<name>:<bytes>:<time>", or null. */
export function tileSource(key: string): string | null {
  const tile = parseTileKey(key);
  const world = installedWorld();
  if (world && tile.z <= world.maxZoom) return "world";
  const size = cachedSize(tile);
  if (size !== null) return `cache:${size}`;
  const region = regionHolding(tile);
  return region ? `region:${region.name}:${region.size}:${region.modified}` : null;
}

export const hasOsmTile = (key: string): boolean => tileSource(key) !== null;

// ---------------------------------------------------------------------------------------------------
// Online, and allowed to be.

let offlineUntil = 0;
const offlineListeners = new Set<() => void>();

let allowedOverride: boolean | null = null;

/** For the in-AE tests: the suite keeps every test but SD1 off the internet (null: the preference again). */
export function setStreetDetailOverride(allowed: boolean | null): void {
  allowedOverride = allowed;
}

/** About > Street detail from the internet. */
export const streetDetailAllowed = (): boolean => allowedOverride ?? readPrefs().streetDetail;

/** True when tiles may be fetched now: the switch is on and no request has just failed for want of a connection. */
export const osmOnline = (): boolean => streetDetailAllowed() && Date.now() >= offlineUntil;

/** Called when the panel finds itself offline (once per minute at most), so the preview can show what is here. */
export function onOsmOffline(listener: () => void): () => void {
  offlineListeners.add(listener);
  return () => offlineListeners.delete(listener);
}

function markOffline(): void {
  const was = Date.now() < offlineUntil;
  offlineUntil = Date.now() + 60000;
  if (!was) for (const listener of offlineListeners) listener();
}

/** For tests: forget a recent failure. */
export function resetOsmOffline(): void {
  offlineUntil = 0;
}

let probe: Promise<boolean> | null = null;
let probedAt = 0;

/**
 * Once a minute at most: asks for the list of planet builds (a few kilobytes) to see whether the
 * connection is back. True when tiles may be fetched again.
 */
export function probeOsmOnline(): Promise<boolean> {
  if (!streetDetailAllowed()) return Promise.resolve(false);
  if (osmOnline()) return Promise.resolve(true);
  if (probe) return probe;
  if (Date.now() - probedAt < 60000) return Promise.resolve(false);
  probedAt = Date.now();
  probe = planetBuilds()
    .then(
      () => {
        offlineUntil = 0;
        return true;
      },
      (error) => {
        if (isOfflineError(error)) markOffline();
        return false;
      }
    )
    .finally(() => {
      probe = null;
    });
  return probe;
}

// ---------------------------------------------------------------------------------------------------
// The planet.

type Planet = { build: string; read: RangeReader; readIndex: RangeReader };
let planetPromise: Promise<Planet> | null = null;

const stateFile = () => path().join(osmCacheDir(), "state.json");

function readState(): { build?: string } {
  try {
    return JSON.parse(fs().readFileSync(stateFile(), "utf8")) as { build?: string };
  } catch {
    return {};
  }
}

/** Byte ranges of the planet: retried on a server error, given up at once when there is no connection. */
function planetReader(url: string): RangeReader {
  return async (offset, length) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await httpsGet(url, { range: `bytes=${offset}-${offset + length - 1}` });
        if (response.status === 206) return response.body;
        if (response.status === 200) return response.body.slice(offset, offset + length);
        // A build Protomaps no longer keeps.
        if (response.status === 404 || response.status === 410) throw Object.assign(new Error(`HTTP ${response.status} from ${url}`), { gone: true });
        throw new Error(`HTTP ${response.status} from ${url}`);
      } catch (error) {
        if (isOfflineError(error)) markOffline();
        if (isOfflineError(error) || (error as { gone?: boolean }).gone || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      }
    }
  };
}

/** The header and directories of a build, kept on disk: a second plan against it costs no requests. */
const indexName = (build: string) => build.replace(/[^a-z0-9_.-]+/gi, "_");

function indexReader(build: string, read: RangeReader): RangeReader {
  const folder = path().join(osmCacheDir(), "index", indexName(build));
  return async (offset, length) => {
    const file = path().join(folder, `${offset}-${length}.bin`);
    try {
      return new Uint8Array(fs().readFileSync(file));
    } catch {
      const bytes = await read(offset, length);
      fs().mkdirSync(folder, { recursive: true });
      writeAtomically(file, bytes);
      return bytes;
    }
  };
}

/** The build the cache uses: its own while Protomaps still offers it, else the newest. */
async function planet(): Promise<Planet> {
  if (!planetPromise) {
    planetPromise = (async () => {
      let builds: { key: string }[];
      try {
        builds = await planetBuilds();
      } catch (error) {
        if (isOfflineError(error)) markOffline();
        throw error;
      }
      if (!builds.length) throw new Error("Protomaps lists no planet builds");
      const kept = readState().build;
      const build = kept && builds.some((b) => b.key === kept) ? kept : builds[builds.length - 1].key;
      if (build !== kept) {
        fs().mkdirSync(osmCacheDir(), { recursive: true });
        fs().writeFileSync(stateFile(), JSON.stringify({ build, since: new Date().toISOString(), previous: kept ?? null }, null, 2));
        // The directories of the build before are of no more use.
        const index = path().join(osmCacheDir(), "index");
        try {
          for (const entry of fs().readdirSync(index)) if (entry !== indexName(build)) fs().rmSync(path().join(index, entry), { recursive: true, force: true });
        } catch {
          // No directories kept yet.
        }
      }
      const read = planetReader(planetUrl(build));
      return { build, read, readIndex: indexReader(build, read) };
    })();
    planetPromise.catch(() => {
      planetPromise = null;
    });
  }
  return planetPromise;
}

/** The planet build new tiles come from, if the panel has asked already this session. */
export async function osmBuild(): Promise<string> {
  return (await planet()).build;
}

const madeFolders = new Set<string>();
let written = 0;

/** Written under a name of its own, then renamed, so a reader never sees half a file (the preview and a render may fetch at once). */
function writeAtomically(file: string, bytes: Uint8Array): void {
  const part = `${file}.${process.pid}-${++written}.part`;
  fs().writeFileSync(part, bytes);
  fs().renameSync(part, file);
}

function writeCacheTile(tile: TileId, bytes: Uint8Array): void {
  const file = cacheFile(tile);
  const folder = path().dirname(file);
  if (!madeFolders.has(folder)) {
    fs().mkdirSync(folder, { recursive: true });
    madeFolders.add(folder);
  }
  writeAtomically(file, bytes);
}

export type OsmFetchResult = { fetched: number; absent: number; bytes: number; build: string | null };

/**
 * Fetches the tiles of `keys` that are nowhere on this computer, in merged ranges, four requests at a
 * time, and keeps them in the cache. Throws when offline or cancelled; tiles fetched so far are kept.
 */
export async function fetchOsmTiles(keys: string[], options: { signal?: AbortSignal; onProgress?: (doneBytes: number, totalBytes: number) => void } = {}): Promise<OsmFetchResult> {
  try {
    return await fetchFromPlanet(keys, options);
  } catch (error) {
    if (!(error as { gone?: boolean }).gone) throw error;
    // The cache's build is gone from the server: the newest build from now on.
    fs().writeFileSync(stateFile(), JSON.stringify({ build: null, gone: readState().build ?? null, at: new Date().toISOString() }, null, 2));
    planetPromise = null;
    return fetchFromPlanet(keys, options);
  }
}

async function fetchFromPlanet(keys: string[], options: { signal?: AbortSignal; onProgress?: (doneBytes: number, totalBytes: number) => void }): Promise<OsmFetchResult> {
  const missing = keys.filter((key) => !hasOsmTile(key));
  if (!missing.length) return { fetched: 0, absent: 0, bytes: 0, build: null };
  if (!streetDetailAllowed()) throw new Error("street detail from the internet is off (About)");
  const { build, read, readIndex } = await planet();
  const plan = await planTiles(read, missing.map(parseTileKey), { readIndex });
  let fetched = 0;
  await fetchTiles(
    plan,
    read,
    (tileId, bytes) => {
      const [z, x, y] = tileIdToZxy(tileId);
      writeCacheTile({ z, x, y }, bytes);
      fetched++;
    },
    (p) => options.onProgress?.(p.downloadedBytes, p.totalBytes),
    { parallel: 4, cancelled: () => !!options.signal?.aborted }
  );
  for (const id of plan.absent) {
    const [z, x, y] = tileIdToZxy(id);
    writeCacheTile({ z, x, y }, new Uint8Array(0));
  }
  // It worked: whatever failed before, the connection is there.
  offlineUntil = 0;
  return { fetched, absent: plan.absent.length, bytes: plan.tileBytes, build };
}

// ---------------------------------------------------------------------------------------------------
// Tiles fetched as MapLibre asks for them (the preview, and anything a render's plan did not foresee):
// requests that arrive together are planned together, so neighbouring tiles share a range.

let pending: { key: string; resolve: (ok: boolean) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const inFlight = new Map<string, Promise<boolean>>();
/** Tiles MapLibre asked for that were nowhere and could not be fetched, since the last `takeOsmMisses`. */
const misses = new Set<string>();
/** Tiles fetched because MapLibre asked for them, since the last `takeOsmMisses`. */
let fetchedLive = 0;

function flush(): void {
  flushTimer = null;
  const batch = pending.slice(0, 64);
  pending = pending.slice(64);
  if (pending.length) flushTimer = setTimeout(flush, 0);
  fetchOsmTiles(batch.map((p) => p.key)).then(
    (result) => {
      fetchedLive += result.fetched;
      for (const p of batch) p.resolve(true);
    },
    () => {
      for (const p of batch) p.resolve(false);
    }
  );
}

function fetchLive(key: string): Promise<boolean> {
  const running = inFlight.get(key);
  if (running) return running;
  const promise = new Promise<boolean>((resolve) => {
    pending.push({ key, resolve });
    if (!flushTimer) flushTimer = setTimeout(flush, 25);
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** What MapLibre asked for that was missing (and could not be fetched), and how many tiles came on the fly. */
export function takeOsmMisses(): { missing: string[]; fetched: number } {
  const out = { missing: [...misses].sort(), fetched: fetchedLive };
  misses.clear();
  fetchedLive = 0;
  return out;
}

const decoded = (bytes: Uint8Array): Uint8Array => (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);

/** A tile's MVT bytes (empty when the planet has none there or it is not to be had). */
export async function readOsmTile(tile: TileId): Promise<Uint8Array> {
  const world = installedWorld();
  if (world && tile.z <= world.maxZoom) {
    const found = await (world as Archive).reader.getZxy(tile.z, tile.x, tile.y);
    return found ? new Uint8Array(found.data) : new Uint8Array(0);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return decoded(new Uint8Array(fs().readFileSync(cacheFile(tile))));
    } catch {
      // Not in the cache.
    }
    const region = regionHolding(tile);
    if (region) {
      const found = await region.reader.getZxy(tile.z, tile.x, tile.y);
      if (found) return new Uint8Array(found.data);
    }
    if (attempt > 0 || !osmOnline()) break;
    if (!(await fetchLive(tileKey(tile)))) break;
  }
  // Kept for the render that asked; the preview's misses are forgotten now and then.
  if (misses.size > 10000) misses.clear();
  misses.add(tileKey(tile));
  return new Uint8Array(0);
}

let protocolReady = false;

/** Registers lmlosm:// with MapLibre once. */
export function ensureOsmProtocol(): void {
  if (protocolReady) return;
  protocolReady = true;
  maplibregl.addProtocol(OSM_PROTOCOL, async (params) => {
    const match = /^lmlosm:\/\/[a-z]+\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!match) throw new Error(`not a street detail tile: ${params.url}`);
    const data = await readOsmTile({ z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) });
    return { data };
  });
}

// ---------------------------------------------------------------------------------------------------
// The cache on disk.

/** How much the cache holds (tiles only). */
export function osmCacheSize(): { tiles: number; bytes: number } {
  let tiles = 0;
  let bytes = 0;
  const walk = (folder: string, depth: number) => {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = fs().readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path().join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 && !/^\d+$/.test(entry.name)) continue;
        walk(file, depth + 1);
      } else if (entry.name.endsWith(".mvt")) {
        tiles++;
        bytes += fs().statSync(file).size;
      }
    }
  };
  walk(osmCacheDir(), 0);
  return { tiles, bytes };
}

/** Empties the cache (tiles, the planet's directories and the build it kept). */
export function clearOsmCache(): void {
  fs().rmSync(osmCacheDir(), { recursive: true, force: true });
  madeFolders.clear();
  planetPromise = null;
}
