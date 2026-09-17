// When a downloaded region should appear over the world map.
//
// A region file only has tiles inside its bounds. Seen from too far out, its detail would sit on the
// world map as a sharp-edged patch, so its layers fade in once the frame is about as large as the
// region itself (and never before zoom 9.8, where regional detail begins to matter).

import { mercatorXFromLng, mercatorYFromLat } from "../geo/mercator.ts";
import type { Bbox } from "./tileMath.ts";

export const EARLIEST_REGION_ZOOM = 9.8;
export const LATEST_REGION_ZOOM = 13.5;
export const REGION_FADE_LENGTH = 0.8;

export function regionFadeZooms(bounds: Bbox, viewport: { width: number; height: number }): { from: number; to: number } {
  const dx = Math.max(1e-9, mercatorXFromLng(bounds.east) - mercatorXFromLng(bounds.west));
  const dy = Math.max(1e-9, mercatorYFromLat(bounds.south) - mercatorYFromLat(bounds.north));
  const fitsWidth = Math.log2(viewport.width / (dx * 512));
  const fitsHeight = Math.log2(viewport.height / (dy * 512));
  const to = Math.max(EARLIEST_REGION_ZOOM, Math.min(LATEST_REGION_ZOOM, Math.max(fitsWidth, fitsHeight)));
  return { from: to - REGION_FADE_LENGTH, to };
}

export type RegionInfo = { name: string; bounds: Bbox; maxZoom: number };

export type ZoomRamp = { from: number; to: number };

export type RegionTier = {
  /** Where the region's layers fade in. */
  fadeIn: ZoomRamp;
  /**
   * Where the region's detail lines (roads, borders, buildings, labels) fade out because a more
   * detailed region inside it takes over; its land and water stay to fill the far field.
   */
  fadeOut: ZoomRamp | null;
};

const contains = (outer: Bbox, inner: Bbox) => inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;

/** Fade zooms for regions used together, such as a wide region around a city at zoom 12 and the city at zoom 15. */
export function regionTiers(regions: RegionInfo[], viewport: { width: number; height: number }): Record<string, RegionTier> {
  const fadeIns = new Map(regions.map((r) => [r.name, regionFadeZooms(r.bounds, viewport)]));
  const out: Record<string, RegionTier> = {};
  for (const region of regions) {
    const fadeIn = fadeIns.get(region.name)!;
    const inner = regions.filter((other) => other !== region && other.maxZoom > region.maxZoom && contains(region.bounds, other.bounds));
    let fadeOut: ZoomRamp | null = null;
    if (inner.length) {
      const from = Math.min(...inner.map((r) => fadeIns.get(r.name)!.from));
      const to = Math.min(...inner.map((r) => fadeIns.get(r.name)!.to));
      // Never fade out before the region has fully faded in.
      fadeOut = from >= fadeIn.to ? { from, to } : { from: fadeIn.to, to: Math.max(fadeIn.to + 0.3, to) };
    }
    out[region.name] = { fadeIn, fadeOut };
  }
  return out;
}
