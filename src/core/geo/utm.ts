// Universal Transverse Mercator, the grid satellite scenes are delivered on.
//
// A Sentinel-2 scene is a picture in one UTM zone, so turning a place on the map into a pixel of that
// picture means going through this. The series below is the usual one for a transverse Mercator on
// the WGS84 ellipsoid, good to a millimetre inside a zone, which is far finer than a 10 m pixel.

export type LngLat = { lat: number; lng: number };
export type UtmPoint = { x: number; y: number };
export type UtmZone = { zone: number; north: boolean };

const DEG = Math.PI / 180;

/** WGS84. */
const A = 6378137.0;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING = 10000000;

const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
/** The rectifying radius: the scale that turns the series below into metres. */
const RECTIFYING = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);

/** Krüger series, forwards (geodetic to grid) and backwards (grid to geodetic). */
const ALPHA = [N / 2 - (2 / 3) * N2 + (5 / 16) * N3, (13 / 48) * N2 - (3 / 5) * N3, (61 / 240) * N3];
const BETA = [N / 2 - (2 / 3) * N2 + (37 / 96) * N3, (1 / 48) * N2 + (1 / 15) * N3, (17 / 480) * N3];
const DELTA = [2 * N - (2 / 3) * N2 - 2 * N3, (7 / 3) * N2 - (8 / 5) * N3, (56 / 15) * N3];

/** The zone a longitude falls in, 1 to 60. A scene may use its neighbour's, so prefer what it says. */
export const zoneOfLongitude = (lng: number): number => Math.min(60, Math.max(1, Math.floor(((((lng + 180) % 360) + 360) % 360) / 6) + 1));

/** The middle meridian of a zone. */
export const centralMeridian = (zone: number): number => (zone - 1) * 6 - 180 + 3;

/**
 * The zone an EPSG code stands for: 32601 to 32660 are the northern WGS84 zones, 32701 to 32760 the
 * southern ones. Anything else is not a UTM grid this can work on.
 */
export function zoneOfEpsg(epsg: number): UtmZone | null {
  if (!Number.isFinite(epsg)) return null;
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, north: true };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, north: false };
  return null;
}

/** A place on the ellipsoid as metres east and north on a zone's grid. */
export function utmFromLngLat(place: LngLat, grid: UtmZone): UtmPoint {
  const lat = place.lat * DEG;
  const lng = (place.lng - centralMeridian(grid.zone)) * DEG;
  const sinLat = Math.sin(lat);
  // Conformal latitude, by way of the isometric one.
  const t = Math.sinh(Math.atanh(sinLat) - ((2 * Math.sqrt(N)) / (1 + N)) * Math.atanh(((2 * Math.sqrt(N)) / (1 + N)) * sinLat));
  const xi = Math.atan2(t, Math.cos(lng));
  const eta = Math.atanh(Math.sin(lng) / Math.sqrt(1 + t * t));
  let east = eta;
  let north = xi;
  for (let j = 1; j <= 3; j++) {
    east += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    north += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return {
    x: K0 * RECTIFYING * east + FALSE_EASTING,
    y: K0 * RECTIFYING * north + (grid.north ? 0 : FALSE_NORTHING)
  };
}

/** Metres east and north on a zone's grid, back to a place on the ellipsoid. */
export function lngLatFromUtm(point: UtmPoint, grid: UtmZone): LngLat {
  const east = (point.x - FALSE_EASTING) / (K0 * RECTIFYING);
  const north = (point.y - (grid.north ? 0 : FALSE_NORTHING)) / (K0 * RECTIFYING);
  let xi = north;
  let eta = east;
  for (let j = 1; j <= 3; j++) {
    xi -= BETA[j - 1] * Math.sin(2 * j * north) * Math.cosh(2 * j * east);
    eta -= BETA[j - 1] * Math.cos(2 * j * north) * Math.sinh(2 * j * east);
  }
  const conformal = Math.asin(Math.max(-1, Math.min(1, Math.sin(xi) / Math.cosh(eta))));
  let lat = conformal;
  for (let j = 1; j <= 3; j++) lat += DELTA[j - 1] * Math.sin(2 * j * conformal);
  return {
    lat: lat / DEG,
    lng: centralMeridian(grid.zone) + Math.atan2(Math.sinh(eta), Math.cos(xi)) / DEG
  };
}
