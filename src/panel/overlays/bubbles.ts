// Numbers as circles on the map, as one editable After Effects layer: core works out the radii
// (core/style/bubbles.ts), the panel finds where each place is, and the host builds the groups.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { bubbleSet, type BubbleOptions, type BubblePlace, type BubbleSet } from "../../core/style/bubbles.ts";
import { dataFillColors, type DataFill } from "../../core/style/dataFill.ts";
import { resolveLayerStyle, styleRgb, type LayerStyle } from "../../core/style/layerStyle.ts";
import { hexToRgb, themeById } from "../../core/style/themes.ts";
import { callHost } from "../cep.ts";

type Info = { width: number; height: number; frameRate: number };

export type BubbleStyle = {
  theme?: string | null;
  style?: LayerStyle | null;
  /** Colour every bubble by its step of the ramp, instead of the map's accent colour. */
  byColour?: boolean;
  opacity?: number;
};

export type BubbleResult = { name: string; bubbles: number; removed: number; expressionErrors: string[]; set: BubbleSet };

/** Builds (or rebuilds) the bubbles of a map's numbers. `places` says where each value sits. */
export async function addBubbles(mapId: string, fill: DataFill, places: BubblePlace[], options: BubbleOptions & BubbleStyle = {}): Promise<BubbleResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const theme = themeById(options.theme);
  const look = options.style ?? resolveLayerStyle(theme);
  const set = bubbleSet(places, { ...options, height: info.height });
  const colours = options.byColour ? dataFillColors(fill) : null;
  const made = await callHost<Omit<BubbleResult, "set">>("addBubbles", {
    mapId,
    name: `Bubbles: ${fill.column}`,
    color: styleRgb(look.accent),
    strokeColor: hexToRgb(theme.dark ? "#ffffff" : "#1a1a22"),
    strokeWidth: Math.max(1, Math.round((info.height / 1080) * 1.5)),
    fillOpacity: 70,
    opacity: Math.round((options.opacity ?? 1) * 100),
    bubbles: set.bubbles.map((bubble) => ({
      name: `${bubble.name} (${bubble.value})`,
      radius: bubble.radius,
      color: colours?.colors[bubble.id] ? hexToRgb(colours.colors[bubble.id]) : undefined,
      positionExpression: anchoredPositionExpression(bubble.lat, bubble.lng, 0, 0)
    }))
  });
  return { ...made, set };
}

export const removeBubbles = (mapId: string) => callHost<{ removed: number }>("removeBubbles", { mapId });
