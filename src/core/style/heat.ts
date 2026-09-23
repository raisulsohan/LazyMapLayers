// Numbers as heat on the map: every point warms the map around it by its weight, and the warmth of
// a spot is drawn in the colours of the ramp, with nothing where there is none. The renderer draws
// the heat itself, as one layer of its own, so a table of thousands of points reaches After Effects
// as a single image sequence that follows the camera.

import { fromHex, mix, toHex } from "./palette.ts";
import { rampById, type RampId } from "./valueScale.ts";

/** The code the heat layer carries, where a highlight carries a country code or an area id. */
export const HEAT_CODE = "HEAT";
/** Points beyond this many are left out, heaviest first: the setting lives in the map layer's comment. */
export const MAX_HEAT_POINTS = 5000;

/** [longitude, latitude, weight]; weights are relative to one another. */
export type HeatPoint = [number, number, number];

export type HeatSetting = {
  /** What the points are about: the layer's name. */
  column: string;
  points: HeatPoint[];
  /** How far a point's warmth reaches, in 1080-line pixels. */
  radius: number;
  /** How strongly the points add up (1 is the renderer's own). */
  intensity: number;
  ramp: RampId;
  /** 0 to 1. */
  opacity: number;
  /** The ramp the other way round: on a dark map the warmest spot should be the palest, not the deepest. */
  reverse: boolean;
};

export const DEFAULT_HEAT = { radius: 40, intensity: 1, ramp: "warm" as RampId, opacity: 0.85, reverse: false };

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * The points of a heat map from places with numbers (a place without one counts 1). Values of zero
 * or less warm nothing and are left out; the heaviest points are kept when there are too many.
 */
export function heatPoints(places: { lat: number; lng: number; value?: number }[]): HeatPoint[] {
  const usable: HeatPoint[] = [];
  for (const place of places) {
    const weight = place.value === undefined ? 1 : place.value;
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng) || Math.abs(place.lat) > 90) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    usable.push([round(place.lng), round(place.lat), weight]);
  }
  usable.sort((a, b) => b[2] - a[2]);
  return usable.slice(0, MAX_HEAT_POINTS);
}

/** What a map carries, repaired: a heat map without a single usable point is no heat map. */
export function normaliseHeat(raw: unknown): HeatSetting | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<HeatSetting>;
  const points: HeatPoint[] = [];
  for (const point of Array.isArray(source.points) ? source.points : []) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const [lng, lat, weight] = point.map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(weight) || weight <= 0) continue;
    points.push([lng, lat, weight]);
    if (points.length >= MAX_HEAT_POINTS) break;
  }
  if (!points.length) return null;
  const number = (value: unknown, fallback: number, min: number, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);
  return {
    column: typeof source.column === "string" && source.column.trim() ? source.column.trim().slice(0, 80) : "Points",
    points,
    radius: number(source.radius, DEFAULT_HEAT.radius, 4, 300),
    intensity: number(source.intensity, DEFAULT_HEAT.intensity, 0.1, 10),
    ramp: rampById(source.ramp).id,
    opacity: number(source.opacity, DEFAULT_HEAT.opacity, 0, 1),
    reverse: source.reverse === true
  };
}

export type HeatFeatures = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { w: number }; geometry: { type: "Point"; coordinates: [number, number] } }[];
};

/** The points as the renderer's heat layer reads them, each weight scaled so the heaviest is 1. */
export function heatFeatures(setting: HeatSetting): HeatFeatures {
  const heaviest = setting.points.reduce((most, point) => Math.max(most, point[2]), 0) || 1;
  return {
    type: "FeatureCollection",
    features: setting.points.map(([lng, lat, weight]) => ({
      type: "Feature",
      properties: { w: Math.round((weight / heaviest) * 1e4) / 1e4 },
      geometry: { type: "Point", coordinates: [lng, lat] }
    }))
  };
}

const withAlpha = (hex: string, alpha: number) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * The colour of every density of warmth, from none (see-through) through the ramp's pale end to its
 * deep one; turned over, the deep end fades in and the pale end is the warmest, which reads on a
 * dark map.
 */
export function heatColorStops(ramp: RampId, reverse: boolean): [number, string][] {
  const stops = [...rampById(ramp).stops];
  if (reverse) stops.reverse();
  return [
    [0, withAlpha(stops[0], 0)],
    [0.12, withAlpha(stops[0], 0.7)],
    [0.5, stops[1]],
    [1, stops[2]]
  ];
}

/** Three steps for a legend of the heat - low, medium, high - in the ramp's colours (turned over with it). */
export function heatLegendColors(ramp: RampId, reverse: boolean): { color: string; label: string }[] {
  const stops = [...rampById(ramp).stops];
  if (reverse) stops.reverse();
  return [
    { color: toHex(mix(fromHex(stops[0]), fromHex(stops[1]), 0.5)), label: "Low" },
    { color: stops[1], label: "Medium" },
    { color: stops[2], label: "High" }
  ];
}

/** What the sheet and the log say about a heat map. */
export const describeHeat = (setting: HeatSetting): string => `${setting.points.length} ${setting.points.length === 1 ? "place warms" : "places warm"} the map by ${setting.column}, each reaching ${setting.radius} px`;
