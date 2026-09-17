// Pixel operations on premultiplied RGBA8 buffers, as WebGL's readPixels returns them. Filtering and
// averaging happen in premultiplied space, which is the correct space for edges with alpha.

/**
 * Box-filters a supersampled image down by an integer factor. Columns and rows that do not fill a
 * whole box at the right or bottom edge are dropped.
 */
export function downsampleBox(src: Uint8Array, width: number, height: number, factor: number): { rgba: Uint8Array; width: number; height: number } {
  if (factor === 1) return { rgba: src, width, height };
  const outW = Math.floor(width / factor);
  const outH = Math.floor(height / factor);
  const out = new Uint8Array(outW * outH * 4);
  const area = factor * factor;
  const half = area >> 1;
  const sums = new Uint32Array(4);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      sums[0] = sums[1] = sums[2] = sums[3] = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((oy * factor + dy) * width + ox * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          sums[0] += src[i];
          sums[1] += src[i + 1];
          sums[2] += src[i + 2];
          sums[3] += src[i + 3];
        }
      }
      const o = (oy * outW + ox) * 4;
      out[o] = ((sums[0] + half) / area) | 0;
      out[o + 1] = ((sums[1] + half) / area) | 0;
      out[o + 2] = ((sums[2] + half) / area) | 0;
      out[o + 3] = ((sums[3] + half) / area) | 0;
    }
  }
  return { rgba: out, width: outW, height: outH };
}

/** Running sum of premultiplied samples (up to 257 samples of 8-bit values). */
export class SampleAccumulator {
  readonly length: number;
  readonly sum: Uint16Array;
  count = 0;

  constructor(length: number) {
    this.length = length;
    this.sum = new Uint16Array(length);
  }

  add(sample: Uint8Array): void {
    if (sample.length !== this.length) throw new Error(`sample has ${sample.length} bytes, expected ${this.length}`);
    if (this.count >= 257) throw new Error("too many samples for a 16-bit accumulator");
    const sum = this.sum;
    for (let i = 0; i < sample.length; i++) sum[i] += sample[i];
    this.count++;
  }

  /** Rounded mean of all samples. */
  mean(): Uint8Array {
    if (this.count === 0) throw new Error("no samples");
    const out = new Uint8Array(this.length);
    const n = this.count;
    const half = n >> 1;
    for (let i = 0; i < this.length; i++) out[i] = ((this.sum[i] + half) / n) | 0;
    return out;
  }
}
