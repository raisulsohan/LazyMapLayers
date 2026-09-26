// The names inside the downloaded regions a move flies over: the tiles under every frame that is
// close enough to show a city are read from the region archives on disk, decoded, and turned into
// label records (core/labels/cityNames.ts). Nothing goes online.

import { PMTiles } from "pmtiles";
import { gunzipSync } from "fflate";
import { unproject, type View } from "../../core/camera/camera.ts";
import { cityRecords, type CityFeature, type CityRecord } from "../../core/labels/cityNames.ts";
import { localLanguage } from "../../core/labels/language.ts";
import { decodeTile, tilePointToLngLat } from "../../core/tiles/mvt.ts";
import { NodeFileSource } from "../basemap/nodeFileSource.ts";
import { fs } from "../cep.ts";

/** City names start to matter here: below it the world's cities do the naming. */
export const CITY_DETAIL_ZOOM = 11;
/** The zoom the tiles are read at: every layer the names need is in it, and a city is a few hundred tiles. */
const READ_ZOOM = 13;
const MOST_TILES = 900;
const LAYERS = ["places", "pois", "water", "roads"];

type Box = { west: number; south: number; east: number; north: number };

/** The ground a frame shows, from a grid of screen points (the sky of a tilted view has none). */
function frameBox(view: View, viewport: { width: number; height: number }): Box | null {
  let box: Box | null = null;
  for (let gy = 0; gy <= 4; gy++) {
    for (let gx = 0; gx <= 4; gx++) {
      const at = unproject(view, viewport, { x: (viewport.width * gx) / 4, y: (viewport.height * gy) / 4 });
      if (!at) continue;
      box = box
        ? { west: Math.min(box.west, at.lng), south: Math.min(box.south, at.lat), east: Math.max(box.east, at.lng), north: Math.max(box.north, at.lat) }
        : { west: at.lng, south: at.lat, east: at.lng, north: at.lat };
    }
  }
  return box;
}

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * Math.pow(2, z));
const tileY = (lat: number, z: number) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
};

/** The tiles at `z` under the city frames of a move, nearest the most-seen places first. */
function tilesUnder(cameras: View[], viewport: { width: number; height: number }, z: number): { x: number; y: number }[] {
  const seen = new Map<string, { x: number; y: number; count: number }>();
  const step = Math.max(1, Math.floor(cameras.length / 60));
  for (let i = 0; i < cameras.length; i += step) {
    const view = cameras[i];
    if (view.zoom < CITY_DETAIL_ZOOM) continue;
    const box = frameBox(view, viewport);
    if (!box) continue;
    for (let x = tileX(box.west, z); x <= tileX(box.east, z); x++) {
      for (let y = tileY(box.north, z); y <= tileY(box.south, z); y++) {
        const key = `${x}/${y}`;
        const known = seen.get(key);
        if (known) known.count++;
        else seen.set(key, { x, y, count: 1 });
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

export type CityLabelRead = { records: CityRecord[]; tiles: number; features: number; truncated: boolean; ms: number };

/**
 * The city names of the regions under a move. `country` is the country the move ends over (its
 * code), whose language OpenStreetMap's plain names are in.
 */
export async function cityLabelRecords(archives: string[], cameras: View[], viewport: { width: number; height: number }, country: string): Promise<CityLabelRead> {
  const started = performance.now();
  const present = archives.filter((file) => fs().existsSync(file));
  if (!present.length || !cameras.some((c) => c.zoom >= CITY_DETAIL_ZOOM)) return { records: [], tiles: 0, features: 0, truncated: false, ms: 0 };
  let z = READ_ZOOM;
  let tiles = tilesUnder(cameras, viewport, z);
  // A move that sweeps a whole metropolis: one zoom out, which still has every named layer.
  if (tiles.length > MOST_TILES) {
    z = READ_ZOOM - 1;
    tiles = tilesUnder(cameras, viewport, z);
  }
  const truncated = tiles.length > MOST_TILES;
  tiles = tiles.slice(0, MOST_TILES);

  const features: CityFeature[] = [];
  let read = 0;
  for (const file of present) {
    const source = new NodeFileSource(file, `city-names:${file}`);
    try {
      const archive = new PMTiles(source);
      for (const { x, y } of tiles) {
        const tile = await archive.getZxy(z, x, y);
        if (!tile) continue;
        read++;
        let bytes = new Uint8Array(tile.data);
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
        for (const layer of decodeTile(bytes, LAYERS)) {
          for (const f of layer.features) {
            if (typeof f.properties.name !== "string") continue;
            features.push({ layer: layer.name, type: f.type, properties: f.properties, coords: f.geometry.map((part) => part.map(([px, py]) => tilePointToLngLat(z, x, y, layer.extent, px, py))) });
          }
        }
      }
    } finally {
      source.close();
    }
  }
  const records = cityRecords(features, { country, local: country ? localLanguage(country) : null });
  return { records, tiles: read, features: features.length, truncated, ms: Math.round(performance.now() - started) };
}
