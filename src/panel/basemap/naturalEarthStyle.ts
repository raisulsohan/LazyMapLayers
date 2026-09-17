// The offline world map, built on the bundled Natural Earth archive and coloured by a theme
// (core/style/themes.ts). Every layer names its render pass group in metadata "lml:group"
// (see core/render/passes.ts).

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LayerGroup } from "../../core/render/passes.ts";
import { themeById, type Theme } from "../../core/style/themes.ts";

const group = (name: LayerGroup) => ({ "lml:group": name });

export const NATURAL_EARTH_SOURCE = "natural-earth";

export function naturalEarthStyle(pmtilesUrl: string, options: { labels?: boolean; theme?: Theme } = {}): StyleSpecification {
  const labels = options.labels ?? true;
  const t = options.theme ?? themeById(null);
  const source = NATURAL_EARTH_SOURCE;

  const layers: LayerSpecification[] = [
    { id: "ocean", type: "background", metadata: group("background"), paint: { "background-color": t.ocean } },
    { id: "land", type: "fill", metadata: group("land"), source, "source-layer": "land", paint: { "fill-color": t.land, "fill-antialias": true } }
  ];

  if (t.countryFills) {
    // Natural Earth's mapcolor7 gives neighbours different colours.
    const fills = t.countryFills;
    layers.push({
      id: "countries",
      type: "fill",
      metadata: group("land"),
      source,
      "source-layer": "countries",
      paint: {
        "fill-color": ["match", ["coalesce", ["get", "mapcolor7"], 0], 1, fills[0], 2, fills[1], 3, fills[2], 4, fills[3], 5, fills[4], 6, fills[5], 7, fills[6], t.land],
        // Close up, a country's colour says nothing; it gives way to the plain land of city maps.
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7.5, 1, 9.5, 0],
        "fill-antialias": true
      }
    } as LayerSpecification);
  }

  if (t.coastGlow) {
    // A soft band along the coast gives the land depth. It belongs to the boundaries pass with the
    // coastline itself, so the land and water mattes stay exact.
    layers.push({
      id: "coast-glow",
      type: "line",
      metadata: group("boundaries"),
      source,
      "source-layer": "coastline",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": t.coastGlow,
        "line-opacity": t.dark ? 0.32 : 0.55,
        "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 0, 3, 4, 7, 8, 16],
        "line-blur": ["interpolate", ["exponential", 1.4], ["zoom"], 0, 3, 4, 7, 8, 14]
      }
    });
  }

  layers.push(
    { id: "lakes", type: "fill", metadata: group("water"), source, "source-layer": "lakes", paint: { "fill-color": t.ocean } },
    {
      id: "rivers",
      type: "line",
      metadata: group("water"),
      source,
      "source-layer": "rivers",
      minzoom: 3,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.river, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 3, 0.5, 8, 2] }
    },
    {
      id: "admin1",
      type: "line",
      metadata: group("boundaries"),
      source,
      "source-layer": "admin1_lines",
      minzoom: 4,
      paint: { "line-color": t.admin1, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.4], "line-dasharray": [2, 2] }
    },
    {
      id: "coastline",
      type: "line",
      metadata: group("boundaries"),
      source,
      "source-layer": "coastline",
      layout: { "line-join": "round" },
      paint: { "line-color": t.coast, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 0, 0.6, 8, 2.2] }
    },
    {
      id: "boundaries",
      type: "line",
      // The colour travels with the layer, so the border draw-on animation can rebuild its gradient.
      metadata: { ...group("boundaries"), "lml:color": t.border },
      source,
      "source-layer": "boundaries",
      layout: { "line-join": "round" },
      paint: { "line-color": t.border, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 1, 0.6, 8, 2.4] }
    }
  );

  if (labels) {
    layers.push(
      {
        id: "country-labels",
        type: "symbol",
        metadata: group("labels"),
        source,
        "source-layer": "country_points",
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
          "text-font": ["Segoe UI Semibold", "Arial"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 11, 6, 17],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.1,
          "text-max-width": 8
        },
        paint: { "text-color": t.textCountry, "text-halo-color": t.halo, "text-halo-width": 1.4 }
      },
      {
        id: "place-labels",
        type: "symbol",
        metadata: group("labels"),
        source,
        "source-layer": "places",
        filter: ["<=", ["coalesce", ["get", "min_zoom"], 10], ["+", ["zoom"], 1]],
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
          "text-font": ["Segoe UI", "Arial"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 15],
          "text-anchor": "left",
          "text-offset": [0.5, 0],
          "text-max-width": 8
        },
        paint: { "text-color": t.text, "text-halo-color": t.halo, "text-halo-width": 1.4 }
      }
    );
  }

  return {
    version: 8,
    name: `LazyMapLayers ${t.label}`,
    projection: { type: "mercator" },
    sources: { [source]: { type: "vector", url: pmtilesUrl, attribution: "Made with Natural Earth" } },
    // Lit from the upper left; regions replace this with their own light.
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 30] },
    metadata: { "lml:theme": t.id },
    layers
  };
}
