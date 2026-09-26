// Paths the user drew over the map in After Effects (pen tool shape layers, masks), turned into
// geography: every path is carried through its groups, its layer, the layer's parents and back into
// the map comp's pixels, cut into short steps along its curves, and each step unprojected through the
// camera of the moment it was drawn at. An open path becomes a line, a closed one an area, both as
// GeoJSON the importer already reads, so a drawing becomes routes and areas that follow the map.

import { unprojectPoint, type MapProjection } from "../camera/globe.ts";
import type { View } from "../camera/camera.ts";

/** A layer's or a shape group's 2D transform as After Effects keeps it (scale in percent, rotation in degrees). */
export type Transform2D = { anchor: number[]; position: number[]; scale: number[]; rotation: number };

/** One path as the host reads it: its points in its own space, and the transforms above it, innermost first. */
export type DrawnPath = {
  name: string;
  closed: boolean;
  vertices: number[][];
  inTangents: number[][];
  outTangents: number[][];
  chain: Transform2D[];
};

/** What the host reads off the selected layers (src/host/77-drawn.jsx readDrawnPaths). */
export type DrawnPaths = {
  /** The seconds in the map comp the paths were read at. */
  time: number;
  view: View;
  width: number;
  height: number;
  /** The map layer's transform in the scene: undone at the end. Null when drawn inside the map comp itself. */
  mapLayer: Transform2D | null;
  paths: DrawnPath[];
  skipped: string[];
};

type P = [number, number];

const DEG = Math.PI / 180;

/** A point carried from a space into its owner's: position + rotate(scale(point - anchor)). */
export function throughTransform(t: Transform2D, p: P): P {
  const sx = (t.scale[0] ?? 100) / 100;
  const sy = (t.scale[1] ?? t.scale[0] ?? 100) / 100;
  const x = (p[0] - (t.anchor[0] ?? 0)) * sx;
  const y = (p[1] - (t.anchor[1] ?? 0)) * sy;
  const c = Math.cos((t.rotation || 0) * DEG);
  const s = Math.sin((t.rotation || 0) * DEG);
  return [(t.position[0] ?? 0) + x * c - y * s, (t.position[1] ?? 0) + x * s + y * c];
}

/** The other way: a point in the owner's space back into the transformed space. */
export function intoTransform(t: Transform2D, p: P): P {
  const dx = p[0] - (t.position[0] ?? 0);
  const dy = p[1] - (t.position[1] ?? 0);
  const c = Math.cos(-(t.rotation || 0) * DEG);
  const s = Math.sin(-(t.rotation || 0) * DEG);
  const sx = (t.scale[0] ?? 100) / 100 || 1;
  const sy = (t.scale[1] ?? t.scale[0] ?? 100) / 100 || 1;
  return [(dx * c - dy * s) / sx + (t.anchor[0] ?? 0), (dx * s + dy * c) / sy + (t.anchor[1] ?? 0)];
}

/** Where a point of the path lies in the map comp's pixels. */
function toMapPixels(path: DrawnPath, mapLayer: Transform2D | null, p: P): P {
  let q = p;
  for (const t of path.chain) q = throughTransform(t, q);
  return mapLayer ? intoTransform(mapLayer, q) : q;
}

/**
 * The path's outline in map pixels, one point every `step` pixels or so along its curves. The
 * bezier's control points are carried through the transforms (a 2D transform keeps a bezier a
 * bezier), then the curve is cut up where it lies on screen, so a curve looks the same as drawn.
 */
export function samplePath(path: DrawnPath, mapLayer: Transform2D | null, step = 6): P[] {
  const n = path.vertices.length;
  if (n === 0) return [];
  const at = (i: number) => path.vertices[i] as P;
  const vertex = (i: number) => toMapPixels(path, mapLayer, at(i));
  const out: P[] = [vertex(0)];
  const segments = path.closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n;
    const p0 = vertex(i);
    const p1 = toMapPixels(path, mapLayer, [at(i)[0] + (path.outTangents[i]?.[0] ?? 0), at(i)[1] + (path.outTangents[i]?.[1] ?? 0)]);
    const p2 = toMapPixels(path, mapLayer, [at(j)[0] + (path.inTangents[j]?.[0] ?? 0), at(j)[1] + (path.inTangents[j]?.[1] ?? 0)]);
    const p3 = vertex(j);
    const rough = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const count = Math.max(1, Math.min(400, Math.ceil(rough / step)));
    for (let k = 1; k <= count; k++) {
      const t = k / count;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
    }
  }
  // A closed path ends where it began; the ring is closed when it is written out.
  if (path.closed && out.length > 1) out.pop();
  return out;
}

type Feature = { type: "Feature"; properties: { name: string }; geometry: { type: "LineString"; coordinates: number[][] } | { type: "Polygon"; coordinates: number[][][] } };

/**
 * The drawn paths as GeoJSON: a line for every open path, an area for every closed one, in the
 * coordinates of the ground under them at the moment they were read. Steps that fall on the sky or
 * off the globe are left out; a path with too little on the ground is reported instead.
 */
export function drawnPathsToGeoJson(found: DrawnPaths, projection: MapProjection): { collection: { type: "FeatureCollection"; features: Feature[] }; offGround: string[] } {
  const viewport = { width: found.width, height: found.height };
  const features: Feature[] = [];
  const offGround: string[] = [];
  for (const path of found.paths) {
    const pixels = samplePath(path, found.mapLayer);
    const ground: number[][] = [];
    for (const p of pixels) {
      const at = unprojectPoint(found.view, viewport, { x: p[0], y: p[1] }, { projection });
      if (at && Number.isFinite(at.lat) && Number.isFinite(at.lng)) ground.push([round6(at.lng), round6(at.lat)]);
    }
    const least = path.closed ? 3 : 2;
    if (ground.length < least) {
      offGround.push(path.name);
      continue;
    }
    if (path.closed) features.push({ type: "Feature", properties: { name: path.name }, geometry: { type: "Polygon", coordinates: [[...ground, ground[0]]] } });
    else features.push({ type: "Feature", properties: { name: path.name }, geometry: { type: "LineString", coordinates: ground } });
  }
  return { collection: { type: "FeatureCollection", features }, offGround };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
