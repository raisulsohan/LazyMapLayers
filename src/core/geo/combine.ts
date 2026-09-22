// Putting areas together and pushing their edges out: the union of several outlines with the borders
// between them gone, an outline grown or shrunk by a distance, and a circle of a radius around a
// place. The results are ordinary polygons, so everything the panel does with an area works with
// them: the render pass, an editable shape layer, the export.

import { buffer } from "@turf/buffer";
import { featureCollection, multiPolygon, point } from "@turf/helpers";
import { union } from "@turf/union";

/** [polygon][ring][lng, lat]; ring 0 is the outline, the rest are holes. */
export type Polygons = number[][][][];

type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null | undefined;

const EARTH_RADIUS_KM = 6371.0088;

/** Rings with too few points, and polygons left with nothing, are not geometry. */
export function cleanPolygons(polygons: Polygons): Polygons {
  const out: Polygons = [];
  for (const polygon of polygons ?? []) {
    const rings = (polygon ?? []).filter((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])));
    if (rings.length) out.push(rings.map((ring) => ring.map((p) => [p[0], p[1]])));
  }
  return out;
}

const asPolygons = (geometry: Geometry): Polygons => {
  if (!geometry) return [];
  return cleanPolygons(geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : (geometry.coordinates as number[][][][]));
};

/**
 * One outline out of several: where they touch or overlap, the border between them goes. Outlines
 * that stand apart stay as separate polygons of the same area, and holes inside them are kept.
 */
export function mergeAreas(list: Polygons[]): Polygons {
  const usable = list.map(cleanPolygons).filter((polygons) => polygons.length);
  if (!usable.length) return [];
  if (usable.length === 1) return usable[0];
  const merged = union(featureCollection(usable.map((polygons) => multiPolygon(polygons))));
  return asPolygons(merged?.geometry as Geometry);
}

/**
 * The outline pushed out by `km` (or pulled in, with a negative distance). Growing joins outlines
 * that come within the distance of each other; shrinking makes parts narrower than it disappear.
 */
export function growArea(polygons: Polygons, km: number): Polygons {
  const clean = cleanPolygons(polygons);
  if (!clean.length || !Number.isFinite(km) || km === 0) return clean;
  const grown = buffer(multiPolygon(clean), km, { units: "kilometers" });
  return asPolygons(grown?.geometry as Geometry);
}

/** A circle of `km` around a place, as an area. */
export function circleAround(place: { lat: number; lng: number }, km: number, steps = 64): Polygons {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng) || !(km > 0)) return [];
  const circle = buffer(point([place.lng, place.lat]), km, { units: "kilometers", steps });
  return asPolygons(circle?.geometry as Geometry);
}

/** The area on the globe in square kilometres (holes taken off). */
export function areaKm2(polygons: Polygons): number {
  let total = 0;
  for (const polygon of cleanPolygons(polygons)) {
    polygon.forEach((ring, index) => {
      const size = Math.abs(ringArea(ring));
      total += index === 0 ? size : -size;
    });
  }
  return Math.round(total);
}

/** The signed area of one ring on the globe, in square kilometres. */
function ringArea(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const radians = Math.PI / 180;
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngA, latA] = ring[j];
    const [lngB, latB] = ring[i];
    total += (lngB - lngA) * radians * (2 + Math.sin(latA * radians) + Math.sin(latB * radians));
  }
  return (total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2;
}

/** The middle of an outline's bounding box, for framing it or naming it. */
export function centreOf(polygons: Polygons): { lat: number; lng: number } | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const polygon of cleanPolygons(polygons)) {
    for (const [lng, lat] of polygon[0]) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west)) return null;
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

/** The name a combined area gets: the names it came from, or how many there were. */
export function combinedName(names: string[]): string {
  const usable = names.map((name) => name.trim()).filter(Boolean);
  if (!usable.length) return "Combined area";
  if (usable.length <= 3) return usable.join(" + ");
  return `${usable[0]} + ${usable.length - 1} more`;
}
