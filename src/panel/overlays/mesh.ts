// A connection mesh: the lines between a set of places, all drawing on together. It is what a network
// map is made of - trade between capitals, flights out of a hub, the links between the districts of a
// study - and every line is an ordinary route layer that follows the map.

import { connectionMesh, type LngLat, type MeshOptions } from "../../core/geo/shapeOps.ts";
import { resolveLayerStyle, type LayerStyle } from "../../core/style/layerStyle.ts";
import { hexToRgb, themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import { routePathExpression } from "../../core/ae/labelExpressions.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHostWithJobFile, callHost } from "../cep.ts";
import { samplerFor } from "../elevation.ts";

type Info = { width: number; height: number };

export type MeshPlace = LngLat & { name: string };

export type AddMeshOptions = MeshOptions & {
  startFrame: number;
  endFrame: number;
  theme?: ThemeLike;
  style?: LayerStyle | null;
  terrain?: TerrainSetting | null;
  /** Lines are drawn one behind another, at most this many in one go. */
  limit?: number;
};

export type MeshResult = { lines: number; layers: number; dropped: number; expressionErrors: string[] };

/** How many lines one click draws: more than this and a scene is a cobweb. */
export const MAX_MESH_LAYERS = 60;

export async function addMesh(mapId: string, places: MeshPlace[], options: AddMeshOptions): Promise<MeshResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const look = options.style ?? resolveLayerStyle(themeFrom(options.theme));
  const limit = Math.max(1, Math.min(MAX_MESH_LAYERS, options.limit ?? MAX_MESH_LAYERS));
  const mesh = connectionMesh(places, { neighbours: options.neighbours, maxKm: options.maxKm, steps: options.steps ?? 64, arc: options.arc ?? 0.06 });
  const kept = mesh.lines.slice(0, limit);
  const sampler = samplerFor(options.terrain);
  const keys: [number, number][] = [
    [options.startFrame, 0],
    [options.endFrame, 100]
  ];
  const items: Record<string, unknown>[] = [];
  for (const line of kept) {
    const ground = sampler ? await sampler.elevations(line.points) : line.points.map(() => 0);
    const points = line.points.map((point, i) => [point.lat, point.lng, point.altitude, ground[i]]);
    items.push({
      type: "path",
      kind: "route",
      name: `Link: ${places[line.from].name} to ${places[line.to].name}`,
      data: { from: [places[line.from].lng, places[line.from].lat], to: [places[line.to].lng, places[line.to].lat], km: Math.round(line.km) },
      pathExpression: routePathExpression(points),
      stroke: { color: hexToRgb(look.accent), width: Math.max(1, look.stroke * 0.6) * scale, dash: 0 },
      trimKeys: keys,
      glow: look.glow ? { radius: 14 * scale, intensity: 0.7 } : null
    });
  }
  if (!items.length) return { lines: 0, layers: 0, dropped: mesh.dropped, expressionErrors: [] };
  const made = await callHostWithJobFile<{ layers: string[]; expressionErrors: string[] }>("addOverlays", { mapId, undoName: "Connections", items });
  return { lines: kept.length, layers: made.layers.length, dropped: mesh.dropped + (mesh.lines.length - kept.length), expressionErrors: made.expressionErrors };
}
