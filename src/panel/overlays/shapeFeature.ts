// A map feature as an editable After Effects shape layer: the outline is thinned to the expression
// budget, every ring becomes a closed path that follows the camera, and fill, stroke and an optional
// draw-on are ordinary shape layer properties.

import { shapePathExpressions, shapeRings, SHAPE_MAX_POINTS, SHAPE_MAX_RINGS } from "../../core/ae/shapeExpressions.ts";
import { simplifyFeature } from "../../core/geo/sharedBorders.ts";
import { hexToRgb } from "../../core/style/themes.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHostWithJobFile, callHost } from "../cep.ts";
import { samplerFor } from "../elevation.ts";

type Info = { width: number; height: number; frameRate: number };

export type ShapeFeature = {
  /** Layer name, without the "Shape: " prefix. */
  name: string;
  /** The outline as GeoJSON-style multi-polygon coordinates ([polygon][ring][lng, lat]). */
  polygons: number[][][][];
  /** Kept in the layer's tag, so the panel can tell which feature a layer holds. */
  code?: string;
};

export type ShapeStyle = {
  /** Fill and stroke colour, as the hex the highlight uses. */
  color: string;
  /** 0 to 1; 0 leaves the outline unfilled. */
  fill: number;
  /** Stroke width in 1080-line pixels (scaled to the comp); 0 for no stroke. */
  outline: number;
  /** Draws the outline on from this frame over `drawFrames` frames. */
  startFrame?: number;
  drawFrames?: number;
  /** The map's terrain: with an elevation pack the outline follows the ground of 3D terrain. */
  terrain?: TerrainSetting | null;
};

export async function addFeatureShape(mapId: string, feature: ShapeFeature, style: ShapeStyle): Promise<{ layers: string[]; expressionErrors: string[]; points: number; rings: number }> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const light = simplifyFeature(feature.polygons, SHAPE_MAX_POINTS, SHAPE_MAX_RINGS);
  if (!light.length) throw new Error(`"${feature.name}" has no usable outline`);
  let rings = shapeRings(light);
  const sampler = samplerFor(style.terrain);
  if (sampler) {
    try {
      // The ground under every point, so the outline lies on 3D terrain.
      const elevations = await sampler.elevations(rings.flat().map((p) => ({ lat: p[0], lng: p[1] })));
      let at = 0;
      rings = rings.map((ring) => ring.map((p) => [p[0], p[1], p[2], elevations[at++]]));
    } finally {
      sampler.close();
    }
  }
  const color = hexToRgb(style.color);
  const made = await callHostWithJobFile<{ layers: string[]; expressionErrors: string[] }>("addOverlays", {
    mapId,
    undoName: "Add shape layer",
    items: [
      {
        type: "shape",
        kind: "feature",
        name: `Shape: ${feature.name}`,
        paths: shapePathExpressions(rings),
        fill: style.fill > 0 ? { color, opacity: Math.round(style.fill * 100) } : null,
        stroke: style.outline > 0 ? { color, width: style.outline * scale, dash: 0 } : null,
        trimKeys:
          style.drawFrames && style.drawFrames > 0
            ? [
                [style.startFrame ?? 0, 0],
                [(style.startFrame ?? 0) + style.drawFrames, 100]
              ]
            : null,
        data: feature.code ? { code: feature.code } : null
      }
    ]
  });
  return { ...made, points: rings.reduce((n, ring) => n + ring.length, 0), rings: rings.length };
}
