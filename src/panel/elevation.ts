// Elevation of places from an installed elevation pack, for pins, labels and routes on 3D terrain.
// Tiles are read from the pack at its highest zoom, decoded once (WebP, Terrarium encoding) and
// sampled bilinearly, the way the renderer's terrain reads them; places outside the pack are at 0.

import { PMTiles } from "pmtiles";
import type { LngLat } from "../core/geo/mercator.ts";
import { sampleTerrarium, tileOf } from "../core/geo/terrarium.ts";
import { NodeFileSource } from "./basemap/nodeFileSource.ts";
import { hasTerrainPack, terrainArchivePath } from "./terrain.ts";

type Decoded = { rgba: Uint8ClampedArray; size: number } | null;

const TILE_CACHE = 64;

export class ElevationSampler {
  private readonly pack: string;
  private archive: PMTiles | null = null;
  private source: NodeFileSource | null = null;
  private header: { maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number } | null = null;
  private readonly tiles = new Map<string, Promise<Decoded>>();

  constructor(pack: string) {
    this.pack = pack;
  }

  private async open(): Promise<boolean> {
    if (this.header) return true;
    if (!hasTerrainPack(this.pack)) return false;
    this.source = new NodeFileSource(terrainArchivePath(this.pack), `elevation-${this.pack}-${Date.now()}`);
    this.archive = new PMTiles(this.source);
    const h = await this.archive.getHeader();
    this.header = { maxZoom: h.maxZoom, minLon: h.minLon, minLat: h.minLat, maxLon: h.maxLon, maxLat: h.maxLat };
    return true;
  }

  private tile(z: number, x: number, y: number): Promise<Decoded> {
    const key = `${z}/${x}/${y}`;
    let pending = this.tiles.get(key);
    if (!pending) {
      pending = this.decode(z, x, y);
      this.tiles.set(key, pending);
      if (this.tiles.size > TILE_CACHE) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return pending;
  }

  private async decode(z: number, x: number, y: number): Promise<Decoded> {
    const result = await this.archive!.getZxy(z, x, y);
    if (!result || !result.data.byteLength) return null;
    const bitmap = await createImageBitmap(new Blob([result.data], { type: "image/webp" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { rgba: context.getImageData(0, 0, canvas.width, canvas.height).data, size: canvas.width };
  }

  /** Metres above sea level at a place, or 0 outside the pack. */
  async elevationAt(place: LngLat): Promise<number> {
    if (!(await this.open())) return 0;
    const h = this.header!;
    if (place.lng < h.minLon || place.lng > h.maxLon || place.lat < h.minLat || place.lat > h.maxLat) return 0;
    const at = tileOf(place.lat, place.lng, h.maxZoom);
    const tile = await this.tile(at.z, at.x, at.y);
    if (!tile) return 0;
    return Math.round(sampleTerrarium(tile.rgba, tile.size, at.fx, at.fy) * 10) / 10;
  }

  async elevations(places: LngLat[]): Promise<number[]> {
    const out: number[] = [];
    for (const place of places) out.push(await this.elevationAt(place));
    return out;
  }

  close(): void {
    this.source?.close();
    this.source = null;
    this.archive = null;
    this.header = null;
    this.tiles.clear();
  }
}

/** A sampler for the map's elevation pack, or null when it has none (then every place is at 0). Pins made with a pack carry their elevation even before 3D terrain is switched on. */
export function samplerFor(terrain: { pack: string; height: number } | null | undefined): ElevationSampler | null {
  return terrain && hasTerrainPack(terrain.pack) ? new ElevationSampler(terrain.pack) : null;
}
