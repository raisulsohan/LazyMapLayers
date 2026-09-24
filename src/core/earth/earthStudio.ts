// Google Earth Studio's 3D tracking data, read into a camera this panel can drive.
//
// Earth Studio renders photoreal Google Earth imagery in the browser and exports the camera that
// filmed it (File > Export > 3D Tracking Data, as JSON). Nothing of Google's is bundled or fetched
// here: the user renders their own footage under Google's terms, and this only reads the numbers
// that say where their camera was, so the panel's own layers - names, pins, routes, outlines - can
// sit on that footage.
//
// What the file holds, and what it means:
// - `cameraFrames[i].coordinate` is the camera's place as latitude, longitude and altitude in metres
//   above sea level. That is all the panel needs for position.
// - `cameraFrames[i].position` is the same place in Earth-centred coordinates, on a sphere of
//   6,371,010 m (checked against a real export: every frame agrees within 3 m).
// - `cameraFrames[i].rotation` is an After Effects rotation in degrees, applied X then Y then Z, that
//   turns the camera's own axes into Earth-centred ones. A camera looks down its own +Z.
// - `fovVertical` is the vertical field of view in degrees.
// - `trackPoints[].coordinate.position.attributes` carries longitude, latitude and altitude as shares
//   of their range, which is what this file turns back into degrees and metres.

import type { View } from "../camera/camera.ts";
import { EARTH_CIRCUMFERENCE_M, TILE_SIZE } from "../geo/mercator.ts";

/** The sphere Earth Studio measures its coordinates on. */
export const EARTH_STUDIO_RADIUS = 6371010;

const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export type EarthStudioFrame = {
  lat: number;
  lng: number;
  /** Metres above sea level. */
  altitude: number;
  /** Vertical field of view in degrees. */
  fov: number;
  rotation: { x: number; y: number; z: number };
};

export type EarthStudioTrackPoint = {
  name: string;
  lat: number;
  lng: number;
  /** Metres above sea level: the ground where the point was set. */
  altitude: number;
  /** The point the user made the origin of a local export. */
  origin: boolean;
  color: string | null;
};

export type EarthStudioProject = {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  frames: EarthStudioFrame[];
  trackPoints: EarthStudioTrackPoint[];
};

/** More frames than this and the camera is longer than any scene the panel builds in one go. */
export const MAX_EARTH_STUDIO_FRAMES = 9000;

const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : NaN);

function readTrackPoint(raw: unknown): EarthStudioTrackPoint | null {
  const point = (raw ?? {}) as { name?: unknown; coordinate?: { name?: unknown; color?: unknown; isOrigin?: unknown; position?: { attributes?: unknown } } };
  const attributes = Array.isArray(point.coordinate?.position?.attributes) ? (point.coordinate?.position?.attributes as { type?: unknown; value?: unknown }[]) : [];
  let lat = NaN;
  let lng = NaN;
  let altitude = NaN;
  for (const attribute of attributes) {
    const value = (attribute.value ?? {}) as { relative?: unknown; minValueRange?: unknown; maxValueRange?: unknown };
    const relative = number(value.relative);
    if (!Number.isFinite(relative)) continue;
    if (attribute.type === "longitude") lng = relative * 360 - 180;
    else if (attribute.type === "latitude") lat = relative * 180 - 90;
    else if (attribute.type === "altitude") {
      const low = number(value.minValueRange);
      const high = number(value.maxValueRange);
      altitude = Number.isFinite(low) && Number.isFinite(high) ? low + relative * (high - low) : NaN;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = typeof point.name === "string" && point.name.trim() ? point.name.trim() : typeof point.coordinate?.name === "string" ? String(point.coordinate.name) : "Track point";
  return {
    name: name.slice(0, 80),
    lat,
    lng,
    altitude: Number.isFinite(altitude) ? altitude : 0,
    origin: point.coordinate?.isOrigin === true,
    color: typeof point.coordinate?.color === "string" ? point.coordinate.color : null
  };
}

/**
 * Reads an Earth Studio 3D tracking file. Throws with a plain reason when the file is something
 * else, so the panel can say what was wrong with it.
 */
export function parseEarthStudio(text: string): EarthStudioProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`this is not a JSON file (${error instanceof Error ? error.message : String(error)})`);
  }
  const data = (raw ?? {}) as { name?: unknown; width?: unknown; height?: unknown; frameRate?: unknown; cameraFrames?: unknown; trackPoints?: unknown };
  if (!Array.isArray(data.cameraFrames) || !data.cameraFrames.length) {
    throw new Error('this file has no cameraFrames. In Earth Studio use File > Export > 3D Tracking Data and pick JSON, with "3D Camera" ticked');
  }
  const width = number(data.width);
  const height = number(data.height);
  const frameRate = number(data.frameRate);
  if (!(width > 0) || !(height > 0)) throw new Error("the file does not say what size the render is");
  if (!(frameRate > 0)) throw new Error("the file does not say what frame rate the render is");
  const frames: EarthStudioFrame[] = [];
  for (const entry of (data.cameraFrames as unknown[]).slice(0, MAX_EARTH_STUDIO_FRAMES)) {
    const frame = (entry ?? {}) as { coordinate?: { latitude?: unknown; longitude?: unknown; altitude?: unknown }; rotation?: { x?: unknown; y?: unknown; z?: unknown }; fovVertical?: unknown };
    const lat = number(frame.coordinate?.latitude);
    const lng = number(frame.coordinate?.longitude);
    const altitude = number(frame.coordinate?.altitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altitude)) continue;
    const fov = number(frame.fovVertical);
    frames.push({
      lat,
      lng,
      altitude,
      fov: Number.isFinite(fov) && fov > 0 ? fov : 20,
      rotation: { x: number(frame.rotation?.x) || 0, y: number(frame.rotation?.y) || 0, z: number(frame.rotation?.z) || 0 }
    });
  }
  if (!frames.length) throw new Error("none of the frames in this file carry a latitude, longitude and altitude");
  const trackPoints = (Array.isArray(data.trackPoints) ? data.trackPoints : []).map(readTrackPoint).filter((point): point is EarthStudioTrackPoint => !!point);
  return {
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 80) : "Earth Studio",
    width: Math.round(width),
    height: Math.round(height),
    frameRate,
    frames,
    trackPoints
  };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** East, north and up at a place, in Earth-centred coordinates. */
export function enuAt(lat: number, lng: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const la = lat * DEG;
  const lo = lng * DEG;
  return {
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
  };
}

/** The place a camera sits, in Earth-centred coordinates on Earth Studio's sphere. */
export function earthCentred(lat: number, lng: number, altitude: number): Vec3 {
  const r = EARTH_STUDIO_RADIUS + altitude;
  const ring = Math.cos(lat * DEG) * r;
  return [ring * Math.cos(lng * DEG), ring * Math.sin(lng * DEG), r * Math.sin(lat * DEG)];
}

type Matrix = [Vec3, Vec3, Vec3];

const multiply = (a: Matrix, b: Matrix): Matrix =>
  [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]) as Vec3) as Matrix;

const applyMatrix = (m: Matrix, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** After Effects' rotation, X then Y then Z, as a matrix. */
export function rotationMatrix(rotation: { x: number; y: number; z: number }): Matrix {
  const cx = Math.cos(rotation.x * DEG);
  const sx = Math.sin(rotation.x * DEG);
  const cy = Math.cos(rotation.y * DEG);
  const sy = Math.sin(rotation.y * DEG);
  const cz = Math.cos(rotation.z * DEG);
  const sz = Math.sin(rotation.z * DEG);
  const X: Matrix = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx]
  ];
  const Y: Matrix = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy]
  ];
  const Z: Matrix = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1]
  ];
  return multiply(multiply(X, Y), Z);
}

/** Where a camera looks and which way is up on its screen, in Earth-centred coordinates. */
export function cameraAxes(rotation: { x: number; y: number; z: number }): { forward: Vec3; up: Vec3 } {
  const m = rotationMatrix(rotation);
  return { forward: applyMatrix(m, [0, 0, 1]), up: applyMatrix(m, [0, -1, 0]) };
}

/** How far the camera is tilted from straight down, and which way it faces, in degrees. */
export function bearingAndPitch(frame: EarthStudioFrame): { bearing: number; pitch: number } {
  const { forward, up } = cameraAxes(frame.rotation);
  const local = enuAt(frame.lat, frame.lng);
  const pitch = Math.acos(Math.max(-1, Math.min(1, -dot(forward, local.up)))) / DEG;
  // Up on the screen, flattened onto the ground, points the way the camera faces.
  const climb = dot(up, local.up);
  const flatEast = dot(up, local.east) - climb * dot(local.up, local.east);
  const flatNorth = dot(up, local.north) - climb * dot(local.up, local.north);
  let bearing = Math.atan2(flatEast, flatNorth) / DEG;
  if (!(flatEast * flatEast + flatNorth * flatNorth > 1e-12)) bearing = Math.atan2(dot(forward, local.east), dot(forward, local.north)) / DEG;
  if (bearing > 180) bearing -= 360;
  if (bearing <= -180) bearing += 360;
  return { bearing, pitch };
}

/**
 * The view that shows the same ground as one Earth Studio frame, in a comp `height` pixels tall.
 *
 * The scale is matched where it matters, at the middle of the frame: an Earth Studio camera at
 * altitude h, tilted by p, is h / cos(p) from the ground there, and covers 2 tan(fov/2) of that
 * distance over the comp's height.
 */
export function viewOfFrame(frame: EarthStudioFrame, height: number): View {
  const { bearing, pitch } = bearingAndPitch(frame);
  const distance = frame.altitude / Math.max(0.05, Math.cos(pitch * DEG));
  const metresPerPixel = (2 * distance * Math.tan((frame.fov / 2) * DEG)) / Math.max(1, height);
  const zoom = Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(frame.lat * DEG)) / (TILE_SIZE * metresPerPixel));
  return {
    center: { lat: frame.lat, lng: frame.lng },
    zoom: Math.max(0, Math.min(24, zoom)),
    bearing,
    pitch: Math.max(0, Math.min(85, pitch))
  };
}

/** Every frame as a view, for keyframing a map. */
export const viewsOfProject = (project: EarthStudioProject, height = project.height): View[] => project.frames.map((frame) => viewOfFrame(frame, height));

/**
 * The rotation Earth Studio would write for a camera at a place looking a way: the other side of
 * bearingAndPitch, so the reading can be proved by going round the loop.
 */
export function rotationForView(lat: number, lng: number, bearing: number, pitch: number): { x: number; y: number; z: number } {
  const local = enuAt(lat, lng);
  const b = bearing * DEG;
  const p = pitch * DEG;
  // The way the camera looks: down, tipped up by the pitch, turned to the bearing.
  const horizontal: Vec3 = [
    Math.sin(b) * local.east[0] + Math.cos(b) * local.north[0],
    Math.sin(b) * local.east[1] + Math.cos(b) * local.north[1],
    Math.sin(b) * local.east[2] + Math.cos(b) * local.north[2]
  ];
  const forward: Vec3 = [
    Math.sin(p) * horizontal[0] - Math.cos(p) * local.up[0],
    Math.sin(p) * horizontal[1] - Math.cos(p) * local.up[1],
    Math.sin(p) * horizontal[2] - Math.cos(p) * local.up[2]
  ];
  const up: Vec3 = [
    Math.cos(p) * horizontal[0] + Math.sin(p) * local.up[0],
    Math.cos(p) * horizontal[1] + Math.sin(p) * local.up[1],
    Math.cos(p) * horizontal[2] + Math.sin(p) * local.up[2]
  ];
  // The camera's own axes as columns: right, -up (After Effects' y grows downwards), forward.
  // Right is forward across up, so that right, down and forward turn the same way as After Effects.
  const right: Vec3 = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0]
  ];
  const m: Matrix = [
    [right[0], -up[0], forward[0]],
    [right[1], -up[1], forward[1]],
    [right[2], -up[2], forward[2]]
  ];
  // Taking X, Y and Z back out of the matrix, in the order After Effects applies them.
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  const cy = Math.cos(y);
  if (Math.abs(cy) < 1e-9) {
    return { x: Math.atan2(-m[1][0], m[1][1]) / DEG, y: y / DEG, z: 0 };
  }
  return {
    x: Math.atan2(-m[1][2], m[2][2]) / DEG,
    y: y / DEG,
    z: Math.atan2(-m[0][1], m[0][0]) / DEG
  };
}
