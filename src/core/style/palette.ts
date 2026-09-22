// Colours out of a picture, and the arithmetic that keeps a map readable: a designer drops a still
// from the film in, and the map takes its palette. Median cut over a small histogram, which is
// deterministic - the same picture always gives the same palette, so a look can be rebuilt.

export type Rgb = [number, number, number];

const BUCKET_BITS = 5;
const BUCKETS = 1 << BUCKET_BITS;

export const toHex = (rgb: Rgb): string => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export const fromHex = (hex: string): Rgb => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** How light a colour looks, 0 to 1 (the luminance a screen shows, not the average of the channels). */
export function luminance(rgb: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** The contrast between two colours, 1 (none) to 21 (black on white). Text needs about 4.5. */
export function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** How colourful it is, 0 (grey) to 1. */
export const saturation = (rgb: Rgb): number => {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max === 0 ? 0 : (max - min) / max;
};

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The colour moved towards white or black until it reads on `against`. It goes away from the
 * background first, and tries the other way when that cannot reach - on a mid grey, white never
 * does, while black does.
 */
export function readableOn(colour: Rgb, against: Rgb, want = 4.5): Rgb {
  if (contrast(colour, against) >= want) return colour;
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  const ways: Rgb[] = luminance(against) > 0.35 ? [black, white] : [white, black];
  let best = colour;
  let bestContrast = contrast(colour, against);
  for (const towards of ways) {
    for (let step = 1; step <= 20; step++) {
      const candidate = mix(colour, towards, step / 20);
      const reached = contrast(candidate, against);
      if (reached >= want) return candidate;
      if (reached > bestContrast) {
        best = candidate;
        bestContrast = reached;
      }
    }
  }
  return best;
}

type Box = { pixels: Rgb[]; count: number };

const spread = (pixels: Rgb[], channel: number) => {
  let min = 255;
  let max = 0;
  for (const pixel of pixels) {
    if (pixel[channel] < min) min = pixel[channel];
    if (pixel[channel] > max) max = pixel[channel];
  }
  return max - min;
};

function splitBox(box: Box): [Box, Box] | null {
  if (box.pixels.length < 2) return null;
  const channel = [0, 1, 2].reduce((widest, c) => (spread(box.pixels, c) > spread(box.pixels, widest) ? c : widest), 0);
  const sorted = [...box.pixels].sort((a, b) => a[channel] - b[channel]);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted.slice(0, middle);
  const right = sorted.slice(middle);
  if (!left.length || !right.length) return null;
  return [
    { pixels: left, count: left.length },
    { pixels: right, count: right.length }
  ];
}

/**
 * The colours a picture is made of, most common first. Pixels are rounded into a histogram, so the
 * work does not grow with the size of the picture, and nearly transparent pixels are ignored.
 */
export function palette(rgba: Uint8Array | Uint8ClampedArray | number[], count = 6): string[] {
  const wanted = Math.max(1, Math.min(16, Math.round(count)));
  const histogram = new Map<number, number>();
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    if (rgba[at + 3] < 128) continue;
    const key = ((rgba[at] >> (8 - BUCKET_BITS)) << (BUCKET_BITS * 2)) | ((rgba[at + 1] >> (8 - BUCKET_BITS)) << BUCKET_BITS) | (rgba[at + 2] >> (8 - BUCKET_BITS));
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  if (!histogram.size) return [];
  const step = 256 / BUCKETS;
  const pixels: Rgb[] = [];
  const weights: number[] = [];
  for (const [key, weight] of histogram) {
    const r = ((key >> (BUCKET_BITS * 2)) & (BUCKETS - 1)) * step + step / 2;
    const g = ((key >> BUCKET_BITS) & (BUCKETS - 1)) * step + step / 2;
    const b = (key & (BUCKETS - 1)) * step + step / 2;
    pixels.push([r, g, b]);
    weights.push(weight);
  }
  const weightOf = new Map(pixels.map((pixel, index) => [pixel, weights[index]]));
  let boxes: Box[] = [{ pixels, count: pixels.reduce((total, pixel) => total + (weightOf.get(pixel) ?? 1), 0) }];
  while (boxes.length < wanted) {
    // Split the box that stands for the most pixels and can still be split.
    const order = [...boxes].sort((a, b) => b.count - a.count);
    const next = order.find((box) => splitBox(box));
    if (!next) break;
    const parts = splitBox(next)!;
    boxes = boxes.filter((box) => box !== next).concat(
      parts.map((part) => ({ pixels: part.pixels, count: part.pixels.reduce((total, pixel) => total + (weightOf.get(pixel) ?? 1), 0) }))
    );
  }
  return boxes
    .map((box) => {
      let total = 0;
      const sum: Rgb = [0, 0, 0];
      for (const pixel of box.pixels) {
        const weight = weightOf.get(pixel) ?? 1;
        total += weight;
        sum[0] += pixel[0] * weight;
        sum[1] += pixel[1] * weight;
        sum[2] += pixel[2] * weight;
      }
      return { colour: [sum[0] / total, sum[1] / total, sum[2] / total] as Rgb, count: total };
    })
    .sort((a, b) => b.count - a.count)
    .map((entry) => toHex(entry.colour));
}
