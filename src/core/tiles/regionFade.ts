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
