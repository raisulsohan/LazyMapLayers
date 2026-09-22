// The offline world map, built on the bundled Natural Earth archive and coloured by a theme
// (core/style/themes.ts). Every layer names its render pass group in metadata "lml:group"
// (see core/render/passes.ts).

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LayerGroup } from "../../core/render/passes.ts";
import { dataFillColors, DATA_CODE, type DataFill } from "../../core/style/dataFill.ts";
import { HEAT_CODE, heatColorStops, heatFeatures, type HeatSetting } from "../../core/style/heat.ts";
import { provincesOf } from "../data/admin1.ts";
import { districtsOf } from "../data/districts.ts";
import { areaIdOf, isAreaCode, type Areas, type Highlight } from "../../core/style/highlights.ts";
import { themeById, type Theme } from "../../core/style/themes.ts";

const group = (name: LayerGroup) => ({ "lml:group": name });

export const NATURAL_EARTH_SOURCE = "natural-earth";

export type WorldImagery = {
  /** pmtiles:// URL of the satellite pack, used by satellite themes. */
  satelliteUrl?: string;
  /** pmtiles:// URL of the shaded relief overlay, drawn over the land of the other themes. */
  reliefUrl?: string;
};

/** An invisible layer of country shapes that the preview asks "which country is under the click?". */
export const COUNTRY_HIT_LAYER = "country-hit";

export const AREAS_SOURCE = "lml-areas";
/** Style metadata of a highlight layer: the code of its highlight. */
export const HIGHLIGHT_METADATA_KEY = "lml:highlight";

/** The source holding the provinces a data fill colours (countries come from the world tiles). */
export const DATA_SOURCE = "lml-data";
/** The source holding the points of a heat map. */
export const HEAT_SOURCE = "lml-heat";
export const SATELLITE_SOURCE = "lml-satellite";
export const RELIEF_SOURCE = "lml-relief";

export function naturalEarthStyle(
  pmtilesUrl: string,
  options: { labels?: boolean; theme?: Theme; imagery?: WorldImagery; highlights?: Highlight[]; areas?: Areas; data?: DataFill | null; heat?: HeatSetting | null; countryHits?: boolean } = {}
): StyleSpecification {
  const labels = options.labels ?? true;
  const t = options.theme ?? themeById(null);
  const source = NATURAL_EARTH_SOURCE;
  const satelliteUrl = t.satellite ? options.imagery?.satelliteUrl : undefined;
  const reliefUrl = t.satellite ? undefined : options.imagery?.reliefUrl;
  const sources: StyleSpecification["sources"] = { [source]: { type: "vector", url: pmtilesUrl, attribution: "Made with Natural Earth" } };

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

  if (satelliteUrl) {
    // The picture covers land and sea; the land fill stays underneath, so mattes know where land is.
    sources[SATELLITE_SOURCE] = { type: "raster", url: satelliteUrl, tileSize: 512, attribution: "NASA Earth Observatory (Blue Marble)" };
    layers.push({
      id: "satellite",
      type: "raster",
      metadata: group("imagery"),
      source: SATELLITE_SOURCE,
      // No cross-fade between tile levels: frames must not depend on what was drawn before.
      paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" }
    });
  }

  if (reliefUrl) {
    // Shadows and highlights with alpha, over the land's flat colour.
    sources[RELIEF_SOURCE] = { type: "raster", url: reliefUrl, tileSize: 512, attribution: "Made with Natural Earth" };
    layers.push({
      id: "relief",
      type: "raster",
      metadata: group("imagery"),
      source: RELIEF_SOURCE,
      paint: { "raster-opacity": t.dark ? 0.6 : 0.42, "raster-brightness-max": t.dark ? 0.45 : 1, "raster-fade-duration": 0, "raster-resampling": "linear" }
    });
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

  // The satellite picture shows its own lakes and rivers.
  if (!satelliteUrl) layers.push(
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
    }
  );

  layers.push(
    {
      id: "admin1",
      type: "line",
      metadata: group("boundaries"),
      source,
      "source-layer": "admin1_lines",
      minzoom: 4,
      paint: { "line-color": t.admin1, "line-opacity": satelliteUrl ? 0.55 : 1, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.4], "line-dasharray": [2, 2] }
    },
    {
      id: "coastline",
      type: "line",
      metadata: group("boundaries"),
      source,
      "source-layer": "coastline",
      layout: { "line-join": "round" },
      paint: { "line-color": t.coast, "line-opacity": satelliteUrl ? 0.35 : 1, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 0, 0.6, 8, 2.2] }
    },
    {
      id: "boundaries",
      type: "line",
      // The colour travels with the layer, so the border draw-on animation can rebuild its gradient.
      metadata: { ...group("boundaries"), "lml:color": t.border },
      source,
      "source-layer": "boundaries",
      layout: { "line-join": "round" },
      paint: { "line-color": t.border, "line-opacity": satelliteUrl ? 0.8 : 1, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 1, 0.6, 8, 2.4] }
    }
  );

  // Highlighted countries: a fill, a soft glow and an outline, all in the "highlight" group, which is
  // rendered as its own pass and left out of the base pass.
  // Countries come from the world tiles; custom areas from a GeoJSON source holding their polygons.
  const areaFeatures = (options.highlights ?? [])
    .filter((h) => isAreaCode(h.code) && options.areas?.[areaIdOf(h.code)])
    .map((h) => ({ type: "Feature" as const, properties: { id: areaIdOf(h.code) }, geometry: { type: "MultiPolygon" as const, coordinates: options.areas![areaIdOf(h.code)] } }));
  if (areaFeatures.length) sources[AREAS_SOURCE] = { type: "geojson", data: { type: "FeatureCollection", features: areaFeatures }, tolerance: 0.2 };
  // The numbers on the map, under the highlights: every country that has one is filled with the
  // colour of its step, from a single layer with a colour per country.
  if (options.data) {
    const colours = dataFillColors(options.data);
    const province = options.data.level === "province" && options.data.country;
    const district = options.data.level === "district" && options.data.country;
    // Countries come from the world tiles; provinces from their bundled polygons and districts from
    // their downloaded ones, as a source of their own holding only the units with a number.
    let from: Record<string, unknown> = { source: source, "source-layer": "countries" };
    let key: unknown = ["get", "adm0_a3"];
    if (province || district) {
      const units = province ? provincesOf(options.data.country as string) : districtsOf(options.data.country as string);
      const wanted = units.filter((unit) => colours.colors[unit.id]);
      if (wanted.length) {
        sources[DATA_SOURCE] = {
          type: "geojson",
          data: { type: "FeatureCollection", features: wanted.map((unit) => ({ type: "Feature" as const, properties: { id: unit.id }, geometry: { type: "MultiPolygon" as const, coordinates: unit.polygons } })) },
          tolerance: 0.2
        };
        from = { source: DATA_SOURCE };
        key = ["get", "id"];
      }
    }
    if (colours.codes.length && (!(province || district) || sources[DATA_SOURCE])) {
      const own = { ...group("highlight"), [HIGHLIGHT_METADATA_KEY]: DATA_CODE };
      const match: unknown[] = ["match", key];
      for (const code of colours.codes) match.push(code, colours.colors[code]);
      match.push(options.data.noData ?? "rgba(0, 0, 0, 0)");
      layers.push({
        id: "data-fill",
        type: "fill",
        metadata: own,
        ...from,
        paint: { "fill-color": match, "fill-opacity": options.data.opacity, "fill-antialias": true }
      } as unknown as LayerSpecification);
      if (options.data.outline > 0) {
        layers.push({
          id: "data-line",
          type: "line",
          metadata: own,
          ...from,
          filter: ["in", key, ["literal", colours.codes]],
          layout: { "line-join": "round" },
          paint: { "line-color": options.data.outlineColor, "line-width": options.data.outline }
        } as unknown as LayerSpecification);
      }
    }
  }

  // Heat, under the highlights: every point warms the map around it, as one rendered layer of its own.
  if (options.heat && options.heat.points.length) {
    sources[HEAT_SOURCE] = { type: "geojson", data: heatFeatures(options.heat) as GeoJSON.FeatureCollection };
    const stops = heatColorStops(options.heat.ramp, options.heat.reverse);
    layers.push({
      id: "heat",
      type: "heatmap",
      metadata: { ...group("highlight"), [HIGHLIGHT_METADATA_KEY]: HEAT_CODE },
      source: HEAT_SOURCE,
      paint: {
        "heatmap-weight": ["get", "w"],
        "heatmap-intensity": options.heat.intensity,
        "heatmap-radius": options.heat.radius,
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], ...stops.flat()],
        "heatmap-opacity": options.heat.opacity
      }
    } as unknown as LayerSpecification);
  }

  // Countries first: a province or a custom area usually lies inside one and must stay visible on it.
  const ordered = [...(options.highlights ?? []).entries()].sort((a, b) => Number(isAreaCode(a[1].code)) - Number(isAreaCode(b[1].code)));
  for (const [i, h] of ordered) {
    const custom = isAreaCode(h.code);
    if (custom && !options.areas?.[areaIdOf(h.code)]) continue;
    const only = (custom ? ["==", ["get", "id"], areaIdOf(h.code)] : ["==", ["get", "adm0_a3"], h.code]) as unknown as boolean;
    const from = custom ? { source: AREAS_SOURCE } : { source, "source-layer": "countries" };
    // The highlight's code lets a render draw this highlight alone (one After Effects layer each).
    const own = { ...group("highlight"), [HIGHLIGHT_METADATA_KEY]: h.code };
    if (h.fill > 0) {
      layers.push({ id: `highlight-fill-${i}`, type: "fill", metadata: own, ...from, filter: only, paint: { "fill-color": h.color, "fill-opacity": h.fill, "fill-antialias": true } } as LayerSpecification);
    }
    if (h.outline > 0) {
      layers.push(
        {
          id: `highlight-glow-${i}`,
          type: "line",
          metadata: own,
          ...from,
          filter: only,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": h.color, "line-opacity": 0.4, "line-width": h.outline * 4, "line-blur": h.outline * 3 }
        } as LayerSpecification,
        {
          id: `highlight-line-${i}`,
          type: "line",
          metadata: own,
          ...from,
          filter: only,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": h.color, "line-width": h.outline }
        } as LayerSpecification
      );
    }
  }

  if (options.countryHits) {
    layers.push({ id: COUNTRY_HIT_LAYER, type: "fill", metadata: group("overlay"), source, "source-layer": "countries", paint: { "fill-color": "#000000", "fill-opacity": 0 } } as LayerSpecification);
  }

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
    sources,
    // Lit from the upper left; regions replace this with their own light.
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 30] },
    metadata: { "lml:theme": t.id },
    layers
  };
}
