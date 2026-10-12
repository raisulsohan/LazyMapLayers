// The arrow rig: a route drawn as one shape layer whose line and head belong together (ES3: both
// expression engines, see projectionExpression.ts).
//
// The line is the route's own path (routePathExpression), trimmed from Tail to Progress. The head
// rides the tip with the traveller's maths (routeRunSource), in the layer's own space, and the line
// stops a little behind the point so its edges never show past the head. Every look is a control on
// the layer, so a designer keys or changes it in After Effects without the panel.

import { routePathExpression, routeRunSource } from "./labelExpressions.ts";

export const ARROW_MARKER = "// LazyMapLayers arrow";

/** The controls on an arrow layer, in the order they are added. */
export const ARROW_EFFECTS = {
  map: "Map",
  progress: "Progress",
  tail: "Tail",
  width: "Width",
  tailWidth: "Tail Width",
  taperLength: "Taper Length",
  headSize: "Head Size",
  headStyle: "Head Style",
  bothEnds: "Both Ends",
  dash: "Dash",
  gap: "Gap",
  dashSpeed: "Dash Speed",
  outline: "Outline Width",
  color: "Color",
  outlineColor: "Outline Color"
} as const;

/** The Head Style menu; the control's value is the 1-based index. */
export const HEAD_STYLES = ["Triangle", "Chevron", "None"] as const;

/** Dash length that reads as a solid line: longer than any route on screen. */
const SOLID_DASH = 100000;

export type ArrowControls = {
  /** Line width in comp pixels at the head. */
  width: number;
  /** Width at the tail, in percent of Width. */
  tailWidth: number;
  /** How much of the line the taper runs over, in percent. */
  taperLength: number;
  headSize: number;
  /** 1 Triangle, 2 Chevron, 3 None. */
  headStyle: number;
  bothEnds: number;
  /** Dash length in comp pixels, 0 for a solid line. */
  dash: number;
  gap: number;
  /** Comp pixels a second the dashes flow towards the head. */
  dashSpeed: number;
  outline: number;
  color: number[];
  outlineColor: number[];
};

/** The controls a new arrow starts with: tapered, a triangle head, solid unless `dash` is set. */
export function defaultArrowControls(width: number, color: number[], outlineColor: number[], dash = 0): ArrowControls {
  return { width, tailWidth: 35, taperLength: 100, headSize: 100, headStyle: 1, bothEnds: 0, dash, gap: dash, dashSpeed: 0, outline: 0, color, outlineColor };
}

const fx = (name: string) => `effect(${JSON.stringify(name)})(1).value`;

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/**
 * The head's size from the controls: `lmlLen` long, `lmlHalf` wide either side, and `lmlBack`, how far
 * behind the point the line stops. A triangle hides the line where it is at least as wide as the line;
 * a chevron's stroke covers the last half width. `minLength` keeps a head on a hairline readable.
 */
function headSource(minLength: number): string {
  return `var lmlW = Math.max(0, ${fx(ARROW_EFFECTS.width)});
var lmlStyle = Math.round(${fx(ARROW_EFFECTS.headStyle)});
var lmlLen = Math.max(lmlW * 3.5, ${num(minLength)}) * Math.max(0, ${fx(ARROW_EFFECTS.headSize)}) / 100;
var lmlHalf = lmlLen * 0.55;
var lmlBack = 0;
if (lmlStyle === 1) lmlBack = Math.min(lmlLen * 0.9, lmlW);
if (lmlStyle === 2) lmlBack = Math.min(lmlLen, lmlW * 0.5);
`;
}

/** Distances along the route on screen: `d` the tip, `d0` the tail, the line from `lmlStart` to `lmlEnd`. */
const spanSource = `var lmlP = Math.min(100, Math.max(0, ${fx(ARROW_EFFECTS.progress)}));
var lmlT = Math.min(lmlP, Math.max(0, ${fx(ARROW_EFFECTS.tail)}));
var d = total * lmlP / 100, d0 = total * lmlT / 100;
var lmlBoth = ${fx(ARROW_EFFECTS.bothEnds)} > 0;
var lmlEnd = d - lmlBack, lmlStart = d0;
if (lmlBoth) lmlStart = d0 + lmlBack;
if (lmlEnd < lmlStart) lmlEnd = lmlStart;
`;

/** The direction of travel on screen at a distance, in degrees (0 is to the right). */
const angleSource = `function lmlAngle(at) {
  var w = Math.max(total * 0.004, 0.5);
  var a = lmlAt(Math.max(0, at - w)), b = lmlAt(Math.min(total, at + w));
  if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) <= 0.0001) return 0;
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}
`;

export type ArrowExpressions = {
  path: string;
  trimStart: string;
  trimEnd: string;
  headPath: string;
  headPosition: string;
  headRotation: string;
  headOpacity: string;
  tailPosition: string;
  tailRotation: string;
  tailOpacity: string;
  /** The head's fill shows for a triangle, its stroke for a chevron. */
  fillOpacity: string;
  chevronOpacity: string;
  lineWidth: string;
  outlineWidth: string;
  headOutlineWidth: string;
  outlineOpacity: string;
  taperStartWidth: string;
  taperStartLength: string;
  dash: string;
  gap: string;
  dashOffset: string;
  color: string;
  outlineColor: string;
};

/**
 * Every expression of an arrow along `points` ([lat, lng, altitude m(, ground elevation m)], the
 * route's own). `scale` is the comp height over 1080, for the smallest head.
 */
export function arrowRigExpressions(points: number[][], scale: number): ArrowExpressions {
  const run = routeRunSource(points);
  const head = headSource(12 * scale);
  const tagged = (what: string, body: string) => `${ARROW_MARKER} ${what} (generated)\n${body}`;
  const trim = (which: "lmlStart" | "lmlEnd") =>
    tagged(which === "lmlStart" ? "trim start" : "trim end", `${run}${head}${spanSource}var v = 0;
if (total > 0) v = Math.min(100, Math.max(0, ${which} / total * 100));
v;`);
  const end = (atTip: boolean) => {
    const at = atTip ? "d" : "d0";
    return {
      position: tagged(atTip ? "head position" : "tail head position", `${run}${head}${spanSource}lmlFromComp(lmlAt(${at}));`),
      rotation: tagged(atTip ? "head rotation" : "tail head rotation", `${run}${head}${spanSource}${angleSource}lmlAngle(${at})${atTip ? "" : " + 180"};`),
      opacity: tagged(
        atTip ? "head opacity" : "tail head opacity",
        `${run}${head}${spanSource}var o = 0;
if (first >= 0 && lmlStyle !== 3 && lmlLen > 0${atTip ? "" : " && lmlBoth"}) o = value * Math.min(1, Math.max(0, (d - d0) / lmlLen));
o;`
      )
    };
  };
  const tip = end(true);
  const tail = end(false);
  return {
    path: routePathExpression(points, { marker: ARROW_MARKER }),
    trimStart: trim("lmlStart"),
    trimEnd: trim("lmlEnd"),
    headPath: tagged(
      "head shape",
      `${head}var lmlShape = [[0, 0], [-lmlLen, -lmlHalf], [-lmlLen, lmlHalf]];
var lmlClosed = true;
if (lmlStyle === 2) {
  lmlShape = [[-lmlLen, -lmlHalf], [0, 0], [-lmlLen, lmlHalf]];
  lmlClosed = false;
}
createPath(lmlShape, [], [], lmlClosed);`
    ),
    headPosition: tip.position,
    headRotation: tip.rotation,
    headOpacity: tip.opacity,
    tailPosition: tail.position,
    tailRotation: tail.rotation,
    tailOpacity: tail.opacity,
    fillOpacity: tagged("head fill", `var o = 0;\nif (Math.round(${fx(ARROW_EFFECTS.headStyle)}) === 1) o = 100;\no;`),
    chevronOpacity: tagged("chevron", `var o = 0;\nif (Math.round(${fx(ARROW_EFFECTS.headStyle)}) === 2) o = 100;\no;`),
    lineWidth: tagged("width", `Math.max(0, ${fx(ARROW_EFFECTS.width)});`),
    outlineWidth: tagged("outline width", `Math.max(0, ${fx(ARROW_EFFECTS.width)}) + 2 * Math.max(0, ${fx(ARROW_EFFECTS.outline)});`),
    headOutlineWidth: tagged(
      "head outline width",
      `var lmlO = 2 * Math.max(0, ${fx(ARROW_EFFECTS.outline)});
if (Math.round(${fx(ARROW_EFFECTS.headStyle)}) === 2) lmlO = lmlO + Math.max(0, ${fx(ARROW_EFFECTS.width)});
lmlO;`
    ),
    outlineOpacity: tagged("outline", `var o = 0;\nif (${fx(ARROW_EFFECTS.outline)} > 0) o = 100;\no;`),
    taperStartWidth: tagged("tail width", `Math.min(100, Math.max(0, ${fx(ARROW_EFFECTS.tailWidth)}));`),
    taperStartLength: tagged("taper length", `Math.min(100, Math.max(0, ${fx(ARROW_EFFECTS.taperLength)}));`),
    dash: tagged("dash", `var lmlD = ${fx(ARROW_EFFECTS.dash)};\nif (!(lmlD > 0)) lmlD = ${SOLID_DASH};\nlmlD;`),
    gap: tagged("gap", `var lmlG = 0;\nif (${fx(ARROW_EFFECTS.dash)} > 0) lmlG = Math.max(0, ${fx(ARROW_EFFECTS.gap)});\nlmlG;`),
    dashOffset: tagged("dash flow", `-time * ${fx(ARROW_EFFECTS.dashSpeed)};`),
    color: tagged("color", `${fx(ARROW_EFFECTS.color)};`),
    outlineColor: tagged("outline color", `${fx(ARROW_EFFECTS.outlineColor)};`)
  };
}
