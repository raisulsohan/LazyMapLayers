// How the layers the panel generates look: pins, routes, callouts and outlines. The map's look sets
// them (a gold route on Midnight, ink red on Paper), and a map can override any of it — by hand in the
// panel, or by picking the style up from a layer the user styled themselves.

import { hexToRgb, mixHex, type Rgb, type Theme } from "./themes.ts";

export type LayerStyleOverride = {
  /** Lines, pins and outlines. Null follows the map's look. */
  accent: string | null;
  /** Stroke width in 1080-line pixels (scaled to the comp). Null follows the look. */
  stroke: number | null;
  /** A soft glow around lines and outlines. Null follows the look (on for dark maps). */
  glow: boolean | null;
};

export type LayerStyle = {
  accent: string;
  /** Behind text: the callout box. */
  panel: string;
  text: string;
  textSoft: string;
  stroke: number;
  glow: boolean;
};

export const NO_OVERRIDE: LayerStyleOverride = { accent: null, stroke: null, glow: null };

const HEX = /^#[0-9a-f]{6}$/i;

export function normaliseLayerStyle(value: unknown): LayerStyleOverride {
  const v = (value ?? {}) as Partial<LayerStyleOverride>;
  const stroke = typeof v.stroke === "number" && Number.isFinite(v.stroke) ? Math.max(0, Math.min(40, v.stroke)) : null;
  return {
    accent: typeof v.accent === "string" && HEX.test(v.accent) ? v.accent.toLowerCase() : null,
    stroke: stroke === null ? null : Math.round(stroke * 10) / 10,
    glow: typeof v.glow === "boolean" ? v.glow : null
  };
}

/** The style a map's layers really get: the look's, with whatever the user overrode. */
export function resolveLayerStyle(theme: Theme, override: LayerStyleOverride = NO_OVERRIDE): LayerStyle {
  const accent = override.accent ?? theme.accent;
  return {
    accent,
    // A callout box sits on the map, so it takes the map's own darkness, not the accent.
    panel: theme.dark ? mixHex(theme.ocean, "#000000", 0.35) : "#ffffff",
    text: theme.dark ? theme.text : "#16202b",
    textSoft: theme.dark ? mixHex(theme.text, theme.accent, 0.45) : mixHex("#16202b", accent, 0.35),
    stroke: override.stroke ?? 4,
    // Glow reads on dark maps and muddies light ones.
    glow: override.glow ?? theme.dark
  };
}

/** After Effects wants colours as 0..1 triples. */
export const styleRgb = (hex: string): Rgb => hexToRgb(hex);

/** True when nothing is overridden, so the layers follow the look. */
export const followsTheLook = (override: LayerStyleOverride) => override.accent === null && override.stroke === null && override.glow === null;
