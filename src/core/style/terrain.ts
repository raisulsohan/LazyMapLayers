// A map's terrain: which downloaded elevation pack it uses and how strongly slopes are shaded.
// Elevation packs are extracts of open elevation tiles (Terrarium encoding) kept in the user data
// folder; a map without a pack, or whose pack is missing on this computer, renders flat.

import type { Theme } from "./themes.ts";

export type TerrainSetting = {
  /** Name of the elevation pack (a file in the user data folder's "terrain"). */
  pack: string;
  /** Strength of the shaded slopes, 0 (none) to 1. */
  shade: number;
  /** 3D terrain: how much the elevation is exaggerated (1 = true to scale); 0 keeps the map flat. */
  height: number;
  /** 3D terrain: the elevation in metres the camera counts from, normally the ground at the map's centre. */
  ground: number;
};

export const DEFAULT_SHADE = 0.55;
export const MAX_HEIGHT = 4;

export function normaliseTerrain(value: unknown): TerrainSetting | null {
  const v = value as Partial<TerrainSetting> | null | undefined;
  if (!v || typeof v !== "object" || typeof v.pack !== "string" || !/^[a-z0-9_-]{1,60}$/.test(v.pack)) return null;
  const finite = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
  const shade = Math.max(0, Math.min(1, finite(v.shade, DEFAULT_SHADE)));
  const height = Math.max(0, Math.min(MAX_HEIGHT, finite(v.height, 0)));
  const ground = Math.max(-500, Math.min(9000, finite(v.ground, 0)));
  return { pack: v.pack, shade: Math.round(shade * 100) / 100, height: Math.round(height * 100) / 100, ground: Math.round(ground) };
}

/** Paint of the shaded slopes for a look: light from the north-west, shadows in the look's own dark tone. */
export function hillshadePaint(theme: Theme, shade: number): Record<string, unknown> {
  return {
    // Full strength is still soft: the map's colours must stay readable on steep ground.
    "hillshade-exaggeration": Math.max(0, Math.min(1, shade)) * 0.65,
    "hillshade-illumination-direction": 315,
    "hillshade-illumination-anchor": "map",
    "hillshade-shadow-color": theme.dark ? "rgba(0, 0, 0, 0.75)" : "rgba(59, 51, 39, 0.85)",
    "hillshade-highlight-color": theme.dark ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.45)",
    "hillshade-accent-color": theme.dark ? "rgba(0, 0, 0, 0.5)" : "rgba(74, 64, 50, 0.6)"
  };
}

/**
 * Where the shaded slopes go in a list of style layers: above the last layer that colours the ground
 * (background, land, imagery) and below everything drawn on it (water, lines, roads, buildings).
 */
export function hillshadeIndex(groups: readonly string[]): number {
  let index = 0;
  groups.forEach((group, i) => {
    if (group === "background" || group === "land" || group === "imagery") index = i + 1;
  });
  return index;
}
