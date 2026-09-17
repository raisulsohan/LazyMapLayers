// "Midnight" — the first offline style, built on the bundled Natural Earth archive.
// Colours are placeholders for Phase 7's curated style set. Every layer names its render pass group
// in metadata "lml:group" (see core/render/passes.ts).

import type { StyleSpecification } from "maplibre-gl";
import type { LayerGroup } from "../../core/render/passes.ts";

const group = (name: LayerGroup) => ({ "lml:group": name });

export const NATURAL_EARTH_SOURCE = "natural-earth";

export function naturalEarthStyle(pmtilesUrl: string, options: { labels?: boolean } = {}): StyleSpecification {
  const labels = options.labels ?? true;
  const style: StyleSpecification = {
    version: 8,
    name: "LazyMapLayers Midnight",
    projection: { type: "mercator" },
    sources: {
      [NATURAL_EARTH_SOURCE]: {
        type: "vector",
        url: pmtilesUrl,
        attribution: "Made with Natural Earth"
      }
    },
    layers: [
      { id: "ocean", type: "background", metadata: group("background"), paint: { "background-color": "#0b1a2b" } },
      {
        id: "land",
        type: "fill",
        metadata: group("land"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "land",
        paint: { "fill-color": "#1d2a36", "fill-antialias": true }
      },
      {
        id: "lakes",
        type: "fill",
        metadata: group("water"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "lakes",
        paint: { "fill-color": "#0b1a2b" }
      },
      {
        id: "rivers",
        type: "line",
        metadata: group("water"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "rivers",
        minzoom: 3,
        paint: {
          "line-color": "#16324d",
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 3, 0.4, 8, 1.6]
        }
      },
      {
        id: "admin1",
        type: "line",
        metadata: group("boundaries"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "admin1_lines",
        minzoom: 4,
        paint: {
          "line-color": "#3b4c5c",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 9, 1.2],
          "line-dasharray": [2, 2]
        }
      },
      {
        id: "coastline",
        type: "line",
        metadata: group("boundaries"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "coastline",
        paint: {
          "line-color": "#2f5f86",
          "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 0, 0.5, 8, 2]
        }
      },
      {
        id: "boundaries",
        type: "line",
        metadata: group("boundaries"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "boundaries",
        paint: {
          "line-color": "#7a8c9c",
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 1, 0.4, 8, 2]
        }
      }
    ]
  };

  if (labels) {
    style.layers.push(
      {
        id: "country-labels",
        type: "symbol",
        metadata: group("labels"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "country_points",
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
          "text-font": ["Segoe UI Semibold", "Arial"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 6, 16],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-max-width": 8
        },
        paint: { "text-color": "#c7d3de", "text-halo-color": "#0b1a2b", "text-halo-width": 1.2 }
      },
      {
        id: "place-labels",
        type: "symbol",
        metadata: group("labels"),
        source: NATURAL_EARTH_SOURCE,
        "source-layer": "places",
        filter: ["<=", ["coalesce", ["get", "min_zoom"], 10], ["+", ["zoom"], 1]],
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
          "text-font": ["Segoe UI", "Arial"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 14],
          "text-anchor": "left",
          "text-offset": [0.5, 0],
          "text-max-width": 8
        },
        paint: { "text-color": "#e8eef3", "text-halo-color": "#0b1a2b", "text-halo-width": 1.2 }
      }
    );
  }
  return style;
}
