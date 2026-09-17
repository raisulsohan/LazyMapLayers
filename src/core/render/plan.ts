// Render settings, output geometry and per-frame cache keys.

import type { View } from "../camera/camera.ts";
import { keyOf, RENDERER_VERSION } from "./frameKey.ts";
import { PASS_IDS, isPassId, type PassId } from "./passes.ts";
import { shutterOffsets, type Shutter } from "./shutter.ts";

export type RenderQuality = "preview" | "final";

export type RenderSettings = {
  /** Output size relative to the map comp. */
  scale: number;
  /** Supersampling factor per axis, 1 to 4. */
  supersample: number;
  motionBlur: boolean;
  /** Sub-frame samples when motion blur is on, 2 to 64. */
  motionBlurSamples: number;
  /** Always contains "base". */
  passes: PassId[];
  /** Draw the renderer's own labels into the base pass (not frame-stable; for previews). */
  labels: boolean;
};

export const PREVIEW_SETTINGS: RenderSettings = { scale: 0.5, supersample: 1, motionBlur: false, motionBlurSamples: 8, passes: ["base"], labels: false };
export const DEFAULT_FINAL_SETTINGS: RenderSettings = { scale: 1, supersample: 2, motionBlur: false, motionBlurSamples: 8, passes: ["base"], labels: false };

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
};

/** Cleans settings from storage or the UI: clamps numbers, drops unknown passes, keeps pass order. */
export function normaliseSettings(input: Partial<RenderSettings> | null | undefined, fallback: RenderSettings = DEFAULT_FINAL_SETTINGS): RenderSettings {
  const s = input ?? {};
  const scale = typeof s.scale === "number" && s.scale > 0 && s.scale <= 1 ? s.scale : fallback.scale;
  const requested = new Set((Array.isArray(s.passes) ? s.passes : fallback.passes).filter((p): p is PassId => typeof p === "string" && isPassId(p)));
  requested.add("base");
  return {
    scale,
    supersample: clampInt(s.supersample, 1, 4, fallback.supersample),
    motionBlur: typeof s.motionBlur === "boolean" ? s.motionBlur : fallback.motionBlur,
    motionBlurSamples: clampInt(s.motionBlurSamples, 2, 64, fallback.motionBlurSamples),
    passes: PASS_IDS.filter((p) => requested.has(p)),
    labels: typeof s.labels === "boolean" ? s.labels : fallback.labels
  };
}

/** WebGL allows 16384 px per side; the pixel cap keeps GPU memory near 1.5 GB (4K at 3x supersampling). */
export const CANVAS_LIMITS = { maxCanvasSide: 16384, maxCanvasPixels: 75_000_000 };

export type OutputGeometry = {
  /** Output frame size. */
  width: number;
  height: number;
  /** Supersampling actually used (lowered when the canvas would exceed the limits). */
  supersample: number;
  /** Canvas size, output size times supersample. */
  canvasWidth: number;
  canvasHeight: number;
  /** MapLibre pixelRatio for a container of comp size. */
  pixelRatio: number;
};

/**
 * Output and canvas sizes for a comp. The MapLibre container keeps comp size (so the geographic
 * extent is unchanged) and pixelRatio sets the resolution; MapLibre sizes the canvas as
 * floor(container * pixelRatio), so the ratio gets a tiny upward nudge against rounding down.
 */
export function outputGeometry(
  comp: { width: number; height: number },
  scale: number,
  supersample: number,
  limits: { maxCanvasSide: number; maxCanvasPixels: number } = CANVAS_LIMITS
): OutputGeometry {
  const width = Math.max(1, Math.round(comp.width * scale));
  const height = Math.max(1, Math.round(comp.height * scale));
  let ss = Math.max(1, Math.floor(supersample));
  while (ss > 1 && (width * ss > limits.maxCanvasSide || height * ss > limits.maxCanvasSide || width * ss * height * ss > limits.maxCanvasPixels)) ss--;
  const pixelRatio = (width * ss + 1e-4) / comp.width;
  return { width, height, supersample: ss, canvasWidth: Math.floor(comp.width * pixelRatio), canvasHeight: Math.floor(comp.height * pixelRatio), pixelRatio };
}

/** Sub-frame offsets for the settings (one zero offset without motion blur). */
export function sampleOffsets(settings: RenderSettings, shutter: { angle: number; phase: number }): number[] {
  if (!settings.motionBlur) return [0];
  const s: Shutter = { angle: shutter.angle, phase: shutter.phase, samples: settings.motionBlurSamples };
  return shutterOffsets(s);
}

export type FrameKeyContext = {
  /** Fingerprint of the style (see styleFingerprint in the panel). */
  style: string;
  /** Fingerprint of the data archives (path, size and modification time). */
  data: string;
  width: number;
  height: number;
  supersample: number;
  labels: boolean;
};

/** True when every sample view is the same camera (a held frame renders once, without blur work). */
export function isStill(views: View[]): boolean {
  const a = views[0];
  return views.every((v) => v.center.lat === a.center.lat && v.center.lng === a.center.lng && v.zoom === a.zoom && v.bearing === a.bearing && v.pitch === a.pitch);
}

/** Cache key of one pass of one frame. Identical cameras and settings give identical keys. */
export function frameKey(context: FrameKeyContext, pass: PassId, views: View[], timeMs: number): string {
  const cameras = (isStill(views) ? [views[0]] : views).map((v) => [v.center.lat, v.center.lng, v.zoom, v.bearing, v.pitch]);
  return keyOf({
    renderer: RENDERER_VERSION,
    ...context,
    pass,
    cameras,
    // Renderer labels depend on time and on earlier frames; keying them by time is the best we can do.
    time: context.labels && pass === "base" ? timeMs : null
  });
}

export function sequenceFileName(frame: number): string {
  return `frame_${String(frame).padStart(5, "0")}.png`;
}
