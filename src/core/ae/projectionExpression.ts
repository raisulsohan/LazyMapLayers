// Shared After Effects expression code: the camera projection of core/camera/camera.ts and
// core/camera/globe.ts, for pins, labels and routes. The snippet expects `map` (the map layer, reached
// through a Layer Control effect) and defines:
//
//   lmlView                         the camera controls at the current time
//   lmlProject(lat, lng, altitude)  -> { x, y, w, visible, k } in map comp pixels
//
// k is the map scale at the point relative to the view centre (1 at the centre of a flat, unpitched
// view). The map layer's "Globe" checkbox selects MapLibre's globe projection; maps without it are
// Mercator.

import { DEFAULT_FOV_RAD } from "../camera/camera.ts";
import { EARTH_RADIUS_M, GLOBE_TO_MERCATOR } from "../camera/globe.ts";
import { MAX_LATITUDE, TILE_SIZE } from "../geo/mercator.ts";

export const MAP_CONTROL_NAMES = {
  latitude: "Latitude",
  longitude: "Longitude",
  zoom: "Zoom",
  bearing: "Bearing",
  pitch: "Pitch",
  globe: "Globe"
} as const;

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

const q = JSON.stringify;

export function projectionPrelude(): string {
  const control = (name: string) => `map.effect(${q(name)})(1).value`;
  return `const lmlView = (() => {
  let globe = 0;
  try { globe = ${control(MAP_CONTROL_NAMES.globe)} ? 1 : 0; } catch (err) { globe = 0; }
  return { lat: ${control(MAP_CONTROL_NAMES.latitude)}, lng: ${control(MAP_CONTROL_NAMES.longitude)}, zoom: ${control(MAP_CONTROL_NAMES.zoom)}, bearing: ${control(MAP_CONTROL_NAMES.bearing)}, pitch: ${control(MAP_CONTROL_NAMES.pitch)}, globe: globe };
})();
const lmlProject = (lat, lng, altitude) => {
  const DEG = Math.PI / 180, MAXLAT = ${num(MAX_LATITUDE)}, EARTH = ${num(EARTH_RADIUS_M)};
  const v = lmlView, W = map.source.width, H = map.source.height, D = H / 2 / ${num(Math.tan(DEFAULT_FOV_RAD / 2))};
  const alt = altitude || 0;
  const size = ${num(TILE_SIZE)} * Math.pow(2, v.zoom);
  const t = v.globe ? Math.max(0, Math.min(1, (${num(GLOBE_TO_MERCATOR.to)} - v.zoom) / ${num(GLOBE_TO_MERCATOR.to - GLOBE_TO_MERCATOR.from)})) : 0;
  const b = v.bearing * DEG, p = v.pitch * DEG;
  let fx = 0, fy = 0, fw = 1, gx = 0, gy = 0, gw = 1, gVisible = true;
  if (t < 1) {
    const mx = (lon) => (180 + lon) / 360;
    const my = (la) => { const c = Math.max(-MAXLAT, Math.min(MAXLAT, la)); return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + c * DEG / 2))) / 360; };
    const near = lng + 360 * Math.round((v.lng - lng) / 360);
    const dx = (mx(near) - mx(v.lng)) * size, dy = (my(lat) - my(v.lat)) * size;
    const xr = Math.cos(b) * dx + Math.sin(b) * dy, yr = -Math.sin(b) * dx + Math.cos(b) * dy;
    const h = alt * size / (2 * Math.PI * EARTH * Math.cos(v.lat * DEG));
    fw = D - yr * Math.sin(p) - h * Math.cos(p);
    fx = D * xr;
    fy = D * (yr * Math.cos(p) - h * Math.sin(p));
  }
  if (t > 0) {
    const r = size / (2 * Math.PI) / Math.cos(v.lat * DEG);
    const lift = r * (1 + alt / EARTH);
    let x = Math.sin(lng * DEG) * Math.cos(lat * DEG) * lift, y = Math.sin(lat * DEG) * lift, z = Math.cos(lng * DEG) * Math.cos(lat * DEG) * lift, s = 0;
    const cl = Math.cos(-v.lng * DEG), sl = Math.sin(-v.lng * DEG);
    s = cl * x + sl * z; z = -sl * x + cl * z; x = s;
    const cp = Math.cos(v.lat * DEG), sp = Math.sin(v.lat * DEG);
    s = cp * y - sp * z; z = sp * y + cp * z; y = s;
    z -= r;
    s = Math.cos(b) * x - Math.sin(b) * y; y = Math.sin(b) * x + Math.cos(b) * y; x = s;
    s = Math.cos(p) * y + Math.sin(p) * z; z = -Math.sin(p) * y + Math.cos(p) * z; y = s;
    z -= D;
    const cy = -r * Math.sin(p), cz = -r * Math.cos(p) - D;
    if (alt <= 0) {
      gVisible = -x * x - (y - cy) * y - (z - cz) * z > 0;
    } else {
      const u = Math.max(0, Math.min(1, (cy * y + cz * z) / (x * x + y * y + z * z)));
      gVisible = (u * x) * (u * x) + (u * y - cy) * (u * y - cy) + (u * z - cz) * (u * z - cz) >= r * r;
    }
    gx = D * x; gy = -D * y; gw = -z;
  }
  const px = fx + (gx - fx) * t, py = fy + (gy - fy) * t, w = fw + (gw - fw) * t;
  const scaleAtPoint = 1 + (Math.cos(lat * DEG) / Math.cos(v.lat * DEG) - 1) * t;
  return { x: W / 2 + px / w, y: H / 2 + py / w, w: w, visible: w > 1e-6 && (t === 0 || gVisible), k: D / w * scaleAtPoint };
};
`;
}
