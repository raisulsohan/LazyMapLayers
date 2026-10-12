// Which tiles a frame draws: MapLibre GL 6.10's tile choice ("covering tiles"), written again over the
// camera maths of camera.ts, so the panel knows before rendering which OpenStreetMap tiles every frame
// of a camera move will ask for (DECISIONS D101).
//
// MapLibre builds the camera frustum (near plane at height / 50, far plane just past the farther of
// the top of the screen and its own horizon), walks the tile quadtree from zoom 0 for seven world
// copies, keeps a tile when its box (flat, raised by up to 500 m as the view nears the horizon) is not
// outside any frustum plane nor outside the frustum's own box, and stops at the zoom it wants there:
// floor(zoom) for the whole frame, or, past about 60 degrees of pitch and with 3D terrain, a zoom that
// falls with the tile's distance from the camera. Every step below follows it, in the same units
// (mercator x and y from 0 to 1, height in metres), so the same tiles come out. tests/core/coveringTiles
// compares the result with MapLibre's own code for recorded views (tools/covering-fixtures.mjs).

import { DEFAULT_FOV_RAD, cameraToCenterDistance, type View, type Viewport } from "../camera/camera.ts";
import { mercatorXFromLng, mercatorYFromLat } from "../geo/mercator.ts";

export type TileId = { z: number; x: number; y: number };
/** A tile as MapLibre places it: `wrap` is the world copy (0 is the main one). */
export type CoveredTile = TileId & { wrap: number };

export type CoverOptions = {
  /** The source's highest zoom; past it the tiles of this zoom are stretched (overzoomed). */
  maxZoom: number;
  /** The source's lowest zoom (tiles above it are never asked for). */
  minZoom?: number;
  /** The source's tile size in screen pixels (512 for vector tiles). */
  tileSize?: number;
  /** 3D terrain is drawn: MapLibre then lowers the zoom with distance at every pitch. */
  terrain?: boolean;
  /** The view's centre height in metres (the renderer holds it at ground x height with 3D terrain). */
  elevation?: number;
};

const DEG = Math.PI / 180;
/** MapLibre's earth radius, which its metres-to-pixels factor uses. */
const EARTH_RADIUS = 6371008.8;
/** MapLibre's `maxMercatorHorizonAngle`. */
const MAX_HORIZON_ANGLE = 89.25;
/** MapLibre's defaults for lowering the zoom with distance. */
const MAX_ZOOM_LEVELS_ON_SCREEN = 9.314;
const TILE_COUNT_MAX_MIN_RATIO = 3;
/** Tiles near the horizon are tested as boxes this tall (metres), so tall features are not cut early. */
const ASSUMED_MAX_FEATURE_HEIGHT = 500;
const CULLING_ONSET_DEGREES = 15;
/** The world copies MapLibre walks on each side of the main one. */
const WORLD_COPIES = 3;

type Vec3 = [number, number, number];
type Plane = [number, number, number, number];
type Box = { min: Vec3; max: Vec3 };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const scaleZoom = (scale: number) => Math.log(scale) / Math.LN2;

/** The integral of cos(x)^p from x1 to x2, by ten midpoints as MapLibre takes it. */
function integralOfCosXByP(p: number, x1: number, x2: number): number {
  const points = 10;
  const dx = (x2 - x1) / points;
  let sum = 0;
  for (let i = 0; i < points; i++) sum += dx * Math.pow(Math.cos(x1 + ((i + 0.5) / points) * (x2 - x1)), p);
  return sum;
}

/** The zoom MapLibre wants for a tile at this distance from the camera (its default tile zoom function). */
function distantTileZoom(centerZoom: number, distanceToTile2D: number, distanceToTileZ: number, distanceToCenter3D: number, fovDegrees: number): number {
  const pitchTileLoading = 2 * ((MAX_ZOOM_LEVELS_ON_SCREEN - 1) / scaleZoom(Math.cos((MAX_HORIZON_ANGLE - fovDegrees) * DEG) / Math.cos(MAX_HORIZON_ANGLE * DEG)) - 1);
  const centerPitch = Math.acos(distanceToTileZ / distanceToCenter3D);
  const tileCountPitch0 = 2 * integralOfCosXByP(pitchTileLoading - 1, 0, (fovDegrees / 2) * DEG);
  const highestPitch = Math.min(MAX_HORIZON_ANGLE * DEG, centerPitch + (fovDegrees / 2) * DEG);
  const lowestPitch = Math.min(highestPitch, centerPitch - (fovDegrees / 2) * DEG);
  const tileCount = integralOfCosXByP(pitchTileLoading - 1, lowestPitch, highestPitch);
  const thisTilePitch = Math.atan(distanceToTile2D / distanceToTileZ);
  const distanceToTile3D = Math.hypot(distanceToTile2D, distanceToTileZ);
  let z = centerZoom + scaleZoom(distanceToCenter3D / distanceToTile3D / Math.max(0.5, Math.cos((fovDegrees / 2) * DEG)));
  z += (pitchTileLoading * scaleZoom(Math.cos(thisTilePitch))) / 2;
  z -= scaleZoom(Math.max(1, tileCount / tileCountPitch0 / TILE_COUNT_MAX_MIN_RATIO)) / 2;
  return z;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The plane through three points, its normal turned towards `inside`. */
function planeThrough(a: Vec3, b: Vec3, c: Vec3, inside: Vec3): Plane {
  const n = cross(sub(a, b), sub(c, b));
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  let normal: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
  let d = -dot(normal, b);
  if (dot(normal, inside) + d < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
    d = -d;
  }
  return [normal[0], normal[1], normal[2], d];
}

/** -1: the box is outside the plane, 1: fully inside, 0: across it (MapLibre's half-space test). */
function boxAgainstPlane(box: Box, plane: Plane): number {
  let low = plane[3];
  let high = plane[3];
  for (let i = 0; i < 3; i++) {
    if (plane[i] > 0) {
      low += plane[i] * box.min[i];
      high += plane[i] * box.max[i];
    } else {
      high += plane[i] * box.min[i];
      low += plane[i] * box.max[i];
    }
  }
  if (low >= 0) return 1;
  if (high < 0) return -1;
  return 0;
}

type Frustum = { planes: Plane[]; box: Box };

/** -1: not visible, 1: fully inside, 0: partly (MapLibre's Aabb.intersectsFrustum). */
function boxAgainstFrustum(box: Box, frustum: Frustum): number {
  let inside = true;
  for (const plane of frustum.planes) {
    const side = boxAgainstPlane(box, plane);
    if (side < 0) return -1;
    if (side === 0) inside = false;
  }
  if (inside) return 1;
  const f = frustum.box;
  for (let i = 0; i < 3; i++) if (f.min[i] > box.max[i] || f.max[i] < box.min[i]) return -1;
  return 0;
}

export type CameraFrustum = {
  frustum: Frustum;
  /** Camera position: mercator x and y, and its height above the centre in mercator units. */
  camera: { x: number; y: number; z: number };
  /** Distance from the camera to the centre, in mercator units. */
  distanceToCenter: number;
  /** Height of the tile boxes tested near the horizon, in metres. */
  cullingElevation: number;
};

/** MapLibre's camera frustum for a view, in mercator x and y and metres. */
export function cameraFrustum(view: View, viewport: Viewport, elevation = 0): CameraFrustum {
  const fov = viewport.fov ?? DEFAULT_FOV_RAD;
  const fovDegrees = fov / DEG;
  const width = viewport.width;
  const height = viewport.height;
  const d = cameraToCenterDistance(viewport);
  const pitch = view.pitch * DEG;
  const bearing = view.bearing * DEG;
  const worldSize = 512 * Math.pow(2, view.zoom);
  const pixelPerMeter = worldSize / (2 * Math.PI * EARTH_RADIUS * Math.cos(view.center.lat * DEG));

  // Near and far planes (MercatorTransform._calculateNearFarZ, without terrain's lowest tile).
  const limitedPitch = Math.min(view.pitch, MAX_HORIZON_ANGLE) * DEG;
  const cameraToSeaLevel = Math.max(d / 2, d + (elevation * pixelPerMeter) / Math.cos(limitedPitch));
  const cameraAltitude = (Math.cos(pitch) * d) / pixelPerMeter + elevation;
  const minElevation = Math.min(elevation, 0, cameraAltitude - 100);
  const lowestPlane = minElevation < 0 ? cameraToSeaLevel - (minElevation * pixelPerMeter) / Math.cos(limitedPitch) : cameraToSeaLevel;
  const groundAngle = Math.PI / 2 + pitch;
  const fovAboveCenter = fov * 0.5;
  const topHalfSurface = (Math.sin(fovAboveCenter) * lowestPlane) / Math.sin(clamp(Math.PI - groundAngle - fovAboveCenter, 0.01, Math.PI - 0.01));
  const horizon = d * Math.min(Math.tan((90 - view.pitch) * DEG) * 0.85, Math.tan((MAX_HORIZON_ANGLE - view.pitch) * DEG));
  const horizonAngle = Math.atan(horizon / d);
  const minFovToHorizon = (90 - MAX_HORIZON_ANGLE) * DEG;
  const fovToHorizon = horizonAngle > minFovToHorizon ? horizonAngle : minFovToHorizon;
  const topHalfHorizon = (Math.sin(fovToHorizon) * lowestPlane) / Math.sin(clamp(Math.PI - groundAngle - fovToHorizon, 0.01, Math.PI - 0.01));
  const farZ = (Math.cos(Math.PI / 2 - limitedPitch) * Math.min(topHalfSurface, topHalfHorizon) + lowestPlane) * 1.01;
  const nearZ = height / 50;

  // Corners in world pixels (x east, y south) with height in pixels, from the camera along each corner
  // ray: in the camera's turned frame the ray through screen point (u, v) runs along
  // (u, -d sin p + v cos p, -d cos p - v sin p), and a depth D along the view is D / d of it.
  const center = { x: mercatorXFromLng(view.center.lng) * worldSize, y: mercatorYFromLat(view.center.lat) * worldSize };
  const toWorld = (xr: number, yr: number, zUp: number): Vec3 => {
    const x = center.x + Math.cos(bearing) * xr - Math.sin(bearing) * yr;
    const y = center.y + Math.sin(bearing) * xr + Math.cos(bearing) * yr;
    return [x / worldSize, y / worldSize, zUp / pixelPerMeter];
  };
  const camera = { yr: d * Math.sin(pitch), z: elevation * pixelPerMeter + d * Math.cos(pitch) };
  const corner = (u: number, v: number, depth: number): Vec3 => {
    const k = depth / d;
    return toWorld(k * u, camera.yr + k * (-d * Math.sin(pitch) + v * Math.cos(pitch)), camera.z + k * (-d * Math.cos(pitch) - v * Math.sin(pitch)));
  };
  const w = width / 2;
  const h = height / 2;
  // Top left, top right, bottom right, bottom left; near then far.
  const screen: [number, number][] = [[-w, -h], [w, -h], [w, h], [-w, h]];
  const points = [...screen.map(([u, v]) => corner(u, v, nearZ)), ...screen.map(([u, v]) => corner(u, v, farZ))];
  const inside: Vec3 = [0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i], 0) / points.length) as Vec3;
  const planes = [
    planeThrough(points[0], points[1], points[2], inside), // near
    planeThrough(points[6], points[5], points[4], inside), // far
    planeThrough(points[0], points[3], points[7], inside), // left
    planeThrough(points[2], points[1], points[5], inside), // right
    planeThrough(points[3], points[2], points[6], inside), // bottom
    planeThrough(points[0], points[4], points[5], inside) // top
  ];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }

  const bottomEdgeAboveHorizontal = MAX_HORIZON_ANGLE - view.pitch - fovDegrees / 2;
  const nearHorizon = clamp((CULLING_ONSET_DEGREES - bottomEdgeAboveHorizontal) / CULLING_ONSET_DEGREES, 0, 1);
  const distanceToCenter = d / worldSize;
  return {
    frustum: { planes, box: { min, max } },
    camera: {
      x: center.x / worldSize - distanceToCenter * Math.sin(pitch) * Math.sin(bearing),
      y: center.y / worldSize + distanceToCenter * Math.sin(pitch) * Math.cos(bearing),
      z: distanceToCenter * Math.cos(pitch)
    },
    distanceToCenter,
    cullingElevation: elevation + nearHorizon * ASSUMED_MAX_FEATURE_HEIGHT
  };
}

/** True when MapLibre lowers the zoom of distant tiles for this view. */
export function variableZoom(view: View, viewport: Viewport, terrain = false): boolean {
  const fovDegrees = (viewport.fov ?? DEFAULT_FOV_RAD) / DEG;
  return terrain || view.pitch > clamp(78.5 - fovDegrees / 2, 0, 60);
}

/**
 * The tiles of one source a view draws, as MapLibre's coveringTiles returns them (nearest the centre
 * first, one per world copy it falls in).
 */
export function coveringTiles(view: View, viewport: Viewport, options: CoverOptions): CoveredTile[] {
  const tileSize = options.tileSize ?? 512;
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxZoom;
  const fovDegrees = (viewport.fov ?? DEFAULT_FOV_RAD) / DEG;
  const { frustum, camera, distanceToCenter, cullingElevation } = cameraFrustum(view, viewport, options.elevation ?? 0);
  const centerZoom = view.zoom + scaleZoom(512 / tileSize);
  const desiredZ = Math.max(0, Math.floor(centerZoom));
  const nominalZ = Math.min(desiredZ, maxZoom);
  const variable = variableZoom(view, viewport, options.terrain);
  const distanceZ = camera.z;
  const lowZ = Math.min(0, cullingElevation);
  const highZ = Math.max(0, cullingElevation);
  const numTiles = Math.pow(2, nominalZ);
  const centerPoint = { x: numTiles * mercatorXFromLng(view.center.lng), y: numTiles * mercatorYFromLat(view.center.lat) };

  type Entry = { zoom: number; x: number; y: number; wrap: number; fullyVisible: boolean };
  const stack: Entry[] = [];
  for (let i = 1; i <= WORLD_COPIES; i++) {
    stack.push({ zoom: 0, x: 0, y: 0, wrap: -i, fullyVisible: false });
    stack.push({ zoom: 0, x: 0, y: 0, wrap: i, fullyVisible: false });
  }
  stack.push({ zoom: 0, x: 0, y: 0, wrap: 0, fullyVisible: false });
  const result: { tile: CoveredTile; distanceSq: number }[] = [];
  while (stack.length) {
    const it = stack.pop()!;
    const n = 1 << it.zoom;
    const box: Box = { min: [it.wrap + it.x / n, it.y / n, lowZ], max: [it.wrap + (it.x + 1) / n, (it.y + 1) / n, highZ] };
    let fullyVisible = it.fullyVisible;
    if (!fullyVisible) {
      const side = boxAgainstFrustum(box, frustum);
      if (side < 0) continue;
      fullyVisible = side > 0;
    }
    let tileZ = desiredZ;
    if (variable) {
      const dx = Math.max(Math.min(box.max[0], camera.x), box.min[0]) - camera.x;
      const dy = Math.max(Math.min(box.max[1], camera.y), box.min[1]) - camera.y;
      tileZ = distantTileZoom(centerZoom, Math.hypot(dx, dy), distanceZ, distanceToCenter, fovDegrees);
    }
    tileZ = Math.max(0, Math.floor(tileZ));
    const z = Math.min(tileZ, maxZoom);
    if (it.zoom >= z) {
      if (it.zoom < minZoom) continue;
      result.push({ tile: { z: it.zoom, x: it.x, y: it.y, wrap: it.wrap }, distanceSq: (centerPoint.x - 0.5 - it.x) ** 2 + (centerPoint.y - 0.5 - it.y) ** 2 });
      continue;
    }
    for (let i = 0; i < 4; i++) stack.push({ zoom: it.zoom + 1, x: it.x * 2 + (i % 2), y: it.y * 2 + (i >> 1), wrap: it.wrap, fullyVisible });
  }
  return result.sort((a, b) => a.distanceSq - b.distanceSq).map((r) => r.tile);
}

/** "z/x/y" of a tile, the key every list of needed tiles uses. */
export const tileKey = (t: TileId) => `${t.z}/${t.x}/${t.y}`;

export function parseTileKey(key: string): TileId {
  const [z, x, y] = key.split("/").map(Number);
  return { z, x, y };
}

/** The tiles around each one at its own zoom (x wraps round the world, y stops at the poles). */
export function withRing(tiles: TileId[]): TileId[] {
  const seen = new Map<string, TileId>();
  for (const t of tiles) {
    const n = 1 << t.z;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const y = t.y + dy;
        if (y < 0 || y >= n) continue;
        const tile = { z: t.z, x: (((t.x + dx) % n) + n) % n, y };
        seen.set(tileKey(tile), tile);
      }
    }
  }
  return [...seen.values()];
}
