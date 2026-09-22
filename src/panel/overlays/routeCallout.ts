// Routes and callouts as After Effects layers linked to a map.
//
// A route is a great-circle path, lifted into an arc, drawn on with Trim Paths between two frames. A
// callout is a leader line from a place to a rounded box with a title and a subtitle; it draws on,
// holds and fades out between two frames.

import { leaderPathExpression, anchoredPositionExpression, routePathExpression, travellerExpressions } from "../../core/ae/labelExpressions.ts";
import { cometTailKeys } from "../../core/ae/trimKeys.ts";
import { paceKeys, type TimedLine } from "../../core/geo/pace.ts";
import { prepareRouteLine } from "../../core/geo/routeLine.ts";
import { greatCircle } from "../../core/geo/greatCircle.ts";
import type { LngLat } from "../../core/geo/mercator.ts";
import { scriptOf, SCRIPT_FONTS } from "../../core/labels/language.ts";
import { templateFonts, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { resolveLayerStyle, styleRgb, type LayerStyle } from "../../core/style/layerStyle.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { themeById } from "../../core/style/themes.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";
import { measure } from "../labels/autoLabels.ts";

type Info = { width: number; height: number; frameRate: number };

/** The look of the layers the panel generates; without one, the default look's. */
const styleOf = (style: LayerStyle | undefined) => style ?? resolveLayerStyle(themeById(null));

export type RouteOptions = {
  name?: string;
  startFrame: number;
  endFrame: number;
  color?: number[];
  width?: number;
  /** Arc height at the middle, as a fraction of the route length. */
  arc?: number;
  points?: number;
  /** Colour, stroke and glow of the generated layers (the map's look, unless the user changed it). */
  style?: LayerStyle;
  /** A bright head that runs along the line while it draws on. */
  comet?: boolean;
  /** An arrow that travels along the route and turns with it. */
  traveller?: boolean;
  /** Dash length in 1080-line pixels; 0 for a solid line. */
  dash?: number;
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
  const look = styleOf(options.style);
  const name = options.name ?? "Route";
  const path = routePathExpression(route.map((p, i) => [p.lat, p.lng, p.altitude, ground[i]]));
  const keys: [number, number][] = [
    [options.startFrame, 0],
    [options.endFrame, 100]
  ];
  const items: Record<string, unknown>[] = [
    {
      type: "path",
      kind: "route",
      name,
      // The two ends, so a camera move can follow this route later.
      data: { from: [from.lng, from.lat], to: [to.lng, to.lat] },
      pathExpression: path,
      stroke: { color: options.color ?? styleRgb(look.accent), width: (options.width ?? look.stroke) * scale, dash: (options.dash ?? 0) * scale },
      trimKeys: keys,
      glow: look.glow ? { radius: 18 * scale, intensity: 0.8 } : null
    }
  ];
  if (options.comet) {
    items.push({
      type: "path",
      kind: "route",
      name: `Comet: ${name}`,
      pathExpression: path,
      stroke: { color: styleRgb(look.accent), width: (options.width ?? look.stroke) * 1.6 * scale, dash: 0 },
      trimKeys: keys,
      trimStartKeys: cometTailKeys(keys),
      glow: { radius: 26 * scale, intensity: 1.1 }
    });
  }
  if (options.traveller) {
    // The arrow rides the arc of the route, lifted like the line itself, and sits above it.
    items.push({
      type: "traveller",
      kind: "traveller",
      name: `Traveller: ${name}`,
      expressions: travellerExpressions(route.map((p, i) => [p.lat, p.lng, p.altitude, ground[i]])),
      progressKeys: keys,
      color: styleRgb(look.accent),
      strokeColor: styleRgb(look.panel),
      size: 16 * scale
    });
  }
  return callHostWithJobFile("addOverlays", { mapId, undoName: "Add route", items });
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
  /** A bright head that runs along the line and fades out behind it, over the drawn line. */
  comet?: boolean;
  /** Dash length in 1080-line pixels (the gap matches it); 0 for a solid line. */
  dash?: number;
  /** True for the outline of an area: long legs stay straight on the flat map instead of following the great circle. */
  outline?: boolean;
  /** The line's recorded times: it draws on at the pace of the recording (long stops shortened) instead of evenly. */
  pace?: TimedLine;
  terrain?: TerrainSetting | null;
  style?: LayerStyle;
  /** The map's label template: a callout is typeset in the same font as the names. */
  template?: LabelTemplate | null;
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
  const look = styleOf(options.style);
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
      stroke: { color: options.color ?? styleRgb(look.accent), width: (options.width ?? look.stroke) * scale, dash: (options.dash ?? 0) * scale },
      trimKeys: keys,
      linearKeys,
      glow: look.glow ? { radius: 18 * scale, intensity: 0.8 } : null
    }
  ];
  if (options.comet) {
    // The same path trimmed at both ends: a short bright piece that chases the tip of the line.
    items.push({
      type: "path",
      kind: "route",
      name: `Comet: ${options.name}`,
      pathExpression: routePathExpression(points),
      stroke: { color: styleRgb(look.accent), width: (options.width ?? look.stroke) * 1.6 * scale, dash: 0 },
      trimKeys: keys,
      trimStartKeys: cometTailKeys(keys),
      linearKeys,
      glow: { radius: 26 * scale, intensity: 1.1 }
    });
  }
  if (options.traveller) {
    // Listed after the route, so it sits above it.
    items.push({
      type: "traveller",
      kind: "traveller",
      name: `Traveller: ${options.name}`,
      expressions: travellerExpressions(points),
      progressKeys: keys,
      linearKeys,
      color: styleRgb(look.accent),
      strokeColor: styleRgb(look.panel),
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
  style?: LayerStyle;
  /** The map's label template: a callout is typeset in the same font as the names. */
  template?: LabelTemplate | null;
};

export async function addCallout(mapId: string, place: LngLat, title: string, subtitle: string, options: CalloutOptions): Promise<{ layers: string[]; expressionErrors: string[] }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const s = info.height / 1080;
  const [elevation] = await groundOf(options.terrain, [place]);
  const look = styleOf(options.style);
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
  // The colours stay the look's own: they have to read on the callout's box, not on the map.
  const fontsFor = (script: ReturnType<typeof scriptOf>, bold: boolean) => {
    const fonts = bold ? SCRIPT_FONTS[script].bold : SCRIPT_FONTS[script].regular;
    return options.template ? templateFonts(options.template, fonts, script) : fonts;
  };
  const textStyle = (size: number, script: ReturnType<typeof scriptOf>, bold: boolean, color: number[]) => ({
    size,
    color,
    haloColor: [0, 0, 0],
    haloWidth: 0,
    fonts: fontsFor(script, bold),
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
        stroke: { color: styleRgb(look.accent), width: look.stroke * 0.6 * s },
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
        color: styleRgb(look.panel),
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
        style: textStyle(titleSize, titleScript, true, styleRgb(look.text)),
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, titleBaseline, undefined, elevation),
        opacityKeys: fadeIn(i + 13, i + 20)
      },
      {
        type: "text",
        kind: "callout",
        name: `Callout subtitle: ${title}`,
        text: subtitle,
        style: textStyle(subtitleSize, subtitleScript, false, styleRgb(look.textSoft)),
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, subtitleBaseline, undefined, elevation),
        opacityKeys: fadeIn(i + 16, i + 23)
      }
    ]
  });
}
