// Numbers as spikes on the map: the height of a spike stands for the value and is read straight (a
// spike twice as tall is worth twice as much), which shows small differences more plainly than the
// area of a circle does. Core works out the heights and the sizes the legend shows; the panel places
// them, and every spike rises straight up the frame from its place.

import type { BubblePlace } from "./bubbles.ts";
import { formatValue } from "./valueScale.ts";

export type SpikeOptions = {
  /** The tallest spike, in 1080-line pixels. */
  maxHeight?: number;
  /** The shortest a value may draw, so a tiny number still shows. */
  minHeight?: number;
  /** The width of every spike's base, in 1080-line pixels. */
  width?: number;
  /** Comp height in pixels; the sizes scale with it. */
  height?: number;
  /** Spikes beyond this many are left out, largest first. */
  limit?: number;
};

export const DEFAULT_MAX_HEIGHT = 160;
export const DEFAULT_MIN_HEIGHT = 3;
export const DEFAULT_SPIKE_WIDTH = 12;
export const DEFAULT_SPIKE_LIMIT = 200;

export type SpikePlace = BubblePlace;
export type Spike = SpikePlace & { height: number };

export type SpikeSet = {
  spikes: Spike[];
  /** The width of every base, in comp pixels. */
  width: number;
  /** The value the tallest spike stands for. */
  top: number;
  /** Places left out by the limit. */
  dropped: number;
  /** Three heights for a legend: the tallest, half of it and a quarter. */
  legend: { value: number; height: number; label: string }[];
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The spikes of a set of places. Values of zero or less draw nothing: a spike cannot show "none",
 * and a sliver of no height would only be noise.
 */
export function spikeSet(places: SpikePlace[], options: SpikeOptions = {}): SpikeSet {
  const scale = Math.max(0.2, (options.height ?? 1080) / 1080);
  const maxHeight = (options.maxHeight ?? DEFAULT_MAX_HEIGHT) * scale;
  const minHeight = Math.min((options.minHeight ?? DEFAULT_MIN_HEIGHT) * scale, maxHeight);
  const width = (options.width ?? DEFAULT_SPIKE_WIDTH) * scale;
  const limit = Math.max(1, Math.round(options.limit ?? DEFAULT_SPIKE_LIMIT));
  const usable = places.filter((place) => Number.isFinite(place.value) && place.value > 0 && Number.isFinite(place.lat) && Number.isFinite(place.lng)).sort((a, b) => b.value - a.value);
  const top = usable[0]?.value ?? 0;
  const kept = usable.slice(0, limit);
  const heightFor = (value: number) => (top > 0 ? Math.max(minHeight, (value / top) * maxHeight) : minHeight);
  const spikes = kept.map((place) => ({ ...place, height: round(heightFor(place.value)) }));
  const legend = [1, 0.5, 0.25]
    .map((share) => top * share)
    .filter((value, index, all) => value > 0 && all.indexOf(value) === index)
    .map((value) => ({ value, height: round(heightFor(value)), label: formatValue(value) }));
  return { spikes, width: round(width), top, dropped: usable.length - kept.length, legend };
}
