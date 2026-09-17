// The style for downloaded OpenStreetMap regions in the Protomaps basemap schema (v4): layers earth,
// water, landcover, landuse, roads, buildings, boundaries, places, pois. Colours come from a theme
// (core/style/themes.ts), the same one as the world map under it. Every layer names its render pass
// group in metadata "lml:group" (see core/render/passes.ts).

import type { StyleSpecification } from "maplibre-gl";
import type { LayerGroup } from "../../core/render/passes.ts";
import { themeById, type Theme } from "../../core/style/themes.ts";

const group = (name: LayerGroup) => ({ "lml:group": name });

export const OSM_SOURCE = "osm";

export function protomapsStyle(pmtilesUrl: string, options: { labels?: boolean; buildings3d?: boolean; theme?: Theme } = {}): StyleSpecification {
  const labels = options.labels ?? true;
  const t = options.theme ?? themeById(null);
  const buildings3d = options.buildings3d ?? true;
  const kindIs = (...kinds: string[]) => ["in", ["get", "kind"], ["literal", kinds]] as unknown as boolean;
  // OSM outlines tagged building=no only frame their building parts (the Eiffel Tower's 330 m
  // outline, for one); drawing them would hide the parts inside a solid block.
  const buildingFilter = ["all", kindIs("building", "building_part"), ["!=", ["coalesce", ["get", "kind_detail"], ""], "no"]] as unknown as boolean;

  const style: StyleSpecification = {
    version: 8,
    name: `LazyMapLayers ${t.label} (regions)`,
    sources: {
      [OSM_SOURCE]: {
        type: "vector",
        url: pmtilesUrl,
        attribution: "© OpenStreetMap contributors"
      }
    },
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 30] },
    layers: [
      { id: "background", type: "background", metadata: group("background"), paint: { "background-color": t.ocean } },
      { id: "earth", type: "fill", metadata: group("land"), source: OSM_SOURCE, "source-layer": "earth", paint: { "fill-color": t.land } },
      {
        id: "landcover",
        type: "fill",
        metadata: group("land"),
        source: OSM_SOURCE,
        "source-layer": "landcover",
        paint: { "fill-color": t.landcover, "fill-opacity": 0.6 }
      },
      {
        id: "parks",
        type: "fill",
        metadata: group("land"),
        source: OSM_SOURCE,
        "source-layer": "landuse",
        filter: kindIs("park", "garden", "grass", "forest", "wood", "meadow", "nature_reserve", "cemetery", "golf_course", "playground"),
        paint: { "fill-color": t.park }
      },
      {
        id: "urban-areas",
        type: "fill",
        metadata: group("land"),
        source: OSM_SOURCE,
        "source-layer": "landuse",
        filter: kindIs("pedestrian", "school", "university", "college", "hospital", "industrial", "commercial", "railway"),
        paint: { "fill-color": t.urban }
      },
      { id: "water", type: "fill", metadata: group("water"), source: OSM_SOURCE, "source-layer": "water", paint: { "fill-color": t.ocean } },
      // Rivers and canals as lines: they read at every zoom, including the zooms where water polygons
      // from low-zoom tiles are unreliable.
      {
        id: "waterways",
        type: "line",
        metadata: group("water"),
        source: OSM_SOURCE,
        "source-layer": "water",
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["in", ["get", "kind"], ["literal", ["river", "canal"]]]] as unknown as boolean,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.ocean,
          "line-width": ["interpolate", ["exponential", 1.8], ["zoom"], 8, ["match", ["get", "kind"], "river", 0.8, 0.4], 12, ["match", ["get", "kind"], "river", 4, 1.5], 15, ["match", ["get", "kind"], "river", 18, 5]]
        }
      },
      {
        id: "boundaries",
        type: "line",
        metadata: group("boundaries"),
        source: OSM_SOURCE,
        "source-layer": "boundaries",
        paint: { "line-color": t.admin1, "line-width": 1, "line-dasharray": [3, 2] }
      },
      {
        id: "roads-minor",
        type: "line",
        metadata: group("roads"),
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("minor_road", "path"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.roadMinor,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.3, 17, 6]
        }
      },
      {
        id: "rail",
        type: "line",
        metadata: group("roads"),
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("rail"),
        paint: { "line-color": t.rail, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 2], "line-dasharray": [2, 2] }
      },
      {
        id: "roads-major",
        type: "line",
        metadata: group("roads"),
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("major_road"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.roadMajor,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.4, 17, 10]
        }
      },
      {
        id: "roads-highway",
        type: "line",
        metadata: group("roads"),
        source: OSM_SOURCE,
        "source-layer": "roads",
        filter: kindIs("highway"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.highway,
          "line-opacity": t.dark ? 0.8 : 1,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 6, 0.6, 17, 14]
        }
      },
      buildings3d
        ? {
            id: "buildings",
            type: "fill-extrusion",
            metadata: group("buildings"),
            source: OSM_SOURCE,
            "source-layer": "buildings",
            minzoom: 12,
            filter: buildingFilter,
            // Buildings fade in and rise between zoom 12 and 13 instead of popping in.
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 8], 0, t.buildingLow, 60, t.buildingMid, 300, t.buildingHigh],
              "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, ["coalesce", ["get", "height"], 8]],
              "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, ["coalesce", ["get", "min_height"], 0]],
              "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 12.6, 0.92]
            }
          }
        : {
            id: "buildings",
            type: "fill",
            metadata: group("buildings"),
            source: OSM_SOURCE,
            "source-layer": "buildings",
            minzoom: 12,
            filter: buildingFilter,
            paint: { "fill-color": t.buildingLow, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 12.6, 1] }
          }
    ]
  };

  if (labels) {
    style.layers.push({
      id: "place-labels",
      type: "symbol",
      metadata: group("labels"),
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
      paint: { "text-color": t.text, "text-halo-color": t.halo, "text-halo-width": 1.4 }
    });
  }
  return style;
}
