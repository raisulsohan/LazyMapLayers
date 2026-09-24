// Sentinel-2, the free satellite picture of the whole world at ten metres.
//
// The European Union's Copernicus programme photographs every place on Earth every few days and
// gives the pictures away, for any use including commercial, as long as they are credited. Amazon
// keeps the processed scenes as cloud-optimised GeoTIFFs in an open bucket and Element 84 runs an
// open catalogue over them, neither of which asks for an account or a key - so the panel can build a
// satellite basemap for an area without anyone signing up for anything.
//
// This file is the thinking part: what to ask the catalogue, what a scene says about itself, which
// scenes are worth using, and which pixels of them a map tile needs. The fetching and the drawing
// live in the panel.

import { lngLatFromUtm, utmFromLngLat, zoneOfEpsg, type UtmZone } from "../geo/utm.ts";
import type { Bbox } from "../tiles/tileMath.ts";

export const SENTINEL_CATALOGUE = "https://earth-search.aws.element84.com/v1/search";
export const SENTINEL_COLLECTION = "sentinel-2-l2a";
export const SENTINEL_CREDIT = "Contains modified Copernicus Sentinel data";

/** Ten metres a pixel is the finest these scenes hold, which is a little past zoom 14. */
export const SENTINEL_METRES = 10;
export const SENTINEL_MAX_ZOOM = 15;

export type SentinelSearch = {
  bbox: Bbox;
  /** The window to look in, as ISO dates. */
  from: string;
  to: string;
  /** Scenes cloudier than this share are not worth downloading. */
  maxCloud?: number;
  limit?: number;
};

export type SentinelScene = {
  id: string;
  /** When it was taken, as the catalogue writes it. */
  date: string;
  cloud: number;
  /** The projection the scene's own pixels are on. */
  epsg: number;
  grid: UtmZone | null;
  /** Where the scene's true-colour and classification pictures are. */
  visual: string;
  classification: string | null;
  bbox: Bbox | null;
};

/** What to send the open catalogue to find scenes over an area. */
export function sentinelSearchBody(search: SentinelSearch): Record<string, unknown> {
  const maxCloud = search.maxCloud ?? 10;
  return {
    collections: [SENTINEL_COLLECTION],
    bbox: [search.bbox.west, search.bbox.south, search.bbox.east, search.bbox.north],
    datetime: `${search.from}/${search.to}`,
    limit: Math.max(1, Math.min(100, search.limit ?? 40)),
    query: { "eo:cloud_cover": { lt: maxCloud } },
    sortby: [{ field: "properties.eo:cloud_cover", direction: "asc" }]
  };
}

const boxOf = (value: unknown): Bbox | null => {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [west, south, east, north] = value.map(Number);
  if (![west, south, east, north].every((n) => Number.isFinite(n))) return null;
  return { west, south, east, north };
};

/** The scenes in a catalogue answer, as this panel needs them. */
export function readSentinelScenes(raw: unknown): SentinelScene[] {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: SentinelScene[] = [];
  for (const entry of features) {
    const feature = (entry ?? {}) as { id?: unknown; bbox?: unknown; properties?: Record<string, unknown>; assets?: Record<string, { href?: unknown }> };
    const visual = typeof feature.assets?.visual?.href === "string" ? feature.assets.visual.href : "";
    if (!visual || typeof feature.id !== "string") continue;
    const epsg = Number(feature.properties?.["proj:epsg"] ?? feature.properties?.["proj:code"] ?? 0);
    out.push({
      id: feature.id,
      date: typeof feature.properties?.datetime === "string" ? feature.properties.datetime : "",
      cloud: Number(feature.properties?.["eo:cloud_cover"] ?? 100),
      epsg,
      grid: zoneOfEpsg(epsg),
      visual,
      classification: typeof feature.assets?.scl?.href === "string" ? feature.assets.scl.href : null,
      bbox: boxOf(feature.bbox)
    });
  }
  return out;
}

/** Whether a scene's own outline covers a place at all. */
export const sceneCovers = (scene: SentinelScene, bbox: Bbox): boolean =>
  !scene.bbox || (scene.bbox.west <= bbox.east && scene.bbox.east >= bbox.west && scene.bbox.south <= bbox.north && scene.bbox.north >= bbox.south);

/**
 * The scenes to build from: the clearest first, and only as many as are needed to have a second and
 * third try at a pixel the clearest one lost to cloud. Scenes from the same day of the same orbit sit
 * side by side rather than on top of each other, so they all stay.
 */
export function pickScenes(scenes: SentinelScene[], bbox: Bbox, tries = 3): SentinelScene[] {
  const usable = scenes.filter((scene) => scene.grid && sceneCovers(scene, bbox));
  const byDay = new Map<string, SentinelScene[]>();
  for (const scene of usable) {
    const day = scene.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), scene]);
  }
  const days = [...byDay.entries()]
    .map(([day, group]) => ({ day, group, cloud: group.reduce((sum, scene) => sum + scene.cloud, 0) / group.length }))
    .sort((a, b) => a.cloud - b.cloud)
    .slice(0, Math.max(1, tries));
  return days.flatMap((entry) => entry.group);
}

/** Where a web mercator tile's own pixels fall on a scene's grid. */
export type TilePlan = {
  /** The tile being drawn. */
  z: number;
  x: number;
  y: number;
  /** Ground metres a pixel of the finished tile stands for, at the middle of it. */
  metresPerPixel: number;
};

const EARTH = 40075016.68557849;
const DEG = Math.PI / 180;

/** The ground a web mercator tile covers, in metres a pixel, at its own middle. */
export function tileMetresPerPixel(z: number, y: number, tileSize: number): number {
  const n = Math.pow(2, z);
  const lat = latOfTileRow(y + 0.5, z);
  return (EARTH * Math.cos(lat * DEG)) / (n * tileSize);
}

/** The latitude of a row of tiles (rows may be fractional, for the middle of a tile). */
export function latOfTileRow(row: number, z: number): number {
  const n = Math.pow(2, z);
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
}

/** The longitude of a column of tiles. */
export const lngOfTileColumn = (column: number, z: number): number => (column / Math.pow(2, z)) * 360 - 180;

/** The place each pixel of a map tile stands on. */
export function tileCorners(z: number, x: number, y: number): Bbox {
  return {
    west: lngOfTileColumn(x, z),
    east: lngOfTileColumn(x + 1, z),
    north: latOfTileRow(y, z),
    south: latOfTileRow(y + 1, z)
  };
}

/**
 * The rectangle of a scene's own grid that a map tile needs, in metres, with a little margin so the
 * edges of the tile have something to sample.
 */
export function tileOnSceneGrid(z: number, x: number, y: number, grid: UtmZone, margin = 1.02): { west: number; east: number; south: number; north: number } {
  const corners = tileCorners(z, x, y);
  const points = [
    utmFromLngLat({ lat: corners.north, lng: corners.west }, grid),
    utmFromLngLat({ lat: corners.north, lng: corners.east }, grid),
    utmFromLngLat({ lat: corners.south, lng: corners.west }, grid),
    utmFromLngLat({ lat: corners.south, lng: corners.east }, grid),
    utmFromLngLat({ lat: (corners.north + corners.south) / 2, lng: (corners.west + corners.east) / 2 }, grid)
  ];
  const west = Math.min(...points.map((p) => p.x));
  const east = Math.max(...points.map((p) => p.x));
  const south = Math.min(...points.map((p) => p.y));
  const north = Math.max(...points.map((p) => p.y));
  const padX = ((east - west) * (margin - 1)) / 2;
  const padY = ((north - south) * (margin - 1)) / 2;
  return { west: west - padX, east: east + padX, south: south - padY, north: north + padY };
}

/** The place a pixel of a map tile stands on, as a position on a scene's grid. */
export function pixelToSceneGrid(z: number, x: number, y: number, px: number, py: number, tileSize: number, grid: UtmZone): { x: number; y: number } {
  const n = Math.pow(2, z);
  const lng = ((x + px / tileSize) / n) * 360 - 180;
  const lat = latOfTileRow(y + py / tileSize, z);
  return utmFromLngLat({ lat, lng }, grid);
}

/** Back the other way, for checking. */
export const sceneGridToLngLat = (point: { x: number; y: number }, grid: UtmZone) => lngLatFromUtm(point, grid);

/**
 * Sentinel-2's own classification of every pixel. The panel keeps the ground and the water and
 * throws away cloud, cloud shadow, snow and the edges of the scene, so a second pass over the same
 * ground can fill what the first one lost.
 */
export const SCENE_CLASSES = {
  noData: 0,
  saturated: 1,
  shadow: 2,
  cloudShadow: 3,
  vegetation: 4,
  bare: 5,
  water: 6,
  unclassified: 7,
  cloudMedium: 8,
  cloudHigh: 9,
  cirrus: 10,
  snow: 11
} as const;

const KEEP = new Set<number>([SCENE_CLASSES.vegetation, SCENE_CLASSES.bare, SCENE_CLASSES.water, SCENE_CLASSES.unclassified, SCENE_CLASSES.shadow]);

/** Whether a pixel of that class is worth drawing. */
export const classIsClear = (value: number): boolean => KEEP.has(value);

/** How many megabytes a build is likely to move, for telling the user before it starts. */
export function estimateBytes(tiles: number, scenes: number): number {
  // A 512 pixel overview tile of a true-colour scene runs about 400 KB, and its classification about
  // 30 KB; a map tile usually needs one or two of each, and later scenes are only read where the
  // first one was cloudy.
  const perTile = 430 * 1024;
  return Math.round(tiles * perTile * (1 + 0.35 * Math.max(0, scenes - 1)));
}
