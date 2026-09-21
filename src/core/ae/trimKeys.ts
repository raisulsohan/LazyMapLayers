// Trim Paths keys for lines that draw on: the head, and the tail of a comet that chases it.

/** How much of the line the comet's bright head covers. */
export const COMET_TAIL_PERCENT = 12;

/** Trim Start keys that follow the Trim End keys a tail behind, so the head keeps its length. */
export function cometTailKeys(keys: [number, number][], tail = COMET_TAIL_PERCENT): [number, number][] {
  return keys.map(([frame, value]) => [frame, Math.max(0, Math.min(100, value - tail))]);
}
