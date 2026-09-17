// After Effects expressions for pinned layers (JavaScript expression engine).
//
// A pin keeps its geographic position on the map at every frame. Its expressions read the camera
// controls from the map layer through a Layer Control effect named "Map" (rename-safe), project the
// pin with exactly the maths of core/camera/camera.ts, and convert from map-comp pixels to the
// scene comp with the map layer's own transform (layer.toComp), so moving or scaling the map layer
// keeps pins attached.
//
// Precision: Slider Controls store float32, which is about 4e-6 degrees near 50° latitude, or more
// than a pixel at zoom 18. The exact double-precision coordinates are baked into the expression and
// used while the slider still holds (the float32 rounding of) the same value. Once someone changes
// the slider, its value wins.

import { DEFAULT_FOV_RAD } from "../camera/camera.ts";
import { MAX_LATITUDE, TILE_SIZE } from "../geo/mercator.ts";

export const PIN_EFFECTS = {
  map: "Map",
  latitude: "Latitude",
  longitude: "Longitude",
  scaleWithMap: "Scale with Map",
  rotateWithMap: "Rotate with Map",
  referenceZoom: "Reference Zoom"
} as const;

export const MAP_CONTROL_NAMES = {
  latitude: "Latitude",
  longitude: "Longitude",
  zoom: "Zoom",
  bearing: "Bearing",
  pitch: "Pitch"
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

/** Shared projection prelude. Ends with a `pin` object: { x, y, k, visible, bearing, zoom }. */
function prelude(lat: number, lng: number): string {
  const fovHalfTan = Math.tan(DEFAULT_FOV_RAD / 2);
  return `${EXPRESSION_MARKER} (generated; edit the effects, not this code)
const map = effect(${JSON.stringify(PIN_EFFECTS.map)})(1);
const W = map.source.width, H = map.source.height;
const pick = (slider, exact) => Math.abs(slider - Math.fround(exact)) < 1e-9 ? exact : slider;
const lat = pick(effect(${JSON.stringify(PIN_EFFECTS.latitude)})(1).value, ${num(lat)});
const lng = pick(effect(${JSON.stringify(PIN_EFFECTS.longitude)})(1).value, ${num(lng)});
const cLat = map.effect(${JSON.stringify(MAP_CONTROL_NAMES.latitude)})(1).value;
const cLng = map.effect(${JSON.stringify(MAP_CONTROL_NAMES.longitude)})(1).value;
const zoom = map.effect(${JSON.stringify(MAP_CONTROL_NAMES.zoom)})(1).value;
const bearing = map.effect(${JSON.stringify(MAP_CONTROL_NAMES.bearing)})(1).value;
const pitch = map.effect(${JSON.stringify(MAP_CONTROL_NAMES.pitch)})(1).value;
const pin = (() => {
  const DEG = Math.PI / 180, MAXLAT = ${num(MAX_LATITUDE)};
  const mx = (lon) => (180 + lon) / 360;
  const my = (la) => { const c = Math.max(-MAXLAT, Math.min(MAXLAT, la)); return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + c * DEG / 2))) / 360; };
  const size = ${num(TILE_SIZE)} * Math.pow(2, zoom);
  const lngNear = lng + 360 * Math.round((cLng - lng) / 360);
  const dx = (mx(lngNear) - mx(cLng)) * size, dy = (my(lat) - my(cLat)) * size;
  const b = bearing * DEG, p = pitch * DEG, D = H / 2 / ${num(fovHalfTan)};
  const xr = Math.cos(b) * dx + Math.sin(b) * dy, yr = -Math.sin(b) * dx + Math.cos(b) * dy;
  const depth = D - yr * Math.sin(p), k = D / depth;
  return { x: W / 2 + xr * k, y: H / 2 + yr * Math.cos(p) * k, k: k, visible: depth > 1e-6 };
})();
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
    rotation: `${base}effect(${JSON.stringify(PIN_EFFECTS.rotateWithMap)})(1).value ? value - bearing : value;`,
    opacity: `${base}pin.visible ? value : 0;`
  };
}
