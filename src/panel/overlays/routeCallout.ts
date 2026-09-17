// Routes and callouts as After Effects layers linked to a map.
//
// A route is a great-circle path, lifted into an arc, drawn on with Trim Paths between two frames. A
// callout is a leader line from a place to a rounded box with a title and a subtitle; it draws on,
// holds and fades out between two frames.

import { leaderPathExpression, anchoredPositionExpression, routePathExpression } from "../../core/ae/labelExpressions.ts";
import { greatCircle } from "../../core/geo/greatCircle.ts";
import type { LngLat } from "../../core/geo/mercator.ts";
import { scriptOf, SCRIPT_FONTS } from "../../core/labels/language.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
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
};

export async function addRoute(mapId: string, from: LngLat, to: LngLat, options: RouteOptions): Promise<{ layers: string[]; expressionErrors: string[] }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const route = greatCircle(from, to, options.points ?? 96, options.arc ?? 0.08);
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
        pathExpression: routePathExpression(route.map((p) => [p.lat, p.lng, p.altitude])),
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

export type CalloutOptions = {
  inFrame: number;
  outFrame: number;
  side?: "right" | "left";
};

export async function addCallout(mapId: string, place: LngLat, title: string, subtitle: string, options: CalloutOptions): Promise<{ layers: string[]; expressionErrors: string[] }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const s = info.height / 1080;
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
        pathExpression: leaderPathExpression(place.lat, place.lng, dx, dy, length),
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
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, boxCenterY),
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
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, titleBaseline),
        opacityKeys: fadeIn(i + 13, i + 20)
      },
      {
        type: "text",
        kind: "callout",
        name: `Callout subtitle: ${title}`,
        text: subtitle,
        style: textStyle(subtitleSize, subtitleScript, false, [0.62, 0.8, 0.95]),
        positionExpression: anchoredPositionExpression(place.lat, place.lng, boxCenterX, subtitleBaseline),
        opacityKeys: fadeIn(i + 16, i + 23)
      }
    ]
  });
}
