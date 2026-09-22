// A map feature (a country, a province, a district, an area of your own) as an editable After Effects
// shape layer: one closed path per ring, each projected by the same camera maths as pins and routes,
// so the outline sits on the rendered map at every frame. Fill and stroke are ordinary shape layer
// properties, so the layer can be styled and animated in After Effects like any other.

import { routePathExpression } from "./labelExpressions.ts";
import { compTransformSource, projectionPrelude } from "./projectionExpression.ts";

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

/** Points the fine level of a shape layer keeps: only projected while the map is zoomed in. */
export const SHAPE_FINE_POINTS = 3600;
/** Below this zoom the coarse outline draws; from it on, the fine one. */
export const SHAPE_DETAIL_ZOOM = 5.5;

const num = (value: number) => (Number.isFinite(value) ? String(value) : "0");

/**
 * A closed path with two levels of detail: the coarse points while the map is zoomed out, the
 * fine points once it is zoomed in past `switchZoom`. Only the level in use is projected, so the
 * fine outline costs nothing at world zooms, and the coarse points are a subset of the fine ones, so
 * the outline gains vertices at the switch and never jumps.
 */
export function lodPathExpression(coarse: number[][], fine: number[][], switchZoom = SHAPE_DETAIL_ZOOM, marker = SHAPE_MARKER): string {
  const bake = (points: number[][]) => JSON.stringify(points.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)));
  return `${marker} (generated, two levels of detail)
var map = effect("Map")(1);
${projectionPrelude()}${compTransformSource()}var coarse = ${bake(coarse)};
var fine = ${bake(fine)};
var pts = coarse;
if (lmlView.zoom >= ${num(switchZoom)}) pts = fine;
var projected = [], first = -1, i = 0;
for (i = 0; i < pts.length; i++) {
  projected.push(lmlProject(pts[i][0], pts[i][1], pts[i][2] + lmlGround(pts[i][3])));
  if (first < 0 && projected[i].visible) first = i;
}
var out = [], last = null, p = null;
for (i = 0; i < pts.length; i++) {
  if (first < 0) {
    p = projected[0];
  } else if (projected[i].visible) {
    p = projected[i];
  } else if (last === null) {
    p = projected[first];
  } else {
    p = null;
  }
  if (p) last = lmlFromComp(lmlToComp([p.x, p.y]));
  out.push(last);
}
createPath(out, [], [], true);`;
}

/**
 * The path expressions of a shape layer with two levels: one per ring, pairing the coarse and the
 * fine rings by their order. Rings the two levels do not share fall back to their coarse points.
 */
export function shapeLevelExpressions(coarseRings: number[][][], fineRings: number[][][], switchZoom = SHAPE_DETAIL_ZOOM): string[] {
  return coarseRings.map((ring, index) => {
    const fine = fineRings[index];
    return fine && fine.length > ring.length ? lodPathExpression(ring, fine, switchZoom) : routePathExpression(ring, { closed: true, marker: SHAPE_MARKER });
  });
}
