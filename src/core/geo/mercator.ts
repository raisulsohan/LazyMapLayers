// Web Mercator helpers. World coordinates are pixels of a square world whose side is
// TILE_SIZE * 2^zoom, with x growing east from the antimeridian and y growing south from the
// northern mercator limit. This matches MapLibre GL's 512 px tile convention.

export const TILE_SIZE = 512;
export const MAX_LATITUDE = 85.051128779806604;
export const EARTH_CIRCUMFERENCE_M = 40075016.68557849;

export type LngLat = { lng: number; lat: number };
export type Point = { x: number; y: number };

const DEG = Math.PI / 180;

export function worldSize(zoom: number): number {
  return TILE_SIZE * Math.pow(2, zoom);
}

export function clampLatitude(lat: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

/** Wraps a longitude into [-180, 180). */
export function wrapLongitude(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/** Returns lng shifted by whole turns so that it is as close as possible to `reference`. */
export function unwrapLongitudeNear(lng: number, reference: number): number {
  return lng + 360 * Math.round((reference - lng) / 360);
}

/** Mercator x in [0, 1) for a longitude (unwrapped longitudes go outside that range). */
export function mercatorXFromLng(lng: number): number {
  return (180 + lng) / 360;
}

/** Mercator y in [0, 1] for a latitude, 0 at the northern limit. */
export function mercatorYFromLat(lat: number): number {
  const phi = clampLatitude(lat) * DEG;
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + phi / 2))) / 360;
}

export function lngFromMercatorX(x: number): number {
  return x * 360 - 180;
}

export function latFromMercatorY(y: number): number {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp(y2 * DEG)) - 90;
}

export function lngLatToWorld(p: LngLat, zoom: number): Point {
  const size = worldSize(zoom);
  return { x: mercatorXFromLng(p.lng) * size, y: mercatorYFromLat(p.lat) * size };
}

export function worldToLngLat(p: Point, zoom: number): LngLat {
  const size = worldSize(zoom);
  return { lng: lngFromMercatorX(p.x / size), lat: latFromMercatorY(p.y / size) };
}

/** Ground resolution in metres per world pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(clampLatitude(lat) * DEG)) / worldSize(zoom);
}
