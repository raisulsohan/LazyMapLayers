// After Effects expressions for pinned layers (JavaScript expression engine).
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

import { MAP_CONTROL_NAMES, projectionPrelude } from "./projectionExpression.ts";

export { MAP_CONTROL_NAMES };

export const PIN_EFFECTS = {
  map: "Map",
  latitude: "Latitude",
  longitude: "Longitude",
  scaleWithMap: "Scale with Map",
  rotateWithMap: "Rotate with Map",
  referenceZoom: "Reference Zoom"
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
const map = effect(${JSON.stringify(PIN_EFFECTS.map)})(1);
const pick = (slider, exact) => Math.abs(slider - Math.fround(exact)) < 1e-9 ? exact : slider;
const lat = pick(effect(${JSON.stringify(PIN_EFFECTS.latitude)})(1).value, ${num(lat)});
const lng = pick(effect(${JSON.stringify(PIN_EFFECTS.longitude)})(1).value, ${num(lng)});
${projectionPrelude()}const pin = lmlProject(lat, lng, 0);
const zoom = lmlView.zoom, bearing = lmlView.bearing;
`;
}

export function pinExpressions(lat: number, lng: number): PinExpressions {
  const base = prelude(lat, lng);
  return {
    position: `${base}const c = map.toComp([pin.x, pin.y]);
value.length > 2 ? [c[0], c[1], value[2]] : [c[0], c[1]];`,
    scale: `${base}const on = effect(${JSON.stringify(PIN_EFFECTS.scaleWithMap)})(1).value;
const f = on ? pin.k * Math.pow(2, zoom - effect(${JSON.stringify(PIN_EFFECTS.referenceZoom)})(1).value) : 1;
value.map((v) => v * f);`,
    // On a flat map north turns with the bearing; on the globe it is measured on screen, since
    // meridians converge towards the poles.
    rotation: `${base}const turn = (() => {
  if (!lmlView.globe) return -bearing;
  const north = lmlProject(Math.min(89.9, lat + 0.01), lng, 0);
  return Math.atan2(north.x - pin.x, pin.y - north.y) * 180 / Math.PI;
})();
effect(${JSON.stringify(PIN_EFFECTS.rotateWithMap)})(1).value ? value + turn : value;`,
    opacity: `${base}pin.visible ? value : 0;`
  };
}
