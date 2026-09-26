// Expressions for label, dot and route layers linked to a map (ES3: both expression engines, see
// projectionExpression.ts).

import { compTransformSource, projectionPrelude } from "./projectionExpression.ts";

export const LABEL_MARKER = "// LazyMapLayers label";

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/** Position of a layer attached to a geographic point (at `elevation` metres on 3D terrain), offset by (dx, dy) map comp pixels. */
export function anchoredPositionExpression(lat: number, lng: number, dx: number, dy: number, marker = LABEL_MARKER, elevation = 0): string {
  return `${marker} (generated)
var map = effect("Map")(1);
${projectionPrelude()}var p = lmlProject(${num(lat)}, ${num(lng)}, lmlGround(${num(elevation)}));
var c = map.toComp([p.x + ${num(dx)}, p.y + ${num(dy)}]);
[c[0], c[1]];`;
}

/**
 * A street's name, laid along the street: `from` and `to` are two points of the street either side of
 * the name's place. The name turns with the street as the map turns and tilts, stays upright (it
 * flips rather than read upside down), and its baseline offset `dy` turns with it, so the text stays
 * centred on the street at any angle.
 */
export function streetLabelExpressions(lat: number, lng: number, from: { lat: number; lng: number }, to: { lat: number; lng: number }, dy: number, elevation = 0): { position: string; rotation: string } {
  const angle = `var a = lmlProject(${num(from.lat)}, ${num(from.lng)}, lmlGround(${num(elevation)}));
var b = lmlProject(${num(to.lat)}, ${num(to.lng)}, lmlGround(${num(elevation)}));
var ca = map.toComp([a.x, a.y]);
var cb = map.toComp([b.x, b.y]);
var deg = Math.atan2(cb[1] - ca[1], cb[0] - ca[0]) * 180 / Math.PI;
if (deg > 90) deg -= 180;
if (deg < -90) deg += 180;
`;
  return {
    position: `${LABEL_MARKER} street (generated)
var map = effect("Map")(1);
${projectionPrelude()}${angle}var p = lmlProject(${num(lat)}, ${num(lng)}, lmlGround(${num(elevation)}));
var c = map.toComp([p.x, p.y]);
var r = deg * Math.PI / 180;
[c[0] - Math.sin(r) * ${num(dy)}, c[1] + Math.cos(r) * ${num(dy)}];`,
    rotation: `${LABEL_MARKER} street angle (generated)
var map = effect("Map")(1);
${projectionPrelude()}${angle}deg;`
  };
}

/** The stretch of a street or a river a name is written along: [lat, lng] points, the name's place at `mid`. */
export type LabelPath = { points: number[][]; mid: number };

/**
 * The mask path a street's or a river's name is set on (text on a path), so the name bends with
 * its line. Every frame the stretch is projected, cut to the same length on screen either side of the
 * name's place (so the centred name stays on its place under any tilt; a side that runs out goes on
 * straight), turned round when it would read right to left (the same test as the straight name,
 * over `from` and `to`), moved off the line by `dy` along its normal so the letters sit centred
 * on it, and smoothed into a curve.
 */
export function curvedLabelPathExpression(path: LabelPath, from: { lat: number; lng: number }, to: { lat: number; lng: number }, dy: number, elevation = 0, minHalf = 40): string {
  const data = JSON.stringify(path.points.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]));
  return `${LABEL_MARKER} path (generated)
var map = effect("Map")(1);
${projectionPrelude()}var g = lmlGround(${num(elevation)});
var pts = ${data};
var mid = ${Math.max(0, Math.min(path.points.length - 1, Math.round(path.mid)))};
var c = [], i = 0, p = null;
for (i = 0; i < pts.length; i++) {
  p = lmlProject(pts[i][0], pts[i][1], g);
  c.push(map.toComp([p.x, p.y]));
}
var dist = function (a, b) { return Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])); };
var back = 0, fwd = 0;
for (i = mid; i > 0; i--) back += dist(c[i], c[i - 1]);
for (i = mid; i < c.length - 1; i++) fwd += dist(c[i], c[i + 1]);
var half = Math.max(Math.min(back, fwd), ${num(minHalf)});
var walk = function (step) {
  var out = [], left = half, at = mid, here = c[mid], next = null, d = 0, k = 0;
  while (left > 0) {
    if (at + step < 0 || at + step >= c.length) {
      var prev = c[at - step];
      if (!prev) prev = here;
      d = dist(prev, c[at]);
      if (d < 1e-6) break;
      out.push([here[0] + (c[at][0] - prev[0]) / d * left, here[1] + (c[at][1] - prev[1]) / d * left]);
      break;
    }
    next = c[at + step];
    d = dist(here, next);
    if (d >= left) {
      k = left / d;
      out.push([here[0] + (next[0] - here[0]) * k, here[1] + (next[1] - here[1]) * k]);
      break;
    }
    out.push(next);
    left -= d;
    here = next;
    at += step;
  }
  return out;
};
var before = walk(-1), after = walk(1), line = [];
for (i = before.length - 1; i >= 0; i--) line.push(before[i]);
line.push(c[mid]);
for (i = 0; i < after.length; i++) line.push(after[i]);
var a = lmlProject(${num(from.lat)}, ${num(from.lng)}, g);
var b = lmlProject(${num(to.lat)}, ${num(to.lng)}, g);
if (map.toComp([b.x, b.y])[0] < map.toComp([a.x, a.y])[0]) line.reverse();
var n = line.length, pts2 = [], ins = [], outs = [];
for (i = 0; i < n; i++) {
  var u = line[Math.min(n - 1, i + 1)], w = line[Math.max(0, i - 1)];
  var l = dist(w, u);
  if (l < 1e-6) l = 1;
  pts2.push(fromComp([line[i][0] - (u[1] - w[1]) / l * ${num(dy)}, line[i][1] + (u[0] - w[0]) / l * ${num(dy)}]));
}
for (i = 0; i < n; i++) {
  if (i === 0 || i === n - 1) {
    ins.push([0, 0]);
    outs.push([0, 0]);
  } else {
    ins.push([(pts2[i - 1][0] - pts2[i + 1][0]) / 6, (pts2[i - 1][1] - pts2[i + 1][1]) / 6]);
    outs.push([(pts2[i + 1][0] - pts2[i - 1][0]) / 6, (pts2[i + 1][1] - pts2[i - 1][1]) / 6]);
  }
}
createPath(pts2, ins, outs, false);`;
}

export const ROUTE_MARKER = "// LazyMapLayers route";

/**
 * A shape path through geographic points, lifted by an arc: `points` are [lat, lng, altitude m] or
 * [lat, lng, altitude m, ground elevation m] (the elevation follows the map's 3D terrain).
 * Points hidden behind the planet take the position of the nearest visible point before them (or,
 * at the start, after them), so the path never jumps across the screen; trim the path with Trim
 * Paths to draw it on.
 */
export function routePathExpression(points: number[][], options: { closed?: boolean; marker?: string } = {}): string {
  const data = JSON.stringify(points.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)));
  return `${options.marker ?? ROUTE_MARKER} (generated)
var map = effect("Map")(1);
${projectionPrelude()}${compTransformSource()}var pts = ${data};
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
createPath(out, [], [], ${options.closed ? "true" : "false"});`;
}

/**
 * A callout leader: from the place, diagonally by (dx, dy) map comp pixels, then horizontally by
 * `length` (negative for a leader that runs left).
 */
export function leaderPathExpression(lat: number, lng: number, dx: number, dy: number, length: number, elevation = 0): string {
  return `${ROUTE_MARKER} callout leader (generated)
var map = effect("Map")(1);
${projectionPrelude()}var p = lmlProject(${num(lat)}, ${num(lng)}, lmlGround(${num(elevation)}));
createPath([fromComp(map.toComp([p.x, p.y])), fromComp(map.toComp([p.x + ${num(dx)}, p.y + ${num(dy)}])), fromComp(map.toComp([p.x + ${num(dx + length)}, p.y + ${num(dy)}]))], [], [], false);`;
}

export const TRAVELLER_MARKER = "// LazyMapLayers traveller";

export const TRAVELLER_EFFECTS = { map: "Map", progress: "Progress", rotate: "Rotate along Route" } as const;

/**
 * A layer that travels along a route: position, rotation and opacity expressions driven by a
 * "Progress" slider. `points` are [lat, lng, altitude m(, ground elevation m)], the same ones the route's path uses.
 *
 * Progress counts along the route as it is drawn on screen in that frame, exactly like Trim Paths
 * counts along the route layer's path: with the same keys the traveller rides the tip of the line,
 * under any camera. The rotation follows the direction of travel on screen while "Rotate along Route"
 * is on (artwork that points to the right faces forward), and the layer hides while the whole route is
 * behind the globe.
 */
export function travellerExpressions(points: number[][]): { position: string; rotation: string; opacity: string } {
  const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  const data = JSON.stringify(points.map((p) => (p.length > 3 ? [round(p[0], 6), round(p[1], 6), round(p[2] ?? 0, 1), round(p[3], 1)] : [round(p[0], 6), round(p[1], 6), round(p[2] ?? 0, 1)])));
  // The same polyline as routePathExpression builds (hidden points collapse onto visible neighbours),
  // in comp pixels, with its running length.
  const path = `var map = effect(${JSON.stringify(TRAVELLER_EFFECTS.map)})(1);
${projectionPrelude()}${compTransformSource({ fromComp: false })}var pts = ${data};
var projected = [], first = -1, i = 0;
for (i = 0; i < pts.length; i++) {
  projected.push(lmlProject(pts[i][0], pts[i][1], pts[i][2] + lmlGround(pts[i][3])));
  if (first < 0 && projected[i].visible) first = i;
}
var line = [], run = [0], last = null, p = null;
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
  if (p) last = lmlToComp([p.x, p.y]);
  line.push(last);
  if (i > 0) run.push(run[i - 1] + Math.sqrt((line[i][0] - line[i - 1][0]) * (line[i][0] - line[i - 1][0]) + (line[i][1] - line[i - 1][1]) * (line[i][1] - line[i - 1][1])));
}
var total = run[run.length - 1];
function lmlAt(d) {
  if (d <= 0 || total <= 0) return line[0];
  if (d >= total) return line[line.length - 1];
  var lo = 0, hi = run.length - 1, mid = 0;
  while (hi - lo > 1) {
    mid = Math.floor((lo + hi) / 2);
    if (run[mid] <= d) lo = mid;
    else hi = mid;
  }
  var span = run[hi] - run[lo], t = 0;
  if (span > 0) t = (d - run[lo]) / span;
  return [line[lo][0] + (line[hi][0] - line[lo][0]) * t, line[lo][1] + (line[hi][1] - line[lo][1]) * t];
}
var d = total * effect(${JSON.stringify(TRAVELLER_EFFECTS.progress)})(1).value / 100;
`;
  return {
    position: `${TRAVELLER_MARKER} position (generated)
${path}var c = lmlAt(d);
[c[0], c[1]];`,
    rotation: `${TRAVELLER_MARKER} rotation (generated)
${path}var w = Math.max(total * 0.004, 0.5);
var a = lmlAt(Math.max(0, d - w)), b = lmlAt(Math.min(total, d + w));
var r = value;
if (effect(${JSON.stringify(TRAVELLER_EFFECTS.rotate)})(1).value > 0 && Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 0.0001) {
  r = value + Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}
r;`,
    opacity: `${TRAVELLER_MARKER} opacity (generated)
${path}var o = value;
if (first < 0) o = 0;
o;`
  };
}
