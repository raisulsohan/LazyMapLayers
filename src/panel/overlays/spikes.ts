// Numbers as spikes on the map, as one editable After Effects layer: core works out the heights
// (core/style/spikes.ts), the panel finds where each place is, and the host builds the groups. Every
// spike rises straight up the frame from its place, so it reads the same at any tilt of the camera.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { dataFillColors, type DataFill } from "../../core/style/dataFill.ts";
import { resolveLayerStyle, styleRgb, type LayerStyle } from "../../core/style/layerStyle.ts";
import { spikeSet, type SpikeOptions, type SpikePlace, type SpikeSet } from "../../core/style/spikes.ts";
import { hexToRgb, themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import { callHost } from "../cep.ts";

type Info = { width: number; height: number; frameRate: number };

export type SpikeStyle = {
  theme?: ThemeLike;
  style?: LayerStyle | null;
  /** Colour every spike by its step of the ramp, instead of the map's accent colour. */
  byColour?: boolean;
  opacity?: number;
};

export type SpikeResult = { name: string; spikes: number; removed: number; expressionErrors: string[]; set: SpikeSet };

/** Builds (or rebuilds) the spikes of a map's numbers. `places` says where each value sits. */
export async function addSpikes(mapId: string, fill: DataFill, places: SpikePlace[], options: SpikeOptions & SpikeStyle = {}): Promise<SpikeResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const theme = themeFrom(options.theme);
  const look = options.style ?? resolveLayerStyle(theme);
  const set = spikeSet(places, { ...options, height: info.height });
  const colours = options.byColour ? dataFillColors(fill) : null;
  const made = await callHost<Omit<SpikeResult, "set">>("addSpikes", {
    mapId,
    name: `Spikes: ${fill.column}`,
    color: styleRgb(look.accent),
    // No outline: on a base a few pixels wide a stroke would be all that shows.
    strokeColor: hexToRgb(theme.dark ? "#ffffff" : "#1a1a22"),
    strokeWidth: 0,
    fillOpacity: 90,
    opacity: Math.round((options.opacity ?? 1) * 100),
    width: set.width,
    spikes: set.spikes.map((spike) => ({
      name: `${spike.name} (${spike.value})`,
      height: spike.height,
      color: colours?.colors[spike.id] ? hexToRgb(colours.colors[spike.id]) : undefined,
      positionExpression: anchoredPositionExpression(spike.lat, spike.lng, 0, 0)
    }))
  });
  return { ...made, set };
}

export const removeSpikes = (mapId: string) => callHost<{ removed: number }>("removeSpikes", { mapId });
