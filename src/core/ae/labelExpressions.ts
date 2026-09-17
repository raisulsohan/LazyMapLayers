// Expressions for label, dot and route layers linked to a map (see projectionExpression.ts).

import { projectionPrelude } from "./projectionExpression.ts";

export const LABEL_MARKER = "// LazyMapLayers label";

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/** Position of a layer attached to a geographic point, offset by (dx, dy) map comp pixels. */
export function anchoredPositionExpression(lat: number, lng: number, dx: number, dy: number, marker = LABEL_MARKER): string {
  return `${marker} (generated)
const map = effect("Map")(1);
${projectionPrelude()}const p = lmlProject(${num(lat)}, ${num(lng)}, 0);
const c = map.toComp([p.x + ${num(dx)}, p.y + ${num(dy)}]);
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
const map = effect("Map")(1);
${projectionPrelude()}const pts = ${data};
const projected = pts.map((q) => lmlProject(q[0], q[1], q[2]));
const first = projected.findIndex((p) => p.visible);
const out = [];
let last = null;
for (let i = 0; i < pts.length; i++) {
  const p = first < 0 ? projected[0] : projected[i].visible ? projected[i] : last === null ? projected[first] : null;
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
const map = effect("Map")(1);
${projectionPrelude()}const p = lmlProject(${num(lat)}, ${num(lng)}, 0);
createPath([fromComp(map.toComp([p.x, p.y])), fromComp(map.toComp([p.x + ${num(dx)}, p.y + ${num(dy)}])), fromComp(map.toComp([p.x + ${num(dx + length)}, p.y + ${num(dy)}]))], [], [], false);`;
}
