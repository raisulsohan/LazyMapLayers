// Painting one map tile from satellite scenes.
//
// Every pixel of the tile stands on a place; each scene is asked, clearest first, what it has there.
// A pixel is taken from the first scene that has real ground at that place - not cloud, not cloud
// shadow, not the black edge of a scene - so a cloudy day is filled in by the next pass over the same
// ground.
//
// The asking is a plain function call, not a request: the panel downloads the pieces of each scene
// that the tile needs before it starts, because a tile is 65,536 pixels and waiting on each of them
// would take longer than the download.

import { classIsClear, pixelToSceneGrid } from "./sentinel.ts";
import type { UtmZone } from "../geo/utm.ts";

/** What one scene can answer about a place on its own grid, with everything already to hand. */
export type SceneSampler = {
  grid: UtmZone;
  /** The scene's colour there, or null when the place is off the picture. */
  colour: (x: number, y: number) => Uint8Array | null;
  /** Sentinel-2's own classification there, or null when the scene carries none. */
  kind?: ((x: number, y: number) => number | null) | null;
};

export type PaintedTile = { painted: number; used: number[]; total: number };

/**
 * One scene's turn at a tile: every pixel still empty is taken from this scene where it has real
 * ground. Returns how many were painted, which is what tells a build whether to open another scene.
 */
export function paintPass(z: number, x: number, y: number, tileSize: number, scene: SceneSampler, rgba: Uint8ClampedArray): number {
  let painted = 0;
  for (let py = 0; py < tileSize; py++) {
    for (let px = 0; px < tileSize; px++) {
      const at = (py * tileSize + px) * 4;
      if (rgba[at + 3] === 255) continue;
      const ground = pixelToSceneGrid(z, x, y, px + 0.5, py + 0.5, tileSize, scene.grid);
      const colour = scene.colour(ground.x, ground.y);
      // The black edge of a scene is no picture at all.
      if (!colour || colour.length < 3 || (colour[0] === 0 && colour[1] === 0 && colour[2] === 0)) continue;
      if (scene.kind) {
        const kind = scene.kind(ground.x, ground.y);
        if (kind !== null && kind !== undefined && !classIsClear(kind)) continue;
      }
      rgba[at] = colour[0];
      rgba[at + 1] = colour[1];
      rgba[at + 2] = colour[2];
      rgba[at + 3] = 255;
      painted++;
    }
  }
  return painted;
}

/** Every scene in turn until the tile is full. */
export function paintSatelliteTile(z: number, x: number, y: number, tileSize: number, scenes: SceneSampler[], rgba: Uint8ClampedArray): PaintedTile {
  const total = tileSize * tileSize;
  rgba.fill(0);
  let painted = 0;
  const used: number[] = [];
  for (let s = 0; s < scenes.length && painted < total; s++) {
    const added = paintPass(z, x, y, tileSize, scenes[s], rgba);
    if (added) used.push(s);
    painted += added;
  }
  return { painted, used, total };
}
