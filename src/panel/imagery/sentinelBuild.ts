// Builds a satellite basemap for one area out of Sentinel-2 scenes, without an account or a key.
//
// The catalogue says which scenes cover the area and how cloudy each was. Each scene's true-colour
// picture is a cloud-optimised GeoTIFF on an open bucket, so only the tiles that cover the area, at
// the level of detail asked for, are ever downloaded. Every map tile is drawn by taking each of its
// pixels from the clearest scene that has ground there; where the clearest scene had cloud, the next
// one fills in. The result is written as a PMTiles archive in the user's data folder, which the
// renderer already knows how to draw.

import { decodeTile, directoryForResolution, pixelOf, readTiff, tileRange, tilesCovering, TIFF_HEADER_BYTES, type Tiff, type TiffDirectory } from "../../core/image/geotiff.ts";
import {
  estimateBytes,
  pickScenes,
  pixelToSceneGrid,
  readSentinelScenes,
  SENTINEL_CATALOGUE,
  SENTINEL_CREDIT,
  SENTINEL_MAX_ZOOM,
  sentinelSearchBody,
  tileMetresPerPixel,
  tileOnSceneGrid,
  type SentinelScene
} from "../../core/imagery/sentinel.ts";
import { PMTILES_COMPRESSION, PMTILES_TILE_TYPE, PmtilesWriter } from "../../core/pmtiles/writer.ts";
import { paintPass } from "../../core/imagery/satelliteTile.ts";
import type { Bbox } from "../../core/tiles/tileMath.ts";
import { PMTiles } from "pmtiles";
import { NodeFileSource } from "../basemap/nodeFileSource.ts";
import { fs, path, userDataDir } from "../cep.ts";

export const SATELLITE_FOLDER = "satellite";
export const TILE = 256;

export type SatellitePlan = {
  scenes: SentinelScene[];
  /** Every map tile the area needs, from the lowest zoom to the highest. */
  tiles: { z: number; x: number; y: number }[];
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  estimateBytes: number;
};

export type BuildProgress = { done: number; total: number; bytes: number; tile: string };

export const satellitePath = (name: string) => path().join(userDataDir(), SATELLITE_FOLDER, `${name}.pmtiles`);
export const isSatelliteName = (name: string) => /^[a-z0-9_-]{1,60}$/.test(name);
export const hasSatellite = (name: string) => isSatelliteName(name) && fs().existsSync(satellitePath(name));

const tileRangeForBbox = (bbox: Bbox, z: number) => {
  const n = Math.pow(2, z);
  const toX = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const toY = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  return {
    minX: Math.max(0, toX(bbox.west)),
    maxX: Math.min(n - 1, toX(bbox.east)),
    minY: Math.max(0, toY(Math.min(85, bbox.north))),
    maxY: Math.min(n - 1, toY(Math.max(-85, bbox.south)))
  };
};

/** Asks the catalogue what there is, and works out what a build would download. */
export async function planSatellite(bbox: Bbox, options: { minZoom?: number; maxZoom: number; months?: number; maxCloud?: number; tries?: number; signal?: AbortSignal }): Promise<SatellitePlan> {
  const maxZoom = Math.max(1, Math.min(SENTINEL_MAX_ZOOM, Math.round(options.maxZoom)));
  const minZoom = Math.max(0, Math.min(maxZoom, options.minZoom ?? Math.max(0, maxZoom - 4)));
  const to = new Date();
  const from = new Date(to.getTime() - (options.months ?? 14) * 30 * 24 * 3600 * 1000);
  const response = await fetch(SENTINEL_CATALOGUE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sentinelSearchBody({ bbox, from: from.toISOString(), to: to.toISOString(), maxCloud: options.maxCloud ?? 12, limit: 60 })),
    signal: options.signal
  });
  if (!response.ok) throw new Error(`the Sentinel catalogue answered ${response.status}`);
  const scenes = pickScenes(readSentinelScenes(await response.json()), bbox, options.tries ?? 3);
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const range = tileRangeForBbox(bbox, z);
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) tiles.push({ z, x, y });
    }
  }
  return { scenes, tiles, bbox, minZoom, maxZoom, estimateBytes: estimateBytes(tiles.length, Math.max(1, scenes.length)) };
}

/** One scene's picture, read a tile at a time and kept for as long as the build runs. */
class CogReader {
  private header: Tiff | null = null;
  private readonly tiles = new Map<string, Uint8Array | null>();
  bytes = 0;

  private readonly url: string;
  private readonly signal: AbortSignal | undefined;

  constructor(url: string, signal?: AbortSignal) {
    this.url = url;
    this.signal = signal;
  }

  private async range(from: number, to: number): Promise<Uint8Array> {
    const response = await fetch(this.url, { headers: { Range: `bytes=${from}-${to}` }, signal: this.signal });
    if (response.status !== 206 && response.status !== 200) throw new Error(`the scene answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.bytes += bytes.length;
    return bytes;
  }

  async open(): Promise<Tiff> {
    if (!this.header) this.header = readTiff(await this.range(0, TIFF_HEADER_BYTES - 1));
    return this.header;
  }

  /** The pixels of one tile of one level, downloaded once however often they are wanted. */
  async tile(level: number, column: number, row: number): Promise<{ directory: TiffDirectory; pixels: Uint8Array } | null> {
    const tiff = await this.open();
    const directory = tiff.directories[level];
    if (!directory) return null;
    const key = `${level}/${column}/${row}`;
    if (!this.tiles.has(key)) {
      const spot = tileRange(directory, column, row);
      if (!spot) this.tiles.set(key, null);
      else {
        const raw = await this.range(spot.offset, spot.offset + spot.bytes - 1);
        this.tiles.set(key, decodeTile(directory, raw));
      }
    }
    const pixels = this.tiles.get(key) ?? null;
    return pixels ? { directory, pixels } : null;
  }

  /** Lets go of the tiles kept for a level, so a long build does not fill memory. */
  forget(): void {
    this.tiles.clear();
  }
}

type SceneReader = { scene: SentinelScene; picture: CogReader; classes: CogReader | null };

/**
 * A scene's pixels for one rectangle of ground, downloaded once and then read as a plain function.
 * This is what keeps painting a 65,536 pixel tile fast: the waiting happens here, in a handful of
 * range requests, not once for every pixel.
 */
async function windowOf(reader: CogReader, level: number, box: { west: number; east: number; south: number; north: number }, samples: number): Promise<((x: number, y: number) => Uint8Array | null) | null> {
  const tiff = await reader.open();
  const directory = tiff.directories[level];
  if (!directory) return null;
  const wanted = tilesCovering(directory, box);
  if (!wanted.length) return null;
  const held = new Map<string, Uint8Array | null>();
  for (const { column, row } of wanted) {
    const tile = await reader.tile(level, column, row);
    held.set(`${column}/${row}`, tile ? tile.pixels : null);
  }
  const blank = new Uint8Array(samples);
  return (x: number, y: number) => {
    const pixel = pixelOf(directory, x, y);
    if (!pixel) return null;
    const px = Math.floor(pixel.x);
    const py = Math.floor(pixel.y);
    if (px < 0 || py < 0 || px >= directory.width || py >= directory.height) return null;
    const pixels = held.get(`${Math.floor(px / directory.tileWidth)}/${Math.floor(py / directory.tileHeight)}`);
    if (!pixels) return null;
    const at = ((py % directory.tileHeight) * directory.tileWidth + (px % directory.tileWidth)) * directory.samples;
    if (at + samples > pixels.length) return blank;
    return pixels.subarray(at, at + Math.min(samples, directory.samples));
  };
}

export type SatellitePackInfo = { name: string; file: string; sizeBytes: number; bbox: Bbox | null; minZoom: number | null; maxZoom: number | null; attribution: string | null; scenes: string | null };

/** The satellite areas on this computer. */
export async function listSatellitePacks(): Promise<SatellitePackInfo[]> {
  const folder = path().join(userDataDir(), SATELLITE_FOLDER);
  if (!fs().existsSync(folder)) return [];
  const out: SatellitePackInfo[] = [];
  for (const entry of fs().readdirSync(folder) as string[]) {
    if (!entry.endsWith(".pmtiles")) continue;
    const file = path().join(folder, entry);
    const name = entry.slice(0, -".pmtiles".length);
    const source = new NodeFileSource(file, `satellite-info-${name}`);
    try {
      const archive = new PMTiles(source);
      const header = await archive.getHeader();
      const metadata = (await archive.getMetadata()) as { attribution?: unknown; scenes?: unknown };
      out.push({
        name,
        file,
        sizeBytes: fs().statSync(file).size,
        bbox: { west: header.minLon, south: header.minLat, east: header.maxLon, north: header.maxLat },
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        attribution: typeof metadata?.attribution === "string" ? metadata.attribution : null,
        scenes: typeof metadata?.scenes === "string" ? metadata.scenes : null
      });
    } catch {
      out.push({ name, file, sizeBytes: fs().statSync(file).size, bbox: null, minZoom: null, maxZoom: null, attribution: null, scenes: null });
    } finally {
      source.close();
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A finished tile as bytes, encoded by the browser the panel runs in. */
export function encodeTile(rgba: Uint8ClampedArray): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas to encode a tile with");
  const image = context.createImageData(TILE, TILE);
  image.data.set(rgba);
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("the tile could not be encoded"));
        else blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/webp",
      0.85
    )
  );
}

export type SatelliteResult = { file: string; tiles: number; bytes: number; downloaded: number; scenes: string[]; cancelled: boolean };

/**
 * Builds the archive. `paint` is given every finished tile so the panel can show one while it works.
 */
export async function buildSatellite(
  name: string,
  plan: SatellitePlan,
  options: { signal?: AbortSignal; onProgress?: (progress: BuildProgress) => void; encode: (rgba: Uint8ClampedArray) => Promise<Uint8Array> }
): Promise<SatelliteResult> {
  if (!isSatelliteName(name)) throw new Error("a satellite area's name may hold small letters, numbers, dashes and underscores");
  if (!plan.scenes.length) throw new Error("the catalogue has no clear Sentinel-2 scene over this area in the window searched");
  const readers: SceneReader[] = plan.scenes.map((scene) => ({
    scene,
    picture: new CogReader(scene.visual, options.signal),
    classes: scene.classification ? new CogReader(scene.classification, options.signal) : null
  }));
  const writer = new PmtilesWriter();
  const rgba = new Uint8ClampedArray(TILE * TILE * 4);
  let done = 0;
  let cancelled = false;

  for (const tile of plan.tiles) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    const metres = tileMetresPerPixel(tile.z, tile.y, TILE);
    const total = TILE * TILE;
    rgba.fill(0);
    let painted = 0;
    const from: number[] = [];
    for (let s = 0; s < readers.length && painted < total; s++) {
      const reader = readers[s];
      if (!reader.scene.grid) continue;
      const box = tileOnSceneGrid(tile.z, tile.x, tile.y, reader.scene.grid);
      let colour: ((x: number, y: number) => Uint8Array | null) | null = null;
      try {
        colour = await windowOf(reader.picture, directoryForResolution(await reader.picture.open(), metres), box, 3);
      } catch {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        continue;
      }
      if (!colour) continue;
      let kind: ((x: number, y: number) => number | null) | null = null;
      if (reader.classes) {
        try {
          const classes = await windowOf(reader.classes, directoryForResolution(await reader.classes.open(), metres), box, 1);
          if (classes) kind = (x: number, y: number) => classes(x, y)?.[0] ?? null;
        } catch {
          reader.classes = null;
        }
      }
      const added = paintPass(tile.z, tile.x, tile.y, TILE, { grid: reader.scene.grid, colour, kind }, rgba);
      if (added) {
        painted += added;
        from.push(s);
      }
    }
    if (cancelled) break;
    if (painted) writer.addTile(tile.z, tile.x, tile.y, await options.encode(rgba));
    done++;
    options.onProgress?.({ done, total: plan.tiles.length, bytes: readers.reduce((sum, reader) => sum + reader.picture.bytes + (reader.classes?.bytes ?? 0), 0), tile: `${tile.z}/${tile.x}/${tile.y}` });
    // The pictures are large, and one map zoom rarely reuses the pieces of the last.
    if (done % 12 === 0) for (const reader of readers) reader.picture.forget();
  }

  const year = plan.scenes[0]?.date.slice(0, 4) ?? new Date().getFullYear();
  const bytes = writer.build({
    tileType: PMTILES_TILE_TYPE.webp,
    tileCompression: PMTILES_COMPRESSION.none,
    bounds: [plan.bbox.west, plan.bbox.south, plan.bbox.east, plan.bbox.north],
    metadata: {
      name: `Sentinel-2 ${name}`,
      attribution: `${SENTINEL_CREDIT} ${year}`,
      format: "webp",
      tileSize: TILE,
      scenes: plan.scenes.map((scene) => scene.id).join(", ")
    }
  });
  const file = satellitePath(name);
  fs().mkdirSync(path().dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  fs().writeFileSync(temporary, bytes);
  fs().renameSync(temporary, file);
  return { file, tiles: writer.tileCount, bytes: bytes.length, downloaded: readers.reduce((sum, reader) => sum + reader.picture.bytes + (reader.classes?.bytes ?? 0), 0), scenes: plan.scenes.map((scene) => scene.id), cancelled };
}
