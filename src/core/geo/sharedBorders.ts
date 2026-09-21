// Thins the polygons of neighbouring areas (a country's provinces or districts) together, as one
// topology: a border between two neighbours is one arc that is simplified once, so both keep exactly
// the same border and two highlighted neighbours never show a gap or an overlap.

import { feature } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";

type AreaGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
type AreaFeature = GeoJSON.Feature<AreaGeometry>;

/** Polygons as [polygon][ring][lng, lat], rounded to about 10 m; rings that collapsed are dropped. */
export function toPolygons(geometry: AreaGeometry): number[][][][] {
  if (!geometry) return [];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return polygons.map((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => [round(lng), round(lat)])).filter((ring) => ring.length >= 4)).filter((polygon) => polygon.length > 0);
}

export function countPoints(geometry: AreaGeometry): number {
  if (!geometry) return 0;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0);
}

/**
 * The features' polygons within a budget of `pointsPerFeature` points on average, in the features'
 * order (an empty list for a feature that has no area left). Already light input comes back as it is.
 */
export function simplifyTogether(features: AreaFeature[], pointsPerFeature: number): number[][][][][] {
  const total = features.reduce((n, f) => n + countPoints(f.geometry), 0);
  const target = Math.max(60, features.length * pointsPerFeature);
  let light: AreaFeature[] = features;
  if (total > target) {
    const topo = presimplify(topology({ areas: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection }, 1e6));
    // The share of points to keep, tightened until the set fits its budget.
    let keep = Math.min(1, target / total);
    for (let round = 0; round < 8; round++) {
      // topojson sorts weights from the most to the least important: quantile(p) keeps the share p.
      const simplified = simplify(topo, quantile(topo, keep));
      light = (feature(simplified, simplified.objects.areas) as GeoJSON.FeatureCollection).features as AreaFeature[];
      const now = light.reduce((n, f) => n + countPoints(f.geometry), 0);
      if (now <= target * 1.15) break;
      keep *= (target / now) * 0.95;
    }
  }
  return features.map((_, i) => toPolygons(light[i]?.geometry ?? null));
}

/** Ground area of a ring, in square degrees at the equator (the shoelace area, narrowed towards the poles). */
export function ringArea(ring: number[][]): number {
  let twice = 0;
  let lat = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    lat += ring[i][1];
  }
  return Math.abs(twice / 2) * Math.cos(((lat / Math.max(1, ring.length)) * Math.PI) / 180);
}

/**
 * One feature's polygons for a shape layer: the largest polygons within a budget of rings (one path
 * each in After Effects), thinned to a budget of points. Points go by the area they cover, so a
 * crenulated coastline loses its detail evenly instead of keeping the tip of every fjord as a spike,
 * and islands too small to matter disappear rather than becoming triangles.
 */
export function simplifyFeature(polygons: number[][][][], maxPoints: number, maxRings = 40): number[][][][] {
  const usable = polygons.filter((polygon) => polygon.length && polygon[0].length >= 4);
  if (!usable.length) return [];
  const largest = usable
    .map((polygon) => ({ polygon, area: ringArea(polygon[0]) }))
    .sort((a, b) => b.area - a.area);
  const kept: number[][][][] = [];
  let rings = 0;
  for (const entry of largest) {
    if (kept.length && rings + entry.polygon.length > maxRings) break;
    kept.push(entry.polygon);
    rings += entry.polygon.length;
  }
  const total = kept.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0);
  if (total <= maxPoints) return kept;
  const feature: AreaFeature = { type: "Feature", properties: null, geometry: { type: "MultiPolygon", coordinates: kept } };
  return simplifyTogether([feature], maxPoints)[0] ?? [];
}
