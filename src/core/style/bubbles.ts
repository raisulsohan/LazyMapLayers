// Numbers as circles on the map: the area of a bubble stands for the value, which is the honest way
// to read one (a circle twice as wide looks four times as big, so the radius follows the square
// root). Core works out the radii and the sizes the legend shows; the panel places them.

import { formatValue } from "./valueScale.ts";

export type BubbleOptions = {
  /** The biggest bubble, in 1080-line pixels. */
  maxRadius?: number;
  /** The smallest bubble a value may draw, so a tiny number is still visible. */
  minRadius?: number;
  /** Comp height in pixels; the radii scale with it. */
  height?: number;
  /** Bubbles beyond this many are left out, largest first. */
  limit?: number;
};

export const DEFAULT_MAX_RADIUS = 44;
export const DEFAULT_MIN_RADIUS = 4;
export const DEFAULT_BUBBLE_LIMIT = 60;

export type BubblePlace = { id: string; name: string; lat: number; lng: number; value: number };
export type Bubble = BubblePlace & { radius: number };

export type BubbleSet = {
  bubbles: Bubble[];
  /** The value the largest bubble stands for. */
  top: number;
  /** Places left out by the limit. */
  dropped: number;
  /** Three sizes for a legend: the largest, a middle one and a small one. */
  legend: { value: number; radius: number; label: string }[];
};

/**
 * The bubbles of a set of places. Values of zero or less draw nothing: a circle cannot show "none",
 * and a dot of no size would only be noise.
 */
export function bubbleSet(places: BubblePlace[], options: BubbleOptions = {}): BubbleSet {
  const scale = Math.max(0.2, (options.height ?? 1080) / 1080);
  const maxRadius = (options.maxRadius ?? DEFAULT_MAX_RADIUS) * scale;
  const minRadius = Math.min((options.minRadius ?? DEFAULT_MIN_RADIUS) * scale, maxRadius);
  const limit = Math.max(1, Math.round(options.limit ?? DEFAULT_BUBBLE_LIMIT));
  const usable = places.filter((place) => Number.isFinite(place.value) && place.value > 0 && Number.isFinite(place.lat) && Number.isFinite(place.lng)).sort((a, b) => b.value - a.value);
  const top = usable[0]?.value ?? 0;
  const kept = usable.slice(0, limit);
  const radiusFor = (value: number) => (top > 0 ? Math.max(minRadius, Math.sqrt(value / top) * maxRadius) : minRadius);
  const bubbles = kept.map((place) => ({ ...place, radius: Math.round(radiusFor(place.value) * 100) / 100 }));
  // A legend of three: the largest, a quarter of it and a sixteenth, which are half and a quarter as wide.
  const legend = [1, 0.25, 1 / 16]
    .map((share) => top * share)
    .filter((value, index, all) => value > 0 && all.indexOf(value) === index)
    .map((value) => ({ value, radius: Math.round(radiusFor(value) * 100) / 100, label: formatValue(value) }));
  return { bubbles, top, dropped: usable.length - kept.length, legend };
}
