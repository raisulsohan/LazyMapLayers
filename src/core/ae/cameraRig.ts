// After Effects 3D camera rig that matches the rendered map, and 3D pins on the ground.
//
// Ground space: the map's ground plane is the scene comp's z = 0 plane. A geographic point lies at
//
//   x = (mercatorX(lng) - mercatorX(originLng)) * 512 * 2^referenceZoom + sceneWidth / 2
//   y = (mercatorY(lat) - mercatorY(originLat)) * 512 * 2^referenceZoom + sceneHeight / 2
//   z = -altitude in ground units (negative z points up, towards the camera)
//
// The origin is float32-representable, so the slider controls on the map layer hold it exactly.
// The rig is a 3D null at the ground position of the view centre, rotated by the bearing, with a
// one-node camera parented to it. For D = mapHeight / 2 / tan(fov / 2) and u = 2^(referenceZoom -
// zoom), the camera sits at local (0, D·u·sin p, -D·u·cos p), tilted by the pitch, with Zoom D.
// Working through the pinhole projection gives exactly the closed form in core/camera/camera.ts:
//
//   camera coords of a ground point (X, Y) in the null's frame: (X, Y·cos p, D·u - Y·sin p)
//   screen = centre + D · (X, Y·cos p) / (D·u - Y·sin p)
//          = centre + (xr, yr·cos p) · D / (D - yr·sin p)        with (xr, yr) = (X, Y) / u
//
// Scaling the map layer about the comp centre by s multiplies the camera Zoom by s.
// Moving the map layer off centre cannot be matched by a camera (AE cameras have no lens shift).

import { DEFAULT_FOV_RAD, cameraToCenterDistance, type View, type Viewport } from "../camera/camera.ts";
import { MAX_LATITUDE, TILE_SIZE, mercatorXFromLng, mercatorYFromLat, unwrapLongitudeNear, type LngLat } from "../geo/mercator.ts";
import { MAP_CONTROL_NAMES, PIN_EFFECTS } from "./pinExpressions.ts";
import { froundSource } from "./projectionExpression.ts";

/** MapLibre converts metres with this radius (maplibre-gl earthRadius), so extrusions line up. */
export const MAPLIBRE_EARTH_RADIUS_M = 6371008.8;

/**
 * Sign of AE's X Rotation for a camera tilt. With x right, y down and z into the screen, AE uses the
 * standard rotation matrices, so +pitch tilts the camera to look up the screen. Verified in AE by C1.
 */
export const AE_TILT_SIGN = 1;

export const RIG_CONTROL_NAMES = {
  originLatitude: "3D Origin Latitude",
  originLongitude: "3D Origin Longitude",
  referenceZoom: "3D Reference Zoom"
} as const;

export const PIN3D_EFFECTS = {
  map: PIN_EFFECTS.map,
  latitude: PIN_EFFECTS.latitude,
  longitude: PIN_EFFECTS.longitude,
  altitude: "Altitude (m)",
  /** The ground's elevation at the pin in metres, so it sits on 3D terrain (0 on flat maps). */
  elevation: PIN_EFFECTS.elevation
} as const;

export const RIG_MARKER = "// LazyMapLayers 3D camera";
export const PIN3D_MARKER = "// LazyMapLayers 3D pin";

export type Vec3 = [number, number, number];

export type GroundFrame = {
  /** Float32-representable, see groundFrameFor. */
  origin: LngLat;
  /** Integer zoom at which one ground unit is one world pixel. */
  referenceZoom: number;
  /** Scene comp size; the origin sits at its centre. */
  scene: { width: number; height: number };
};

export type RigPose = {
  target: { position: Vec3; rotationZ: number };
  camera: { position: Vec3; rotationX: number; zoom: number };
};

const DEG = Math.PI / 180;

/** A ground frame centred on a view: the origin is rounded to float32 so sliders store it exactly. */
export function groundFrameFor(view: View, scene: { width: number; height: number }): GroundFrame {
  return {
    origin: { lat: Math.fround(view.center.lat), lng: Math.fround(view.center.lng) },
    referenceZoom: Math.max(0, Math.floor(view.zoom)),
    scene
  };
}

function groundScale(frame: GroundFrame): number {
  return TILE_SIZE * Math.pow(2, frame.referenceZoom);
}

/** Ground units per metre of altitude at a latitude, as MapLibre scales extrusions. */
export function groundUnitsPerMeter(frame: GroundFrame, lat: number): number {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  return groundScale(frame) / (2 * Math.PI * MAPLIBRE_EARTH_RADIUS_M * Math.cos(clamped * DEG));
}

/** Scene comp 3D position of a geographic point. */
export function groundPoint(frame: GroundFrame, point: LngLat, altitudeMeters = 0): Vec3 {
  const s = groundScale(frame);
  const lng = unwrapLongitudeNear(point.lng, frame.origin.lng);
  return [
    (mercatorXFromLng(lng) - mercatorXFromLng(frame.origin.lng)) * s + frame.scene.width / 2,
    (mercatorYFromLat(point.lat) - mercatorYFromLat(frame.origin.lat)) * s + frame.scene.height / 2,
    -altitudeMeters * groundUnitsPerMeter(frame, point.lat)
  ];
}

/**
 * Rig values for a view. `map` is the map comp size (the renderer's viewport), `mapScale` the map
 * layer's uniform scale in the scene (1 = 100 %).
 */
export function rigPose(view: View, map: Viewport, frame: GroundFrame, mapScale = 1): RigPose {
  const d = cameraToCenterDistance(map);
  const u = Math.pow(2, frame.referenceZoom - view.zoom);
  const p = view.pitch * DEG;
  return {
    target: { position: groundPoint(frame, view.center), rotationZ: view.bearing },
    camera: {
      position: [0, d * u * Math.sin(p), -d * u * Math.cos(p)],
      rotationX: AE_TILT_SIGN * view.pitch,
      zoom: d * mapScale
    }
  };
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

function rotZ(deg: number): Mat3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function rotX(deg: number): Mat3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/**
 * Projects a scene comp 3D point through the rig the way an AE one-node camera does (parent null
 * with anchor 0 and Z rotation, camera with X rotation). Used to check the rig maths, and by C1 for
 * points above the ground.
 */
export function projectThroughRig(pose: RigPose, scene: { width: number; height: number }, point: Vec3): { x: number; y: number; visible: boolean } {
  const parent = rotZ(pose.target.rotationZ);
  const orientation = mul(parent, rotX(AE_TILT_SIGN * pose.camera.rotationX));
  const c = pose.camera.position;
  const t = pose.target.position;
  const eye: Vec3 = [
    t[0] + parent[0] * c[0] + parent[1] * c[1] + parent[2] * c[2],
    t[1] + parent[3] * c[0] + parent[4] * c[1] + parent[5] * c[2],
    t[2] + parent[6] * c[0] + parent[7] * c[1] + parent[8] * c[2]
  ];
  const rel = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  // Camera axes are the columns of the orientation matrix.
  const qx = orientation[0] * rel[0] + orientation[3] * rel[1] + orientation[6] * rel[2];
  const qy = orientation[1] * rel[0] + orientation[4] * rel[1] + orientation[7] * rel[2];
  const qz = orientation[2] * rel[0] + orientation[5] * rel[1] + orientation[8] * rel[2];
  const f = pose.camera.zoom / qz;
  return { x: scene.width / 2 + qx * f, y: scene.height / 2 + qy * f, visible: qz > 1e-6 };
}

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

const q = JSON.stringify;

/** Declares mx, my, S and ground(lat, lng) from the map layer's 3D controls. Needs `map`. */
function groundPrelude(): string {
  return `var DEG = Math.PI / 180, MAXLAT = ${num(MAX_LATITUDE)};
function mx(lon) {
  return (180 + lon) / 360;
}
function my(la) {
  var c = Math.max(-MAXLAT, Math.min(MAXLAT, la));
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + c * DEG / 2))) / 360;
}
var oLat = map.effect(${q(RIG_CONTROL_NAMES.originLatitude)})(1).value;
var oLng = map.effect(${q(RIG_CONTROL_NAMES.originLongitude)})(1).value;
var S = ${num(TILE_SIZE)} * Math.pow(2, map.effect(${q(RIG_CONTROL_NAMES.referenceZoom)})(1).value);
function ground(la, lo) {
  return [(mx(lo + 360 * Math.round((oLng - lo) / 360)) - mx(oLng)) * S + thisComp.width / 2, (my(la) - my(oLat)) * S + thisComp.height / 2];
}
`;
}

export type CameraRigExpressions = {
  targetPosition: string;
  targetRotationZ: string;
  cameraPosition: string;
  cameraRotationX: string;
  cameraZoom: string;
};

export function cameraRigExpressions(): CameraRigExpressions {
  const tanHalf = num(Math.tan(DEFAULT_FOV_RAD / 2));
  const header = `${RIG_MARKER} (generated; animate the map controls, not this code)`;
  const onTarget = `var map = effect(${q(PIN_EFFECTS.map)})(1);`;
  const onCamera = `var map = parent.effect(${q(PIN_EFFECTS.map)})(1);`;
  const control = (name: string) => `map.effect(${q(name)})(1).value`;
  return {
    targetPosition: `${header}
${onTarget}
${groundPrelude()}var g = ground(${control(MAP_CONTROL_NAMES.latitude)}, ${control(MAP_CONTROL_NAMES.longitude)});
[g[0], g[1], 0];`,
    targetRotationZ: `${header}
${onTarget}
${control(MAP_CONTROL_NAMES.bearing)};`,
    cameraPosition: `${header}
${onCamera}
var D = map.source.height / 2 / ${tanHalf};
var u = Math.pow(2, ${control(RIG_CONTROL_NAMES.referenceZoom)} - ${control(MAP_CONTROL_NAMES.zoom)});
var p = ${control(MAP_CONTROL_NAMES.pitch)} * Math.PI / 180;
[0, D * u * Math.sin(p), -D * u * Math.cos(p)];`,
    cameraRotationX: `${header}
${onCamera}
${num(AE_TILT_SIGN)} * ${control(MAP_CONTROL_NAMES.pitch)};`,
    cameraZoom: `${header}
${onCamera}
map.source.height / 2 / ${tanHalf} * map.transform.scale[0] / 100;`
  };
}

/** Position expression for a 3D pin; exact coordinates are baked in like 2D pins (see pinExpressions). */
export function pin3dPositionExpression(lat: number, lng: number): string {
  return `${PIN3D_MARKER} (generated; edit the effects, not this code)
var map = effect(${q(PIN3D_EFFECTS.map)})(1);
${froundSource()}function lmlPick(slider, exact) {
  if (Math.abs(slider - lmlFround(exact)) < 1e-9) return exact;
  return slider;
}
var lat = lmlPick(effect(${q(PIN3D_EFFECTS.latitude)})(1).value, ${num(lat)});
var lng = lmlPick(effect(${q(PIN3D_EFFECTS.longitude)})(1).value, ${num(lng)});
${groundPrelude()}var g = ground(lat, lng);
var perMeter = S / (2 * Math.PI * ${num(MAPLIBRE_EARTH_RADIUS_M)} * Math.cos(Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * DEG));
var height = 0, groundLevel = 0, elev = 0;
try { height = map.effect(${q(MAP_CONTROL_NAMES.terrainHeight)})(1).value; } catch (err) { height = 0; }
try { groundLevel = map.effect(${q(MAP_CONTROL_NAMES.groundLevel)})(1).value; } catch (err2) { groundLevel = 0; }
try { elev = effect(${q(PIN3D_EFFECTS.elevation)})(1).value; } catch (err3) { elev = 0; }
[g[0], g[1], -(effect(${q(PIN3D_EFFECTS.altitude)})(1).value + (elev - groundLevel) * height) * perMeter];`;
}
