// The world of another year on the world map (D92): the year's shapes coloured by their ruling power
// instead of today's countries, the borders between them instead of today's borders, and their names
// instead of today's country names. Coasts, lakes, rivers, relief, terrain and cities stay the map's own.
//
// The shapes' coasts are coarser than Natural Earth's, so the sea is drawn once more over the fills:
// what spills past the coast disappears, and the land between the shapes keeps the land colour.

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LayerGroup } from "../../core/render/passes.ts";
import type { Theme } from "../../core/style/themes.ts";
import { historyPalette, rulerColours } from "../../core/history/historyStyle.ts";
import { historyLabels, historyShapes, type LoadedYear } from "../data/history.ts";
import { NATURAL_EARTH_SOURCE } from "./naturalEarthStyle.ts";

export const HISTORY_SOURCE = "lml-history";
export const HISTORY_BORDERS_SOURCE = "lml-history-borders";
export const HISTORY_LABELS_SOURCE = "lml-history-labels";

/** basemapStyle's BORDERS_DRAW_LAYER and LAYER_COLOR_KEY (not imported: basemapStyle imports this file). */
const BORDERS_DRAW_LAYER_ID = "boundaries";
const LAYER_COLOR_KEY_ID = "lml:color";

/** Today's countries, borders and names, which the past replaces. */
const REPLACED = new Set(["countries", "admin1", BORDERS_DRAW_LAYER_ID, "country-labels"]);

const group = (name: LayerGroup) => ({ "lml:group": name });

/** True for a layer that draws the past; such layers keep their place at every zoom. */
export const isHistoryLayer = (layer: LayerSpecification) => String((layer as { source?: unknown }).source ?? "").startsWith(HISTORY_SOURCE);

/** The borders between ruling powers as one line source with line metrics, for the borders draw-on. */
export function historyDrawData(loaded: LoadedYear): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "between" }, geometry: { type: "MultiLineString", coordinates: loaded.borders.between } }] };
}

export function withHistory(style: StyleSpecification, loaded: LoadedYear, theme: Theme, options: { labels: boolean; satellite: boolean }): StyleSpecification {
  const palette = historyPalette(theme);
  const sources: StyleSpecification["sources"] = {
    ...style.sources,
    [HISTORY_SOURCE]: { type: "geojson", data: historyShapes(loaded, rulerColours(loaded.rulers, palette)), tolerance: 0.3 },
    [HISTORY_BORDERS_SOURCE]: {
      type: "geojson",
      lineMetrics: true,
      data: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { kind: "within" }, geometry: { type: "MultiLineString", coordinates: loaded.borders.within } },
          ...historyDrawData(loaded).features
        ]
      }
    }
  };
  if (options.labels) sources[HISTORY_LABELS_SOURCE] = { type: "geojson", data: historyLabels(loaded) };

  // Like a look's own country colours: a colour says nothing close up, so it gives way to plain land.
  const fade = (full: number) => ["interpolate", ["linear"], ["zoom"], 7.5, full, 9.5, 0];
  const fill = { id: "history-fill", type: "fill", metadata: group("land"), source: HISTORY_SOURCE, paint: { "fill-color": ["get", "color"], "fill-opacity": fade(options.satellite ? 0.45 : 1), "fill-antialias": true } } as unknown as LayerSpecification;
  const sea = { id: "history-sea", type: "fill", metadata: group("water"), source: NATURAL_EARTH_SOURCE, "source-layer": "ocean", paint: { "fill-color": theme.ocean, "fill-antialias": true } } as unknown as LayerSpecification;
  const original = style.layers.find((l) => l.id === BORDERS_DRAW_LAYER_ID) as (LayerSpecification & { paint?: Record<string, unknown> }) | undefined;
  const width = original?.paint?.["line-width"] ?? ["interpolate", ["exponential", 1.4], ["zoom"], 1, 0.6, 8, 2.4];
  const within = {
    id: "history-within",
    type: "line",
    metadata: group("boundaries"),
    source: HISTORY_BORDERS_SOURCE,
    filter: ["==", ["get", "kind"], "within"],
    layout: { "line-join": "round" },
    paint: { "line-color": theme.admin1, "line-opacity": options.satellite ? 0.55 : 1, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 8, 1.4], "line-dasharray": [2, 2] }
  } as unknown as LayerSpecification;
  // It keeps the borders' id and colour key, so the borders draw-on finds it.
  const between = {
    id: BORDERS_DRAW_LAYER_ID,
    type: "line",
    metadata: { ...group("boundaries"), [LAYER_COLOR_KEY_ID]: theme.border },
    source: HISTORY_BORDERS_SOURCE,
    filter: ["==", ["get", "kind"], "between"],
    layout: { "line-join": "round" },
    paint: { "line-color": theme.border, "line-opacity": options.satellite ? 0.8 : 1, "line-width": width }
  } as unknown as LayerSpecification;
  const names = {
    id: "history-labels",
    type: "symbol",
    metadata: group("labels"),
    source: HISTORY_LABELS_SOURCE,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Segoe UI Semibold", "Arial"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 6, 16],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.08,
      "text-max-width": 8,
      "symbol-sort-key": ["get", "rank"]
    },
    paint: { "text-color": theme.textCountry, "text-halo-color": theme.halo, "text-halo-width": 1.4 }
  } as unknown as LayerSpecification;

  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    if (layer.id === BORDERS_DRAW_LAYER_ID) layers.push(within, between);
    else if (layer.id === "country-labels" && options.labels) layers.push(names);
    if (REPLACED.has(layer.id)) continue;
    layers.push(layer);
    // The fills sit on the land (over a satellite picture, on the picture), and the sea over them.
    if (layer.id === (options.satellite ? "satellite" : "land")) layers.push(fill, ...(options.satellite ? [] : [sea]));
  }
  return { ...style, sources, layers };
}
