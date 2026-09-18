// Shared After Effects expression code: the camera projection of core/camera/camera.ts and
// core/camera/globe.ts, for pins, labels and routes. The snippet expects `map` (the map layer, reached
// through a Layer Control effect) and defines:
//
//   lmlView                         the camera controls at the current time (with the terrain's
//                                   height and ground level, 0 on maps without 3D terrain)
//   lmlGround(elevation)            metres above the map's ground level, as the terrain shows them
//   lmlProject(lat, lng, altitude)  -> { x, y, w, visible, k } in map comp pixels
//
// k is the map scale at the point relative to the view centre (1 at the centre of a flat, unpitched
// view). The map layer's "Globe" checkbox selects MapLibre's globe projection; maps without it are
// Mercator.
//
// Every generated expression is ES3, so it runs in both of After Effects' expression engines: the
// JavaScript engine and the Legacy ExtendScript engine, which many project templates still use. That
// means var and function (no const, let or arrow functions), no template literals, no array methods
// such as map or findIndex, no Math functions newer than ES3, and no chained conditional operators
// (ExtendScript evaluates them wrongly). tools/check-expressions.js runs every generator's output in
// an ES3 engine to keep it that way.

import { DEFAULT_FOV_RAD } from "../camera/camera.ts";
import { EARTH_RADIUS_M, GLOBE_TO_MERCATOR } from "../camera/globe.ts";
import { MAX_LATITUDE, TILE_SIZE } from "../geo/mercator.ts";

export const MAP_CONTROL_NAMES = {
  latitude: "Latitude",
  longitude: "Longitude",
  zoom: "Zoom",
  bearing: "Bearing",
  pitch: "Pitch",
  globe: "Globe",
  /** 3D terrain: how much the elevation is exaggerated (0 for a flat map). */
  terrainHeight: "Terrain Height",
  /** 3D terrain: the elevation in metres the camera counts from (the map centre's ground). */
  groundLevel: "Ground Level"
} as const;

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

const q = JSON.stringify;

/**
 * lmlFround(x): Math.fround (float32 rounding, ties to even) for engines without it. Slider Controls
 * store float32, and pins compare a slider with the float32 value of their exact coordinates.
 */
export function froundSource(): string {
  return `function lmlFround(x) {
  if (x !== x || x === 0 || x === Infinity || x === -Infinity) return x;
  var a = Math.abs(x), e = Math.floor(Math.log(a) / Math.LN2);
  if (Math.pow(2, e) > a) e -= 1;
  if (Math.pow(2, e + 1) <= a) e += 1;
  if (e < -126) e = -126;
  var step = Math.pow(2, e - 23), m = a / step, r = Math.floor(m), d = m - r;
  if (d > 0.5 || (d === 0.5 && r % 2 === 1)) r += 1;
  var y = r * step;
  if (y > 3.4028234663852886e38) y = Infinity;
  return x < 0 ? -y : y;
}
`;
}

export function projectionPrelude(): string {
  const control = (name: string) => `map.effect(${q(name)})(1).value`;
  return `var lmlView = (function () {
  var globe = 0;
  var height = 0, ground = 0;
  try { globe = ${control(MAP_CONTROL_NAMES.globe)} ? 1 : 0; } catch (err) { globe = 0; }
  try { height = ${control(MAP_CONTROL_NAMES.terrainHeight)}; } catch (err2) { height = 0; }
  try { ground = ${control(MAP_CONTROL_NAMES.groundLevel)}; } catch (err3) { ground = 0; }
  return { lat: ${control(MAP_CONTROL_NAMES.latitude)}, lng: ${control(MAP_CONTROL_NAMES.longitude)}, zoom: ${control(MAP_CONTROL_NAMES.zoom)}, bearing: ${control(MAP_CONTROL_NAMES.bearing)}, pitch: ${control(MAP_CONTROL_NAMES.pitch)}, globe: globe, height: height, ground: ground };
})();
function lmlGround(elevation) {
  return ((elevation || 0) - lmlView.ground) * lmlView.height;
}
function lmlProject(lat, lng, altitude) {
  var DEG = Math.PI / 180, MAXLAT = ${num(MAX_LATITUDE)}, EARTH = ${num(EARTH_RADIUS_M)};
  var v = lmlView, W = map.source.width, H = map.source.height, D = H / 2 / ${num(Math.tan(DEFAULT_FOV_RAD / 2))};
  var alt = altitude || 0;
  var size = ${num(TILE_SIZE)} * Math.pow(2, v.zoom);
  var t = 0;
  if (v.globe) t = Math.max(0, Math.min(1, (${num(GLOBE_TO_MERCATOR.to)} - v.zoom) / ${num(GLOBE_TO_MERCATOR.to - GLOBE_TO_MERCATOR.from)}));
  var b = v.bearing * DEG, p = v.pitch * DEG;
  var fx = 0, fy = 0, fw = 1, gx = 0, gy = 0, gw = 1, gVisible = true;
  if (t < 1) {
    var near = lng + 360 * Math.round((v.lng - lng) / 360);
    var dx = (lmlMercX(near) - lmlMercX(v.lng)) * size, dy = (lmlMercY(lat, MAXLAT) - lmlMercY(v.lat, MAXLAT)) * size;
    var xr = Math.cos(b) * dx + Math.sin(b) * dy, yr = -Math.sin(b) * dx + Math.cos(b) * dy;
    var h = alt * size / (2 * Math.PI * EARTH * Math.cos(v.lat * DEG));
    fw = D - yr * Math.sin(p) - h * Math.cos(p);
    fx = D * xr;
    fy = D * (yr * Math.cos(p) - h * Math.sin(p));
  }
  if (t > 0) {
    var r = size / (2 * Math.PI) / Math.cos(v.lat * DEG);
    var lift = r * (1 + alt / EARTH);
    var x = Math.sin(lng * DEG) * Math.cos(lat * DEG) * lift, y = Math.sin(lat * DEG) * lift, z = Math.cos(lng * DEG) * Math.cos(lat * DEG) * lift, s = 0;
    var cl = Math.cos(-v.lng * DEG), sl = Math.sin(-v.lng * DEG);
    s = cl * x + sl * z; z = -sl * x + cl * z; x = s;
    var cp = Math.cos(v.lat * DEG), sp = Math.sin(v.lat * DEG);
    s = cp * y - sp * z; z = sp * y + cp * z; y = s;
    z -= r;
    s = Math.cos(b) * x - Math.sin(b) * y; y = Math.sin(b) * x + Math.cos(b) * y; x = s;
    s = Math.cos(p) * y + Math.sin(p) * z; z = -Math.sin(p) * y + Math.cos(p) * z; y = s;
    z -= D;
    var cy = -r * Math.sin(p), cz = -r * Math.cos(p) - D;
    if (alt <= 0) {
      gVisible = -x * x - (y - cy) * y - (z - cz) * z > 0;
    } else {
      var u = Math.max(0, Math.min(1, (cy * y + cz * z) / (x * x + y * y + z * z)));
      gVisible = (u * x) * (u * x) + (u * y - cy) * (u * y - cy) + (u * z - cz) * (u * z - cz) >= r * r;
    }
    gx = D * x; gy = -D * y; gw = -z;
  }
  var px = fx + (gx - fx) * t, py = fy + (gy - fy) * t, w = fw + (gw - fw) * t;
  var scaleAtPoint = 1 + (Math.cos(lat * DEG) / Math.cos(v.lat * DEG) - 1) * t;
  return { x: W / 2 + px / w, y: H / 2 + py / w, w: w, visible: w > 1e-6 && (t === 0 || gVisible), k: D / w * scaleAtPoint };
}
function lmlMercX(lon) {
  return (180 + lon) / 360;
}
function lmlMercY(la, maxLat) {
  var c = Math.max(-maxLat, Math.min(maxLat, la));
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + c * (Math.PI / 180) / 2))) / 360;
}
`;
}
