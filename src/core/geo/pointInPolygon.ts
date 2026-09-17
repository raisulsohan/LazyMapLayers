// Point-in-polygon for areas given as GeoJSON-style multi-polygons (outer ring first, then holes),
// in degrees. Even-odd ray casting: fine for picking the province under a click.

export type Polygons = number[][][][];

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point lies inside one of the polygons and not in a hole of it. */
export function pointInPolygons(position: { lat: number; lng: number }, polygons: Polygons): boolean {
  for (const polygon of polygons) {
    if (!polygon.length || !inRing(position.lng, position.lat, polygon[0])) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length && !inHole; h++) inHole = inRing(position.lng, position.lat, polygon[h]);
    if (!inHole) return true;
  }
  return false;
}
