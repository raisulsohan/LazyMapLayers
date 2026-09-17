// Slippy-map tile helpers (XYZ scheme, y down, Web Mercator).

import { clampLatitude, mercatorXFromLng, mercatorYFromLat } from "../geo/mercator.ts";

export type Bbox = { west: number; south: number; east: number; north: number };
export type TileRange = { z: number; minX: number; maxX: number; minY: number; maxY: number };

export function tileXForLng(lng: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(mercatorXFromLng(lng) * n)));
}

export function tileYForLat(lat: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(mercatorYFromLat(clampLatitude(lat)) * n)));
}

/** Tiles at zoom z that intersect the bbox (west < east; no antimeridian wrap). */
export function tileRangeForBbox(bbox: Bbox, z: number): TileRange {
  if (!(bbox.west < bbox.east) || !(bbox.south < bbox.north)) throw new Error("bbox must have west < east and south < north");
  return {
    z,
    minX: tileXForLng(bbox.west, z),
    maxX: tileXForLng(bbox.east, z),
    minY: tileYForLat(bbox.north, z),
    maxY: tileYForLat(bbox.south, z)
  };
}

export function tileCount(range: TileRange): number {
  return (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
}

export function* tilesInRange(range: TileRange): Generator<{ z: number; x: number; y: number }> {
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) yield { z: range.z, x, y };
  }
}
