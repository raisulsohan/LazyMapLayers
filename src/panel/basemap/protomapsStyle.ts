// "Midnight City" — first style for OpenStreetMap regions in the Protomaps basemap schema (v4):
// layers earth, water, landcover, landuse, roads, buildings, boundaries, places, pois.
// Colours are placeholders for Phase 7's curated style set.

import type { StyleSpecification } from "maplibre-gl";

export const OSM_SOURCE = "osm";

export function protomapsStyle(pmtilesUrl: string, options: { labels?: boolean; buildings3d?: boolean } = {}): StyleSpecification {
  const labels = options.labels ?? true;
  const buildings3d = options.buildings3d ?? true;
  const kindIs = (...kinds: string[]) => ["in", ["get", "kind"], ["literal", kinds]] as unknown as boolean;

  const style: StyleSpecification = {
    version: 8,
    name: "LazyMapLayers Midnight City",
    sources: {
      [OSM_SOURCE]: {
        type: "vector",
        url: pmtilesUrl,
        attribution: "© OpenStreetMap contributors"
      }
    },
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 30] },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0a1726" } },
      { id: "earth", type: "fill", source: OSM_SOURCE, "source-layer": "earth", paint: { "fill-color": "#17222e" } },
      {
        id: "landcover",
        type: "fill",
        source: OSM_SOURCE,
        "source-layer": "landcover",
        paint: { "fill-color": "#1a2a2b", "fill-opacity": 0.6 }
      },
      {
        id: "parks",
        type: "fill",
        source: OSM_SOURCE,
        "source-layer": "landuse",
        filter: kindIs("park", "garden", "grass", "forest", "wood", "meadow", "nature_reserve", "cemetery", "golf_course", "playground"),
        paint: { "fill-color": "#193328" }
      },
      {
        id: "urban-areas",
        type: "fill",
        source: OSM_SOURCE,
        "source-layer": "landuse",
        filter: kindIs("pedestrian", "school", "university", "college", "hospital", "industrial", "commercial", "railway"),
        paint: { "fill-color": "#1c2733" }
      },
      { id: "water", type: "fill", source: OSM_SOURCE, "source-layer": "water", paint: { "fill-color": "#0a1726" } },
      {
        id: "boundaries",
        type: "line",
        source: OSM_SOURCE,
        "source-layer": "boundaries",
        paint: { "line-color": "#56697c", "line-width": 1, "line-dasharray": [3, 2] }
      },
      {
        id: "roads-minor",
        type: "line",
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("minor_road", "path"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#2a3a4a",
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.3, 17, 6]
        }
      },
      {
        id: "rail",
        type: "line",
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("rail"),
        paint: { "line-color": "#3a4654", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 2], "line-dasharray": [2, 2] }
      },
      {
        id: "roads-major",
        type: "line",
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("major_road"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#3d5873",
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.4, 17, 10]
        }
      },
      {
        id: "roads-highway",
        type: "line",
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("highway"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#36b3ff",
          "line-opacity": 0.8,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 6, 0.6, 17, 14]
        }
      },
      buildings3d
        ? {
            id: "buildings",
            type: "fill-extrusion",
            source: OSM_SOURCE,
            "source-layer": "buildings",
            minzoom: 13,
            filter: kindIs("building", "building_part"),
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 8], 0, "#223245", 60, "#3a5570", 300, "#7fb7e6"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 8],
              "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
              "fill-extrusion-opacity": 0.92
            }
          }
        : {
            id: "buildings",
            type: "fill",
            source: OSM_SOURCE,
            "source-layer": "buildings",
            minzoom: 13,
            filter: kindIs("building", "building_part"),
            paint: { "fill-color": "#223245" }
          }
    ]
  };

  if (labels) {
    style.layers.push({
      id: "place-labels",
      type: "symbol",
      source: OSM_SOURCE,
      "source-layer": "places",
      filter: kindIs("locality", "macrohood", "neighbourhood"),
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Segoe UI Semibold", "Arial"],
        "text-size": ["match", ["get", "kind"], "locality", 16, "macrohood", 13, 11],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
        "text-max-width": 8
      },
      paint: { "text-color": "#d7e3ee", "text-halo-color": "#0a1726", "text-halo-width": 1.4 }
    });
  }
  return style;
}
