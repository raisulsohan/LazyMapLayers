// Routes and callouts as After Effects layers linked to a map.
//
// A route is a great-circle path, lifted into an arc, drawn on with Trim Paths between two frames. A
// callout is a leader line from a place to a rounded box with a title and a subtitle; it draws on,
// holds and fades out between two frames.

import { leaderPathExpression, anchoredPositionExpression, routePathExpression, travellerExpressions } from "../../core/ae/labelExpressions.ts";
import { paceKeys, type TimedLine } from "../../core/geo/pace.ts";
import { prepareRouteLine } from "../../core/geo/routeLine.ts";
import { greatCircle } from "../../core/geo/greatCircle.ts";
import type { LngLat } from "../../core/geo/mercator.ts";
import { scriptOf, SCRIPT_FONTS } from "../../core/labels/language.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";
import { measure } from "../labels/autoLabels.ts";

type Info = { width: number; height: number; frameRate: number };

export type RouteOptions = {
  name?: string;
  startFrame: number;
  endFrame: number;
  color?: number[];
  width?: number;
  /** Arc height at the middle, as a fraction of the route length. */
  arc?: number;
  points?: number;
  /** The map's terrain: with an elevation pack the route follows the ground of 3D terrain. */
  terrain?: TerrainSetting | null;
};

/** Ground elevations for points, or zeros without a pack. */
async function groundOf(terrain: TerrainSetting | null | undefined, points: LngLat[]): Promise<number[]> {
  const sampler = samplerFor(terrain);
  if (!sampler) return points.map(() => 0);
  try {
    return await sampler.elevations(points);
  } finally {
    sampler.close();
  }
}

export async function addRoute(mapId: string, from: LngLat, to: LngLat, options: RouteOptions): Promise<{ layers: string[]; expressionErrors: string[] }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const route = greatCircle(from, to, options.points ?? 96, options.arc ?? 0.08);
  const ground = await groundOf(options.terrain, route);
  const name = options.name ?? "Route";
  return callHostWithJobFile("addOverlays", {
    mapId,
    undoName: "Add route",
    items: [
      {
        type: "path",
        kind: "route",
        name,
        // The two ends, so a camera move can follow this route later.
        data: { from: [from.lng, from.lat], to: [to.lng, to.lat] },
        pathExpression: routePathExpression(route.map((p, i) => [p.lat, p.lng, p.altitude, ground[i]])),
        stroke: { color: options.color ?? [1, 0.78, 0.25], width: (options.width ?? 4) * scale },
        trimKeys: [
          [options.startFrame, 0],
          [options.endFrame, 100]
        ],
        glow: { radius: 18 * scale, intensity: 0.8 }
      }
    ]
  });
}

/** Expressions project every point on every frame, so long tracks are thinned to this many points. */
export const ROUTE_MAX_POINTS = 300;

export type RouteLineOptions = {
  name: string;
  startFrame: number;
  endFrame: number;
  color?: number[];
  width?: number;
  /** Adds an arrow that travels along the line while it draws on. */
  traveller?: boolean;
  /** True for the outline of an area: long legs stay straight on the flat map instead of following the great circle. */
  outline?: boolean;
  /** The line's recorded times: it draws on at the pace of the recording (long stops shortened) instead of evenly. */
  pace?: TimedLine;
  terrain?: TerrainSetting | null;
};

/**
 * Any line (an imported track, a road, an area's outline) as a route layer that follows the map and
 * draws on with Trim Paths, with an optional traveller that runs along it at the same pace.
 */
export async function addRouteLine(mapId: string, line: LngLat[], options: RouteLineOptions): Promise<{ layers: string[]; expressionErrors: string[]; points: number; keys: number }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const prepared = prepareRouteLine(line, { maxPoints: ROUTE_MAX_POINTS, geodesic: !options.outline });
  const light = prepared.points;
  const ground = await groundOf(options.terrain, light);
  const points = light.map((p, i) => [p.lat, p.lng, 0, ground[i]]);
  // Even pace: two eased keys. Recorded pace: the turning points of the recording, as linear keys.
  const keys: [number, number][] = options.pace
    ? paceKeys(options.pace, prepared, { startFrame: options.startFrame, endFrame: options.endFrame })
    : [
        [options.startFrame, 0],
        [options.endFrame, 100]
      ];
  const linearKeys = keys.length > 2;
  const items: Record<string, unknown>[] = [
    {
      type: "path",
      kind: "route",
      name: options.name,
      data: { from: [light[0].lng, light[0].lat], to: [light[light.length - 1].lng, light[light.length - 1].lat] },
      pathExpression: routePathExpression(points),
      stroke: { color: options.color ?? [1, 0.78, 0.25], width: (options.width ?? 4) * scale },
      trimKeys: keys,
      linearKeys,
      glow: { radius: 18 * scale, intensity: 0.8 }
    }
  ];
  if (options.traveller) {
    // Listed after the route, so it sits above it.
    items.push({
      type: "traveller",
      kind: "traveller",
      name: `Traveller: ${options.name}`,
      expressions: travellerExpressions(points),
      progressKeys: keys,
      linearKeys,
      size: 16 * scale
    });
  }
  const made = await callHostWithJobFile<{ layers: string[]; expressionErrors: string[] }>("addOverlays", { mapId, undoName: "Add route", items });
  return { ...made, points: light.length, keys: keys.length };
}

export type CalloutOptions = {
  inFrame: number;
  outFrame: number;
  side?: "right" | "left";
  terrain?: TerrainSetting | null;
};

export async function addCallout(mapId: string, place: LngLat, title: string, subtitle: string, options: CalloutOptions): Promise<{ layers: string[]; expressionErrors: string[] }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const s = info.height / 1080;
  const [elevation] = await groundOf(options.terrain, [place]);
  const titleScript = scriptOf(title);
  const subtitleScript = scriptOf(subtitle);
  const titleSize = Math.round(34 * s);
  const subtitleSize = Math.round(19 * s);
  const padX = 18 * s;
  const padY = 14 * s;
  const textWidth = Math.max(measure(title, titleScript, titleSize, 600, 0), measure(subtitle, subtitleScript, subtitleSize, 400, 40));
  if (!Number.isFinite(textWidth) || !Number.isFinite(s)) throw new Error(`callout text could not be measured (width ${textWidth}, scale ${s})`);
  const boxWidth = textWidth + padX * 2;
  const boxHeight = titleSize * 1.05 + subtitleSize * 1.3 + padY * 2;
  const direction = options.side === "left" ? -1 : 1;
  const dx = 70 * s * direction;
  const dy = -90 * s;
  const length = boxWidth * direction;
  const boxCenterX = dx + length / 2;
  const boxCenterY = dy - boxHeight / 2 - 6 * s;
  const titleBaseline = boxCenterY - boxHeight / 2 + padY + titleSize * 0.85;
  const subtitleBaseline = titleBaseline + subtitleSize * 1.45;
  const i = options.inFrame;
  const o = options.outFrame;
  const out = (at: number): [number, number][] => [
    [o - 8, 100],
    [o, 0]
  ].map(([f, v]) => [f + at, v] as [number, number]);
  const fadeIn = (from: number, to: number): [number, number][] => [
    [from, 0],
    [to, 100],
    ...out(0)
  ];
  const textStyle = (size: number, script: ReturnType<typeof scriptOf>, bold: boolean, color: number[]) => ({
    size,
    color,
    haloColor: [0, 0, 0],
    haloWidth: 0,
    fonts: bold ? SCRIPT_FONTS[script].bold : SCRIPT_FONTS[script].regular,
    tracking: bold ? 0 : 40,
    rtl: script === "arabic" || script === "hebrew"
  });
  return callHostWithJobFile("addOverlays", {
    mapId,
    undoName: "Add callout",
    items: [
      {
        type: "path",
        kind: "callout",
        name: `Callout leader: ${title}`,
        pathExpression: leaderPathExpression(place.lat, place.lng, dx, dy, length, elevation),
        stroke: { color: [0.21, 0.7, 1], width: 2.5 * s },
        trimKeys: [
          [i, 0],
          [i + 10, 100]
        ],
        opacityKeys: out(0)
      },
      {
        type: "box",
        kind: "callout",
        name: `Callout box: ${title}`,
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, boxCenterY, undefined, elevation),
        size: [boxWidth, boxHeight],
        radius: 8 * s,
        color: [0.03, 0.07, 0.11],
        opacity: 88,
        scaleKeys: [
          [i + 8, [0, 100]],
          [i + 16, [100, 100]]
        ],
        opacityKeys: out(0)
      },
      {
        type: "text",
        kind: "callout",
        name: `Callout title: ${title}`,
        text: title,
        style: textStyle(titleSize, titleScript, true, [1, 1, 1]),
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, titleBaseline, undefined, elevation),
        opacityKeys: fadeIn(i + 13, i + 20)
      },
      {
        type: "text",
        kind: "callout",
        name: `Callout subtitle: ${title}`,
        text: subtitle,
        style: textStyle(subtitleSize, subtitleScript, false, [0.62, 0.8, 0.95]),
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, subtitleBaseline, undefined, elevation),
        opacityKeys: fadeIn(i + 16, i + 23)
      }
    ]
  });
}
