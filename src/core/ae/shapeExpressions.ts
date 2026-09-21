// A map feature (a country, a province, a district, an area of your own) as an editable After Effects
// shape layer: one closed path per ring, each projected by the same camera maths as pins and routes,
// so the outline sits on the rendered map at every frame. Fill and stroke are ordinary shape layer
// properties, so the layer can be styled and animated in After Effects like any other.

import { routePathExpression } from "./labelExpressions.ts";

export const SHAPE_MARKER = "// LazyMapLayers shape";

export const SHAPE_EFFECTS = { map: "Map" } as const;

/** Points a shape layer keeps across all its rings: every one is projected on every frame. */
export const SHAPE_MAX_POINTS = 900;

/** Paths a shape layer may hold: every ring is its own path with its own expression. */
export const SHAPE_MAX_RINGS = 40;

/**
 * The rings of polygons ([polygon][ring][lng, lat]) as point arrays for the path expressions:
 * [lat, lng, altitude m, ground elevation m]. GeoJSON repeats a ring's first point at its end; After
 * Effects closes the path itself, so that repeat is dropped. Rings with fewer than three points go.
 */
export function shapeRings(polygons: number[][][][], groundAt?: (lng: number, lat: number) => number): number[][][] {
  const rings: number[][][] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = ring.slice();
      const first = points[0];
      const last = points[points.length - 1];
      if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) points.pop();
      if (points.length < 3) continue;
      rings.push(points.map(([lng, lat]) => [lat, lng, 0, groundAt ? groundAt(lng, lat) : 0]));
      if (rings.length >= SHAPE_MAX_RINGS) return rings;
    }
  }
  return rings;
}

/** One closed path expression per ring. */
export function shapePathExpressions(rings: number[][][]): string[] {
  return rings.map((ring) => routePathExpression(ring, { closed: true, marker: SHAPE_MARKER }));
}
