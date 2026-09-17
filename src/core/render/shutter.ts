// Motion blur sampling that matches After Effects' own layer motion blur.
//
// For a frame at time t, AE opens the shutter at t + phase/360 frames and keeps it open for
// angle/360 frames (defaults: angle 180°, phase -90°, so the interval is [-0.25, +0.25] frames).
// The renderer averages evenly spaced samples inside that interval, so a blurred basemap matches the
// blur AE draws on pins and other layers of the same comp.

export type Shutter = {
  /** Degrees, 0 to 720. */
  angle: number;
  /** Degrees, -360 to 360. */
  phase: number;
  /** Number of sub-frame samples; 1 means no blur. */
  samples: number;
};

export const AE_DEFAULT_SHUTTER: Shutter = { angle: 180, phase: -90, samples: 8 };

/** Sample offsets in frames relative to the frame time, in time order. */
export function shutterOffsets(shutter: Shutter): number[] {
  const samples = Math.max(1, Math.floor(shutter.samples));
  const open = Math.max(0, Math.min(720, shutter.angle)) / 360;
  if (samples === 1 || open === 0) return [0];
  const start = shutter.phase / 360;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) out.push(start + ((i + 0.5) / samples) * open);
  return out;
}
