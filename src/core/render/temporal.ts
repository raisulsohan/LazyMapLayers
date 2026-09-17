// Temporal checks on rendered sequences: finds "pops", frames where the picture jumps much more than
// the motion around it explains (tiles or features appearing at once, missing tiles, flicker).

/** Mean absolute RGB difference between two RGBA8 images of equal size, sampling every `step` pixel. */
export function meanAbsDifference(a: Uint8Array, b: Uint8Array, step = 1): number {
  if (a.length !== b.length) throw new Error("images differ in size");
  let sum = 0;
  let count = 0;
  const stride = 4 * Math.max(1, Math.floor(step));
  for (let i = 0; i < a.length; i += stride) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    count += 3;
  }
  return count ? sum / count : 0;
}

export type Pop = { frame: number; difference: number; expected: number };

/**
 * `differences[i]` is the change from frame i to frame i + 1. A pop at frame i + 1 is a change that
 * is `ratio` times larger than the median change in the `window` changes on each side, and at least
 * `floor`. Steady motion changes every frame by a similar amount, so it never counts. A move that
 * starts after a hold has large changes on one side, which lifts the median, so it does not count
 * either. A one-frame flash gives two neighbouring spikes; the median ignores both.
 */
export function findPops(differences: number[], options: { ratio?: number; floor?: number; window?: number } = {}): Pop[] {
  const ratio = options.ratio ?? 3;
  const floor = options.floor ?? 0.5;
  const window = options.window ?? 3;
  const pops: Pop[] = [];
  for (let i = 0; i < differences.length; i++) {
    const around: number[] = [];
    for (let j = Math.max(0, i - window); j <= Math.min(differences.length - 1, i + window); j++) if (j !== i) around.push(differences[j]);
    if (!around.length) continue;
    around.sort((x, y) => x - y);
    const mid = around.length >> 1;
    const expected = around.length % 2 ? around[mid] : (around[mid - 1] + around[mid]) / 2;
    const d = differences[i];
    if (d >= floor && d > ratio * expected) pops.push({ frame: i + 1, difference: d, expected });
  }
  return pops;
}
