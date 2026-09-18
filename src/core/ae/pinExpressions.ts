// After Effects expressions for pinned layers (ES3: both expression engines, see projectionExpression.ts).
//
// A pin keeps its geographic position on the map at every frame. Its expressions read the camera
// controls from the map layer through a Layer Control effect named "Map" (rename-safe), project the
// pin with exactly the maths of core/camera (Mercator or globe, see projectionExpression.ts), and
// convert from map-comp pixels to the scene comp with the map layer's own transform
// (layer.toComp), so moving or scaling the map layer keeps pins attached.
//
// Precision: Slider Controls store float32, which is about 4e-6 degrees near 50° latitude, or more
// than a pixel at zoom 18. The exact double-precision coordinates are baked into the expression and
// used while the slider still holds (the float32 rounding of) the same value. Once someone changes
// the slider, its value wins.

import { froundSource, MAP_CONTROL_NAMES, projectionPrelude } from "./projectionExpression.ts";

export { MAP_CONTROL_NAMES };

export const PIN_EFFECTS = {
  map: "Map",
  latitude: "Latitude",
  longitude: "Longitude",
  scaleWithMap: "Scale with Map",
  rotateWithMap: "Rotate with Map",
  referenceZoom: "Reference Zoom",
  /** The ground's elevation at the pin in metres, so it sits on 3D terrain; pins made before terrain lack it. */
  elevation: "Elevation (m)"
} as const;

export const EXPRESSION_MARKER = "// LazyMapLayers pin";

export type PinExpressions = { position: string; scale: string; rotation: string; opacity: string };

/** Slider Controls store float32; this returns what AE will read back for `value`. */
export function float32(value: number): number {
  return Math.fround(value);
}

function num(value: number): string {
  // Full double precision, no exponent surprises.
  return Number.isFinite(value) ? String(value) : "0";
}

/** Shared prelude. Ends with `pin` = lmlProject(lat, lng) plus the camera values used below. */
function prelude(lat: number, lng: number): string {
  return `${EXPRESSION_MARKER} (generated; edit the effects, not this code)
var map = effect(${JSON.stringify(PIN_EFFECTS.map)})(1);
${froundSource()}function lmlPick(slider, exact) {
  if (Math.abs(slider - lmlFround(exact)) < 1e-9) return exact;
  return slider;
}
var lat = lmlPick(effect(${JSON.stringify(PIN_EFFECTS.latitude)})(1).value, ${num(lat)});
var lng = lmlPick(effect(${JSON.stringify(PIN_EFFECTS.longitude)})(1).value, ${num(lng)});
${projectionPrelude()}var elev = 0;
try { elev = effect(${JSON.stringify(PIN_EFFECTS.elevation)})(1).value; } catch (err4) { elev = 0; }
var pin = lmlProject(lat, lng, lmlGround(elev));
var zoom = lmlView.zoom, bearing = lmlView.bearing;
`;
}

export function pinExpressions(lat: number, lng: number): PinExpressions {
  const base = prelude(lat, lng);
  return {
    position: `${base}var c = map.toComp([pin.x, pin.y]);
value.length > 2 ? [c[0], c[1], value[2]] : [c[0], c[1]];`,
    scale: `${base}var on = effect(${JSON.stringify(PIN_EFFECTS.scaleWithMap)})(1).value;
var f = on ? pin.k * Math.pow(2, zoom - effect(${JSON.stringify(PIN_EFFECTS.referenceZoom)})(1).value) : 1;
var scaled = [];
for (var i = 0; i < value.length; i++) scaled.push(value[i] * f);
scaled;`,
    // On a flat map north turns with the bearing; on the globe it is measured on screen, since
    // meridians converge towards the poles.
    rotation: `${base}var turn = (function () {
  if (!lmlView.globe) return -bearing;
  var north = lmlProject(Math.min(89.9, lat + 0.01), lng, lmlGround(elev));
  return Math.atan2(north.x - pin.x, pin.y - north.y) * 180 / Math.PI;
})();
effect(${JSON.stringify(PIN_EFFECTS.rotateWithMap)})(1).value ? value + turn : value;`,
    opacity: `${base}pin.visible ? value : 0;`
  };
}
