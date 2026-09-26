// Expressions of a chart of numbers over the years (ES3: both expression engines, see
// projectionExpression.ts). Inside the chart's precomp, time runs from the first year at 0 to the
// last at `duration`; the lines are paths that stand exactly at that year, with a dot and the value
// riding their heads. The chart's layer in the scene is time-remapped by the map's Data Time slider,
// read through a Layer Control, so the chart follows the map however the slider is keyed.

export const CHART_MARKER = "// LazyMapLayers chart";

const num = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0");
const list = (values: number[]) => `[${values.map(num).join(", ")}]`;
/**
 * A string literal in plain ASCII: a name in any script is written with backslash-u escapes, so the
 * generated expressions stay pure ASCII like the rest of them.
 */
function asciiString(text: string): string {
  const quoted = JSON.stringify(text);
  let out = "";
  for (let i = 0; i < quoted.length; i++) {
    const code = quoted.charCodeAt(i);
    out += code > 126 ? String.fromCharCode(92) + "u" + code.toString(16).padStart(4, "0") : quoted[i];
  }
  return out;
}
const pointList = (points: [number, number][]) => `[${points.map((p) => `[${num(p[0])}, ${num(p[1])}]`).join(", ")}]`;

/** The year the precomp stands at, and the points up to it (the last one between two years). */
function reach(points: [number, number][], times: number[], duration: number): string {
  const first = times[0];
  const last = times[times.length - 1];
  return `var pts = ${pointList(points)};
var yrs = ${list(times)};
var yr = ${num(first)} + Math.max(0, Math.min(1, time / ${num(duration)})) * ${num(last - first)};
var out = [pts[0]];
for (var i = 1; i < pts.length; i++) {
  if (yrs[i] <= yr) {
    out.push(pts[i]);
    continue;
  }
  var f = (yr - yrs[i - 1]) / (yrs[i] - yrs[i - 1]);
  if (f > 0) out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
  break;
}
`;
}

/**
 * The path of a line up to the precomp's year; for an area, closed down to the baseline so it can be
 * filled.
 */
export function growingLineExpression(points: [number, number][], times: number[], duration: number, area: { baseline: number } | null = null): string {
  const close = area
    ? `out.push([out[out.length - 1][0], ${num(area.baseline)}]);
out.push([out[0][0], ${num(area.baseline)}]);
createPath(out, [], [], true);`
    : `createPath(out, [], [], false);`;
  return `${CHART_MARKER} line (generated)
${reach(points, times, duration)}if (out.length < 2) out.push([out[0][0] + 0.01, out[0][1]]);
${close}`;
}

/** Where the head of a line is at the precomp's year, for the dot that rides it. */
export function lineHeadExpression(points: [number, number][], times: number[], duration: number): string {
  return `${CHART_MARKER} head (generated)
${reach(points, times, duration)}var h = out[out.length - 1];
[h[0], h[1]];`;
}

/**
 * The value a line has reached, as text: straight between the years around it, written the way the
 * legend writes numbers (thousands grouped, fewer decimals the larger it is).
 */
export function lineValueExpression(values: number[], times: number[], duration: number, prefix = ""): string {
  const first = times[0];
  const last = times[times.length - 1];
  return `${CHART_MARKER} value (generated)
var vals = ${list(values)};
var yrs = ${list(times)};
var yr = ${num(first)} + Math.max(0, Math.min(1, time / ${num(duration)})) * ${num(last - first)};
var v = vals[0];
for (var i = 1; i < vals.length; i++) {
  if (yrs[i] <= yr) {
    v = vals[i];
    continue;
  }
  v = vals[i - 1] + (vals[i] - vals[i - 1]) * ((yr - yrs[i - 1]) / (yrs[i] - yrs[i - 1]));
  break;
}
var size = Math.abs(v);
var d = 3;
if (size >= 1) d = 2;
if (size >= 10) d = 1;
if (size >= 100) d = 0;
var s = Math.abs(v).toFixed(d);
var parts = s.split(".");
var whole = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
var frac = parts.length > 1 ? parts[1].replace(/0+$/, "") : "";
${asciiString(prefix)} + (v < 0 ? "-" : "") + whole + (frac.length ? "." + frac : "");`;
}

/**
 * The time remap of the chart's layer in the scene: the map's Data Time slider, read through the
 * layer's "Map" Layer Control, turned into the precomp's time. `span` is the precomp time the lines
 * reach the last year at (its last frame), the same `duration` the lines are built with.
 */
export function chartTimeRemapExpression(times: number[], span: number): string {
  const first = times[0];
  const last = times[times.length - 1];
  return `${CHART_MARKER} time (generated)
var m = effect("Map")(1);
var t = m.effect("Data Time")(1).value;
var p = (t - ${num(first)}) / ${num(last - first)};
Math.max(0, Math.min(1, p)) * ${num(span)};`;
}

/**
 * Where the name and the number of line `index` sit: beside its head, by (dx, dy) chart pixels, and
 * clear of the labels of the lines ranked above it. Every label works out the heads of all the lines
 * at the precomp's year and places them in rank order, each at least `gap` below the one before it
 * when they would touch, so two lines that meet never write over each other.
 */
export function lineLabelExpression(allPoints: [number, number][][], index: number, times: number[], duration: number, dx: number, dy: number, gap: number): string {
  const first = times[0];
  const last = times[times.length - 1];
  return `${CHART_MARKER} label (generated)
var lines = [${allPoints.slice(0, index + 1).map(pointList).join(", ")}];
var yrs = ${list(times)};
var yr = ${num(first)} + Math.max(0, Math.min(1, time / ${num(duration)})) * ${num(last - first)};
var heads = [];
for (var n = 0; n < lines.length; n++) {
  var pts = lines[n];
  var h = pts[0];
  for (var i = 1; i < pts.length; i++) {
    if (yrs[i] <= yr) {
      h = pts[i];
      continue;
    }
    var f = (yr - yrs[i - 1]) / (yrs[i] - yrs[i - 1]);
    if (f > 0) h = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    break;
  }
  heads.push(h);
}
var placed = [];
for (var k = 0; k < heads.length; k++) {
  var y = heads[k][1];
  for (var again = 0; again < heads.length; again++) {
    var moved = false;
    for (var j = 0; j < placed.length; j++) {
      if (Math.abs(placed[j] - y) < ${num(gap)}) {
        y = placed[j] + ${num(gap)};
        moved = true;
      }
    }
    if (!moved) break;
  }
  placed.push(y);
}
[heads[${index}][0] + ${num(dx)}, placed[${index}] + ${num(dy)}];`;
}
