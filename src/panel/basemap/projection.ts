// Projection for a style: flat Web Mercator, or MapLibre's globe (a globe at low zoom that turns into
// the flat map, see GLOBE_TO_MERCATOR in core/camera/globe.ts). The globe gets an atmosphere that fades out as
// the camera comes down; space stays transparent, so a render can go over any background in After
// Effects.

import type { StyleSpecification } from "maplibre-gl";
import { globeProjectionSpec, type MapProjection } from "../../core/camera/globe.ts";

export function withProjection(style: StyleSpecification, projection: MapProjection): StyleSpecification {
  if (projection !== "globe") return { ...style, projection: { type: "mercator" } };
  return {
    ...style,
    projection: globeProjectionSpec() as StyleSpecification["projection"],
    sky: {
      "sky-color": "#1a3a5c",
      "horizon-color": "#4f8fc4",
      "fog-color": "#0b1a2b",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.9,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0]
    }
  };
}
