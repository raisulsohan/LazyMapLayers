// Easing curves for camera moves: cubic Béziers from (0,0) to (1,1), like After Effects' speed graph
// and CSS timing functions, with a small set of named presets for the shot list.

/** A CSS/After Effects style cubic Bézier easing from (0,0) to (1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const dx = (t: number) => 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton steps, then bisection if the slope is too flat.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = bx(t) - x;
      const slope = dx(t);
      if (Math.abs(err) < 1e-9) return by(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60; i++) {
      const v = bx(t);
      if (Math.abs(v - x) < 1e-9) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return by(t);
  };
}

/** After Effects' Easy Ease (33.33 % influence on both keys). */
export const easyEase = cubicBezier(1 / 3, 0, 2 / 3, 1);

export type Bezier = [number, number, number, number];

export const EASING_IDS = ["linear", "smooth", "cinematic", "softStart", "softLanding", "snappy", "custom"] as const;
export type EasingId = (typeof EASING_IDS)[number];

/** A preset, or "custom" with its own control points. */
export type Easing = { id: EasingId; bezier?: Bezier };

export const EASING_PRESETS: Record<Exclude<EasingId, "custom">, { label: string; hint: string; bezier: Bezier }> = {
  linear: { label: "Linear", hint: "Constant speed", bezier: [0, 0, 1, 1] },
  smooth: { label: "Smooth", hint: "Easy Ease at both ends", bezier: [1 / 3, 0, 2 / 3, 1] },
  cinematic: { label: "Cinematic", hint: "Long, gentle start and landing", bezier: [0.65, 0, 0.35, 1] },
  softStart: { label: "Soft start", hint: "Starts gently, arrives at speed (for cuts and hand-overs)", bezier: [0.55, 0, 1, 1] },
  softLanding: { label: "Soft landing", hint: "Leaves at speed, settles gently", bezier: [0, 0, 0.4, 1] },
  snappy: { label: "Snappy", hint: "Quick move with a long settle", bezier: [0.2, 0.85, 0.25, 1] }
};

export const DEFAULT_EASING: Easing = { id: "smooth" };

/** Control points of an easing; x values are clamped to [0, 1] so the curve stays a function of time. */
export function easingBezier(easing: Easing | undefined): Bezier {
  const e = easing ?? DEFAULT_EASING;
  const raw = e.id === "custom" ? e.bezier ?? EASING_PRESETS.smooth.bezier : EASING_PRESETS[e.id]?.bezier ?? EASING_PRESETS.smooth.bezier;
  const unit = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  const y = (v: number, fallback: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(2, v)) : fallback);
  return [unit(raw[0]), y(raw[1], 0), unit(raw[2]), y(raw[3], 1)];
}

const cache = new Map<string, (t: number) => number>();

export function easingFunction(easing: Easing | undefined): (t: number) => number {
  const b = easingBezier(easing);
  const key = b.join(",");
  let fn = cache.get(key);
  if (!fn) {
    fn = b[0] === b[1] && b[2] === b[3] ? (t: number) => Math.max(0, Math.min(1, t)) : cubicBezier(b[0], b[1], b[2], b[3]);
    cache.set(key, fn);
  }
  return fn;
}
