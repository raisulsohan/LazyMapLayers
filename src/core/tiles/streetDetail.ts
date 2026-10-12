// Street detail on demand (DECISIONS D101): which OpenStreetMap tiles the frames of a camera move need,
// and which frames lack some of them.
//
// A map draws the OpenStreetMap pyramid through two sources: the world detail (tiles to zoom 9, its
// layers from zoom 6) and the street detail (tiles to zoom 15, drawn like a region from zoom 9). For
// every frame - every motion blur sample of it - and every source whose layers show at that zoom, the
// tiles are MapLibre's own choice (coveringTiles.ts). Both sources read the same pyramid, so a tile is
// one key "z/x/y" whichever source asks for it.

import type { View, Viewport } from "../camera/camera.ts";
import { GLOBE_TO_MERCATOR, type MapProjection } from "../camera/globe.ts";
import { coveringTiles, tileKey, withRing, type TileId } from "./coveringTiles.ts";

/** The world detail's tiles end here: the full install's pack (D91) holds the world to this zoom. */
export const WORLD_DETAIL_MAX_ZOOM = 9;
/** The street detail's tiles end here (the Protomaps planet's top zoom); MapLibre stretches them past it. */
export const STREET_MAX_ZOOM = 15;
/**
 * Where the street detail fades in: the earliest a region may (D13). Its tiles cover every frame, so
 * there is no patch edge to hide by waiting for the frame to fit inside it.
 */
export const STREET_FADE = { from: 9, to: 9.8 } as const;

/** One source drawn on demand: from which map zoom its layers show, until which, and its top tile zoom. */
export type DetailSource = { id: string; fromZoom: number; untilZoom?: number; maxZoom: number };

export type NeedsOptions = {
  projection?: MapProjection;
  /** 3D terrain is drawn: MapLibre picks tiles from the elevation, so a ring of tiles is added. */
  terrain?: boolean;
  /** The centre's height in metres for a view (the renderer holds it at ground x height with 3D terrain). */
  elevationOf?: (view: View) => number;
};

/**
 * The tiles each frame needs, as sorted "z/x/y" keys. `frames[i]` holds the views of frame i (one, or
 * one per motion blur sample). On a globe below zoom 8, and with 3D terrain, MapLibre chooses from a
 * curved or raised surface: those frames take one more ring of tiles round the flat choice.
 */
export function framesNeeds(frames: View[][], viewport: Viewport, sources: DetailSource[], options: NeedsOptions = {}): string[][] {
  return frames.map((samples) => {
    const keys = new Set<string>();
    for (const view of samples) {
      for (const source of sources) {
        if (view.zoom < source.fromZoom || view.zoom >= (source.untilZoom ?? Infinity)) continue;
        let tiles: TileId[] = coveringTiles(view, viewport, { maxZoom: source.maxZoom, terrain: options.terrain, elevation: options.elevationOf?.(view) ?? 0 });
        const curved = options.projection === "globe" && view.zoom < GLOBE_TO_MERCATOR.to;
        if (curved || options.terrain) tiles = withRing(tiles);
        for (const tile of tiles) keys.add(tileKey(tile));
      }
    }
    return [...keys].sort();
  });
}

/** Every tile any frame needs, once. */
export function allNeeds(perFrame: string[][]): string[] {
  const all = new Set<string>();
  for (const keys of perFrame) for (const key of keys) all.add(key);
  return [...all].sort();
}

/**
 * How much of its detail a frame is drawn with: all of it, the world's detail without the streets, or
 * only what is installed. A frame lacking street tiles still shows the world's zooms 7 to 9 when this
 * computer holds them, rather than falling back to the installed pack.
 */
export type DetailLevel = "full" | "world" | "installed";

export function detailLevels(worldNeeds: string[][], streetNeeds: string[][], has: (key: string) => boolean): DetailLevel[] {
  const known = new Map<string, boolean>();
  const here = (key: string) => {
    let value = known.get(key);
    if (value === undefined) known.set(key, (value = has(key)));
    return value;
  };
  return worldNeeds.map((world, frame) => (!world.every(here) ? "installed" : (streetNeeds[frame] ?? []).every(here) ? "full" : "world"));
}

/** The frames (0-based) that need a tile `has` says is not here. */
export function lackingFrames(perFrame: string[][], has: (key: string) => boolean): number[] {
  const known = new Map<string, boolean>();
  const here = (key: string) => {
    let value = known.get(key);
    if (value === undefined) known.set(key, (value = has(key)));
    return value;
  };
  const out: number[] = [];
  perFrame.forEach((keys, frame) => {
    if (keys.some((key) => !here(key))) out.push(frame);
  });
  return out;
}

export type FrameRange = { from: number; to: number };

/** Runs of consecutive frame numbers. */
export function frameRanges(frames: number[]): FrameRange[] {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const out: FrameRange[] = [];
  for (const frame of sorted) {
    const last = out[out.length - 1];
    if (last && frame === last.to + 1) last.to = frame;
    else out.push({ from: frame, to: frame });
  }
  return out;
}

const seconds = (frame: number, fps: number) => (frame / fps).toFixed(1);

/**
 * The frames in words, numbered from 1 as After Effects counts them in a sequence, with their times:
 * "frames 151-250 (6.0-10.0 s)", "frame 1 (0.0 s) and frames 11-12 (0.4-0.5 s)". At most `limit` runs
 * are named; the rest are counted.
 */
export function describeFrames(frames: number[], fps: number, limit = 4): string {
  const ranges = frameRanges(frames);
  if (!ranges.length) return "no frames";
  const words = ranges.slice(0, limit).map((r) => (r.from === r.to ? `frame ${r.from + 1} (${seconds(r.from, fps)} s)` : `frames ${r.from + 1}-${r.to + 1} (${seconds(r.from, fps)}-${seconds(r.to + 1, fps)} s)`));
  const rest = ranges.slice(limit).reduce((sum, r) => sum + r.to - r.from + 1, 0);
  if (rest) words.push(`${rest} more`);
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The zoom range over which a source's layers show, read from the style's layers that draw from it. */
export function sourceZooms(layers: { source?: unknown; minzoom?: number; maxzoom?: number }[], sourceId: string): { fromZoom: number; untilZoom: number } | null {
  const own = layers.filter((layer) => layer.source === sourceId);
  if (!own.length) return null;
  return { fromZoom: Math.min(...own.map((layer) => layer.minzoom ?? 0)), untilZoom: Math.max(...own.map((layer) => layer.maxzoom ?? 24)) };
}
