// Parts of the frame the names must stay out of: the band where a lower third sits, the bar a logo
// lives in, or the bounds of a layer the user made. Zones are kept as fractions of the frame, so one
// map works at 1080p and at 4K, and they may be limited to the seconds a title is on screen.

import type { Box } from "./placement.ts";

export type KeepOutZone = {
  id: string;
  name: string;
  /** The rectangle in fractions of the frame, from the top left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Seconds from the start of the comp. Null is the whole timeline. */
  from: number | null;
  to: number | null;
};

export type KeepOutPreset = { id: string; name: string; x: number; y: number; width: number; height: number };

/** The places titles usually go. Chosen so a name never sits half under a title. */
export const KEEP_OUT_PRESETS: KeepOutPreset[] = [
  { id: "lower-third", name: "Lower third", x: 0, y: 0.62, width: 1, height: 0.38 },
  { id: "top-bar", name: "Top bar", x: 0, y: 0, width: 1, height: 0.18 },
  { id: "left-third", name: "Left third", x: 0, y: 0, width: 0.34, height: 1 },
  { id: "right-third", name: "Right third", x: 0.66, y: 0, width: 0.34, height: 1 },
  { id: "middle", name: "Middle band", x: 0.12, y: 0.34, width: 0.76, height: 0.32 }
];

/** Enough for a busy frame, few enough that the placement stays quick. */
export const MAX_KEEP_OUT = 12;

const fraction = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 1e4) / 1e4 : fallback);
const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null);

/** Cleans up what a map carries: bad numbers, zones off the frame, duplicates and too many of them. */
export function normaliseKeepOut(value: unknown): KeepOutZone[] {
  const list = Array.isArray(value) ? value : [];
  const out: KeepOutZone[] = [];
  const seen: Record<string, true> = {};
  for (const raw of list) {
    const item = (raw ?? {}) as Partial<KeepOutZone>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 120) : "";
    if (!id || seen[id]) continue;
    const x = fraction(item.x, 0);
    const y = fraction(item.y, 0);
    const width = fraction(item.width, 0);
    const height = fraction(item.height, 0);
    if (width <= 0 || height <= 0 || x >= 1 || y >= 1) continue;
    const from = seconds(item.from);
    const to = seconds(item.to);
    seen[id] = true;
    out.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 120) : id,
      x,
      y,
      width: Math.min(width, 1 - x),
      height: Math.min(height, 1 - y),
      from,
      // A range that ends before it starts is no range at all.
      to: to !== null && from !== null && to <= from ? null : to
    });
    if (out.length >= MAX_KEEP_OUT) break;
  }
  return out;
}

export const hasZone = (zones: KeepOutZone[], id: string) => zones.some((zone) => zone.id === id);

/** Adds a preset, or takes it away when it is already there. */
export function togglePreset(zones: KeepOutZone[], preset: KeepOutPreset): KeepOutZone[] {
  if (hasZone(zones, preset.id)) return zones.filter((zone) => zone.id !== preset.id);
  return normaliseKeepOut([...zones, { ...preset, from: null, to: null }]);
}

/** Adds zones taken from layers, replacing any zone that came from the same layer before. */
export function addZones(zones: KeepOutZone[], added: KeepOutZone[]): KeepOutZone[] {
  const ids = new Set(added.map((zone) => zone.id));
  return normaliseKeepOut([...zones.filter((zone) => !ids.has(zone.id)), ...added]);
}

export type ZoneBox = { id: string; box: Box; fromFrame: number; toFrame: number };

/** The zones in frame pixels, with the frames they hold for. */
export function zoneBoxes(zones: KeepOutZone[], viewport: { width: number; height: number }, frameRate: number, frames: number): ZoneBox[] {
  return zones.map((zone) => ({
    id: zone.id,
    box: {
      x: Math.round(zone.x * viewport.width),
      y: Math.round(zone.y * viewport.height),
      width: Math.round(zone.width * viewport.width),
      height: Math.round(zone.height * viewport.height)
    },
    fromFrame: zone.from === null ? 0 : Math.max(0, Math.round(zone.from * frameRate)),
    toFrame: zone.to === null ? frames : Math.min(frames, Math.round(zone.to * frameRate))
  }));
}

/** The boxes that hold on one frame. */
export const zonesOnFrame = (boxes: ZoneBox[], frame: number): Box[] => boxes.filter((zone) => frame >= zone.fromFrame && frame < zone.toFrame).map((zone) => zone.box);
