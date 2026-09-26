// Flows as After Effects layers: one great-circle arc per row of a "from, to, how much" table, its
// width following the value, all drawing on together, with an arrow riding each one if asked. The
// places are found the way the search box finds them, so a table may say "Dhaka", "France" or
// "23.8, 90.4".

import { routePathExpression, travellerExpressions } from "../../core/ae/labelExpressions.ts";
import { cometTailKeys } from "../../core/ae/trimKeys.ts";
import { flowWidths, type FlowRow } from "../../core/data/flows.ts";
import { greatCircle } from "../../core/geo/greatCircle.ts";
import type { LngLat } from "../../core/geo/mercator.ts";
import { searchPlaces, type PlaceIndex } from "../../core/search/placeSearch.ts";
import { resolveLayerStyle, styleRgb, type LayerStyle } from "../../core/style/layerStyle.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { hexToRgb, themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import { buildScale, colorForValue, type RampId, type ScaleMethod } from "../../core/style/valueScale.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";

type Info = { width: number; height: number; frameRate: number };

/** Arcs per call into After Effects, so a table of two hundred flows never blocks it for long. */
const BATCH = 6;
/** Flows beyond this many are left out, largest first: every arc costs expressions on every frame. */
export const MAX_FLOWS = 120;

export type FlowOptions = {
  startFrame: number;
  endFrame: number;
  theme?: ThemeLike;
  style?: LayerStyle | null;
  terrain?: TerrainSetting | null;
  /** The widest arc, in 1080-line pixels. */
  maxWidth?: number;
  /** An arrow rides every arc. */
  arrows?: boolean;
  /** A bright head chases the tip of every arc. */
  comet?: boolean;
  /** Colour every arc by its step of a ramp instead of the map's accent colour. */
  byColour?: boolean;
  ramp?: RampId;
  steps?: number;
  method?: ScaleMethod;
  /** Turn the ramp over (a dark map reads a pale line as "much"). */
  reverse?: boolean;
  /** Called after every batch. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

export type FlowResult = {
  drawn: number;
  layers: number;
  /** Names the search could not place. */
  unknown: string[];
  dropped: number;
  expressionErrors: string[];
  cancelled: boolean;
  legend: { value: number; width: number; label: string }[];
};

/**
 * Where a name is: the best search hit that is a place (a flow runs between places, so a sea or a
 * range that happens to start with the same letters in some language is no answer), or the
 * coordinates it spells out.
 */
export function placeOf(index: PlaceIndex, name: string): LngLat | null {
  const hit = searchPlaces(index, name, 8).find((result) => result.kind !== "nature");
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}

export async function addFlows(mapId: string, index: PlaceIndex, rows: FlowRow[], options: FlowOptions): Promise<FlowResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const look = options.style ?? resolveLayerStyle(themeFrom(options.theme));
  const places = new Map<string, LngLat | null>();
  const where = (name: string) => {
    if (!places.has(name)) places.set(name, placeOf(index, name));
    return places.get(name) ?? null;
  };
  // Largest first, so the flows that matter survive the limit and sit on top of the rest.
  const ordered = [...rows].sort((a, b) => b.value - a.value);
  const usable = ordered.filter((row) => where(row.from) && where(row.to) && !(where(row.from)!.lat === where(row.to)!.lat && where(row.from)!.lng === where(row.to)!.lng));
  const unknown = [...new Set(ordered.flatMap((row) => [row.from, row.to]).filter((name) => !where(name)))];
  const kept = usable.slice(0, MAX_FLOWS);
  const widths = flowWidths(
    kept.map((row) => row.value),
    { maxWidth: options.maxWidth, minWidth: 1.5 }
  );
  const keys: [number, number][] = [
    [options.startFrame, 0],
    [options.endFrame, 100]
  ];
  // Every arc in the accent colour, or each in the colour of its step of the ramp.
  const ramp = options.byColour ? buildScale(kept.map((row) => row.value), { ramp: options.ramp, steps: options.steps, method: options.method }) : null;
  if (ramp && options.reverse) ramp.colors.reverse();
  const colourOf = (value: number): number[] => {
    const step = ramp ? colorForValue(value, ramp) : null;
    return step ? hexToRgb(step) : styleRgb(look.accent);
  };
  const sampler = samplerFor(options.terrain);
  const result: FlowResult = { drawn: 0, layers: 0, unknown, dropped: usable.length - kept.length, expressionErrors: [], cancelled: false, legend: widths.legend };
  try {
    for (let at = 0; at < kept.length; at += BATCH) {
      if (options.signal?.aborted) {
        result.cancelled = true;
        break;
      }
      const items: Record<string, unknown>[] = [];
      for (const row of kept.slice(at, at + BATCH)) {
        const from = where(row.from)!;
        const to = where(row.to)!;
        // A short hop gets a low arc, a long one a higher, as the Route tool does.
        const route = greatCircle(from, to, 64, 0.08);
        const ground = sampler ? await sampler.elevations(route) : route.map(() => 0);
        const points = route.map((p, i) => [p.lat, p.lng, p.altitude, ground[i]]);
        const name = `Flow: ${row.from} to ${row.to}`;
        const width = widths.widthFor(row.value) * scale;
        items.push({
          type: "path",
          kind: "route",
          name,
          data: { from: [from.lng, from.lat], to: [to.lng, to.lat], value: row.value },
          pathExpression: routePathExpression(points),
          stroke: { color: colourOf(row.value), width, dash: 0 },
          trimKeys: keys,
          glow: look.glow ? { radius: 18 * scale, intensity: 0.8 } : null
        });
        if (options.comet) {
          items.push({
            type: "path",
            kind: "route",
            name: `Comet: ${name}`,
            pathExpression: routePathExpression(points),
            stroke: { color: colourOf(row.value), width: width * 1.6, dash: 0 },
            trimKeys: keys,
            trimStartKeys: cometTailKeys(keys),
            glow: { radius: 26 * scale, intensity: 1.1 }
          });
        }
        if (options.arrows) {
          items.push({
            type: "traveller",
            kind: "traveller",
            name: `Traveller: ${name}`,
            expressions: travellerExpressions(points),
            progressKeys: keys,
            color: colourOf(row.value),
            strokeColor: styleRgb(look.panel),
            // The arrow grows with the line it rides, within reason.
            size: Math.max(10, Math.min(28, 8 + width * 1.2)) * scale
          });
        }
      }
      const made = await callHostWithJobFile<{ layers: string[]; expressionErrors: string[] }>("addOverlays", {
        mapId,
        undoName: kept.length > BATCH ? `Flows (${Math.floor(at / BATCH) + 1} of ${Math.ceil(kept.length / BATCH)})` : "Flows",
        items
      });
      result.drawn += Math.min(BATCH, kept.length - at);
      result.layers += made.layers.length;
      result.expressionErrors.push(...made.expressionErrors);
      options.onProgress?.(result.drawn, kept.length);
    }
  } finally {
    sampler?.close();
  }
  return result;
}
