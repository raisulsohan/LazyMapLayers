// The small things a finished map carries: a scale bar that says how far a screen distance really is,
// and a north arrow that turns with the map. Both read the map layer's own controls through
// expressions, so they follow every camera keyframe without a re-render, and both stay right when the
// map layer is moved, scaled or rotated in the scene.

import { EARTH_CIRCUMFERENCE_M, MAX_LATITUDE, TILE_SIZE } from "../geo/mercator.ts";
import { compTransformSource, projectionPrelude } from "./projectionExpression.ts";

export const SCALE_BAR_MARKER = "// LazyMapLayers scale bar";
export const NORTH_MARKER = "// LazyMapLayers north arrow";

/** How long the bar may grow, in comp pixels at 1080p; the real length rounds down from here. */
export const DEFAULT_BAR_LENGTH = 240;

export type ScaleUnits = "metric" | "imperial";

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/**
 * lmlMetres: metres in one comp pixel at the map's centre.
 *
 * The map is rendered at one world pixel per comp pixel, so the ground resolution at the centre is the
 * plain Mercator one. The last two lines carry that through the map layer's own transform, so a map
 * the user has scaled down still gets a bar that tells the truth.
 */
function metresPerPixelSource(): string {
  return `var lmlMetres = (function () {
  var css = ${num(EARTH_CIRCUMFERENCE_M)} * Math.cos(lmlView.lat * Math.PI / 180) / (${num(TILE_SIZE)} * Math.pow(2, lmlView.zoom));
  var a = map.toComp([0, 0]), b = map.toComp([256, 0]);
  var per = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])) / 256;
  if (!(per > 1e-9)) per = 1;
  return css * (thisComp.width / map.source.width) / per;
})();
`;
}

/**
 * lmlBar: the bar's rounded distance, as { pixels, text }.
 *
 * The distance is the roundest one (1, 2 or 5 times a power of ten) that fits inside `maxPixels`, in
 * metres and kilometres or in feet and miles, and the bar's length follows from it.
 */
function barSource(maxPixels: number, units: ScaleUnits): string {
  const imperial = units === "imperial";
  const base = imperial ? 3.280839895013123 : 1;
  const big = imperial ? 5280 : 1000;
  const bigName = imperial ? "mi" : "km";
  const smallName = imperial ? "ft" : "m";
  return `var lmlBar = (function () {
  var most = ${num(maxPixels)} * lmlMetres * ${num(base)};
  if (!(most > 0)) most = 1;
  var far = most >= ${num(big)};
  var per = far ? ${num(big)} : 1;
  var x = most / per;
  var step = Math.pow(10, Math.floor(Math.log(x) / Math.LN10));
  var nice = step;
  if (x / step >= 5) nice = step * 5;
  else if (x / step >= 2) nice = step * 2;
  var shown = nice >= 1 ? String(Math.round(nice)) : String(Math.round(nice * 100) / 100);
  return { pixels: nice * per / (lmlMetres * ${num(base)}), text: shown + " " + (far ? "${bigName}" : "${smallName}") };
})();
`;
}

function scalePrelude(maxPixels: number, units: ScaleUnits): string {
  return `var map = effect("Map")(1);
${projectionPrelude()}${metresPerPixelSource()}${barSource(maxPixels, units)}`;
}

/**
 * The bar itself, as a path: a bracket that runs from the layer's anchor to the right, with a tick
 * turned up at each end. The path is remeasured every frame, so the bar keeps a round distance while
 * the camera zooms.
 */
export function scaleBarPathExpression(maxPixels: number, units: ScaleUnits, tick: number, marker = SCALE_BAR_MARKER): string {
  return `${marker} (generated)
${scalePrelude(maxPixels, units)}var w = Math.max(1, lmlBar.pixels);
var t = ${num(tick)};
createPath([[0, -t], [0, 0], [w, 0], [w, -t]], [], [], false);`;
}

/** What the bar says: the same rounded distance, written with its unit. */
export function scaleBarTextExpression(maxPixels: number, units: ScaleUnits, marker = SCALE_BAR_MARKER): string {
  return `${marker} (generated)
${scalePrelude(maxPixels, units)}lmlBar.text;`;
}

/**
 * The turn of a north arrow, in degrees: the angle north makes on the screen at the map's centre. It
 * comes from projecting two points a hair apart, so it holds on the globe, where the poles bend north
 * away from straight up, and it follows the map layer's own rotation.
 */
export function northRotationExpression(marker = NORTH_MARKER): string {
  return `${marker} (generated)
var map = effect("Map")(1);
${projectionPrelude()}${compTransformSource({ fromComp: false })}var lmlTurn = -lmlView.bearing;
var lmlUp = lmlView.lat + 0.01, lmlFrom = lmlView.lat;
if (lmlUp > 89.9) { lmlUp = 89.9; lmlFrom = 89.89; }
var lmlA = lmlProject(lmlFrom, lmlView.lng, 0);
var lmlB = lmlProject(lmlUp, lmlView.lng, 0);
if (lmlA.visible && lmlB.visible) {
  var lmlP = lmlToComp([lmlA.x, lmlA.y]);
  var lmlQ = lmlToComp([lmlB.x, lmlB.y]);
  var lmlDx = lmlQ[0] - lmlP[0], lmlDy = lmlP[1] - lmlQ[1];
  if (lmlDx * lmlDx + lmlDy * lmlDy > 1e-12) lmlTurn = Math.atan2(lmlDx, lmlDy) * 180 / Math.PI;
}
lmlTurn;`;
}

export const MINIMAP_MARKER = "// LazyMapLayers minimap box";

/** How many points each edge of the box is drawn with, so it bends with the inset's projection. */
export const BOX_SAMPLES = 8;

/**
 * The box on an inset map that says where the big map is looking.
 *
 * The layer carries two links: "Map" is the inset it is drawn on, "Main map" is the map it follows.
 * The big map's frame is turned into mercator coordinates from its own centre, zoom and bearing, and
 * every point of it is projected through the inset, so the box turns when the map turns and bends
 * when the inset is a globe. A pitched map is shown by its flat footprint.
 */
export function minimapBoxExpression(samples = BOX_SAMPLES, marker = MINIMAP_MARKER): string {
  const steps = Math.max(1, Math.round(samples));
  return `${marker} (generated)
var map = effect("Map")(1);
var main = effect("Main map")(1);
${projectionPrelude()}${compTransformSource()}var lmlMain = { lat: main.effect("Latitude")(1).value, lng: main.effect("Longitude")(1).value, zoom: main.effect("Zoom")(1).value, bearing: main.effect("Bearing")(1).value };
var lmlSize = ${num(TILE_SIZE)} * Math.pow(2, lmlMain.zoom);
var lmlHx = main.source.width / 2 / lmlSize, lmlHy = main.source.height / 2 / lmlSize;
var lmlCx = (180 + lmlMain.lng) / 360;
var lmlCy = (function () {
  var c = Math.max(-${num(MAX_LATITUDE)}, Math.min(${num(MAX_LATITUDE)}, lmlMain.lat));
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + c * (Math.PI / 180) / 2))) / 360;
})();
var lmlCb = Math.cos(lmlMain.bearing * Math.PI / 180), lmlSb = Math.sin(lmlMain.bearing * Math.PI / 180);
var lmlEdges = [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]];
var lmlOut = [];
for (var lmlE = 0; lmlE < 4; lmlE++) {
  for (var lmlS = 0; lmlS < ${steps}; lmlS++) {
    var lmlT = lmlS / ${steps};
    var lmlU = lmlEdges[lmlE][0] + (lmlEdges[lmlE][2] - lmlEdges[lmlE][0]) * lmlT;
    var lmlV = lmlEdges[lmlE][1] + (lmlEdges[lmlE][3] - lmlEdges[lmlE][1]) * lmlT;
    var lmlSx = lmlU * lmlHx, lmlSy = lmlV * lmlHy;
    var lmlMx = lmlCx + lmlCb * lmlSx - lmlSb * lmlSy;
    var lmlMy = lmlCy + lmlSb * lmlSx + lmlCb * lmlSy;
    if (lmlMy < 0) lmlMy = 0;
    if (lmlMy > 1) lmlMy = 1;
    var lmlLat = (360 / Math.PI) * Math.atan(Math.exp((180 - lmlMy * 360) * Math.PI / 180)) - 90;
    var lmlPoint = lmlProject(lmlLat, lmlMx * 360 - 180, 0);
    if (!lmlPoint.visible) continue;
    lmlOut[lmlOut.length] = lmlFromComp(lmlToComp([lmlPoint.x, lmlPoint.y]));
  }
}
if (lmlOut.length < 3) lmlOut = [[0, 0], [0, 0], [0, 0]];
createPath(lmlOut, [], [], true);`;
}

/** The arrow's own shape, in layer pixels: a slim kite pointing up, drawn once at build time. */
export function northArrowPath(size: number): [number, number][] {
  const half = size / 2;
  return [
    [0, -half],
    [half * 0.62, half * 0.72],
    [0, half * 0.3],
    [-half * 0.62, half * 0.72]
  ];
}
