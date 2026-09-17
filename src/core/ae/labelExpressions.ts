// Expressions for label, dot and route layers linked to a map (ES3: both expression engines, see
// projectionExpression.ts).

import { projectionPrelude } from "./projectionExpression.ts";

export const LABEL_MARKER = "// LazyMapLayers label";

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/** Position of a layer attached to a geographic point, offset by (dx, dy) map comp pixels. */
export function anchoredPositionExpression(lat: number, lng: number, dx: number, dy: number, marker = LABEL_MARKER): string {
  return `${marker} (generated)
var map = effect("Map")(1);
${projectionPrelude()}var p = lmlProject(${num(lat)}, ${num(lng)}, 0);
var c = map.toComp([p.x + ${num(dx)}, p.y + ${num(dy)}]);
[c[0], c[1]];`;
}

export const ROUTE_MARKER = "// LazyMapLayers route";

/**
 * A shape path through geographic points, lifted by an arc: `points` are [lat, lng, altitude m].
 * Points hidden behind the planet take the position of the nearest visible point before them (or,
 * at the start, after them), so the path never jumps across the screen; trim the path with Trim
 * Paths to draw it on.
 */
export function routePathExpression(points: number[][]): string {
  const data = JSON.stringify(points.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)));
  return `${ROUTE_MARKER} (generated)
var map = effect("Map")(1);
${projectionPrelude()}var pts = ${data};
var projected = [], first = -1, i = 0;
for (i = 0; i < pts.length; i++) {
  projected.push(lmlProject(pts[i][0], pts[i][1], pts[i][2]));
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
  if (p) last = fromComp(map.toComp([p.x, p.y]));
  out.push(last);
}
createPath(out, [], [], false);`;
}

/**
 * A callout leader: from the place, diagonally by (dx, dy) map comp pixels, then horizontally by
 * `length` (negative for a leader that runs left).
 */
export function leaderPathExpression(lat: number, lng: number, dx: number, dy: number, length: number): string {
  return `${ROUTE_MARKER} callout leader (generated)
var map = effect("Map")(1);
${projectionPrelude()}var p = lmlProject(${num(lat)}, ${num(lng)}, 0);
createPath([fromComp(map.toComp([p.x, p.y])), fromComp(map.toComp([p.x + ${num(dx)}, p.y + ${num(dy)}])), fromComp(map.toComp([p.x + ${num(dx + length)}, p.y + ${num(dy)}]))], [], [], false);`;
}
