// The world of another year on the world map (D92): the year's shapes coloured by their ruling power
// instead of today's countries, the borders between them instead of today's borders, and their names
// instead of today's country names. Coasts, lakes, rivers, relief, terrain and cities stay the map's own.
//
// The shapes' coasts are coarser than Natural Earth's, so the sea is drawn once more over the fills:
// what spills past the coast disappears, and the land between the shapes keeps the land colour.

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LayerGroup } from "../../core/render/passes.ts";
import type { Theme } from "../../core/style/themes.ts";
import { historyPalette } from "../../core/history/historyStyle.ts";
import { historyLabels, historyShapes, yearColours, type LoadedYear } from "../data/history.ts";
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

/** Style metadata of a map whose History Year slider moves through several years (see historyWeights). */
export const HISTORY_METADATA_KEY = "lml:history";
export type HistoryAnimation = { years: number[]; fill: number; within: number; between: number };

/** Layer ids of one year when several are drawn: "history-fill@1914". */
export const historyLayerId = (base: string, year: number) => `${base}@${year}`;

/**
 * The past in place of today's countries. One year draws as it is; several (a keyed History Year
 * slider passing through them) each get their own layers, oldest at the bottom, the first one showing,
 * and the renderer sets how strongly each draws per frame (FrameRenderer.applyAnimation). With several
 * years, land nobody held is filled with plain land, so a later year covers an earlier empire that
 * fell, and the borders draw-on is not offered (each year's borders cross-fade instead).
 */
export function withHistory(style: StyleSpecification, loadedYears: LoadedYear[], theme: Theme, options: { labels: boolean; satellite: boolean }): StyleSpecification {
  const palette = historyPalette(theme);
  const several = loadedYears.length > 1;
  const full = options.satellite ? 0.45 : 1;
  const withinOpacity = options.satellite ? 0.55 : 1;
  const betweenOpacity = options.satellite ? 0.8 : 1;
  const unclaimed = several && !options.satellite ? theme.land : "rgba(0,0,0,0)";
  // Like a look's own country colours: a colour says nothing close up, so it gives way to plain land.
  const fade = (opacity: number) => ["interpolate", ["linear"], ["zoom"], 7.5, opacity, 9.5, 0];
  const original = style.layers.find((l) => l.id === BORDERS_DRAW_LAYER_ID) as (LayerSpecification & { paint?: Record<string, unknown> }) | undefined;
  const width = original?.paint?.["line-width"] ?? ["interpolate", ["exponential", 1.4], ["zoom"], 1, 0.6, 8, 2.4];
  const sources: StyleSpecification["sources"] = { ...style.sources };
  const fills: LayerSpecification[] = [];
  const lines: LayerSpecification[] = [];
  const names: LayerSpecification[] = [];

  loadedYears.forEach((loaded, index) => {
    const year = loaded.year.year;
    const id = (base: string) => (several ? historyLayerId(base, year) : base);
    // The first year shows until the renderer says otherwise.
    const shown = !several || index === 0 ? 1 : 0;
    const shapes = id(HISTORY_SOURCE);
    const borders = id(HISTORY_BORDERS_SOURCE);
    const labels = id(HISTORY_LABELS_SOURCE);
    sources[shapes] = { type: "geojson", data: historyShapes(loaded, yearColours(loaded, palette), unclaimed), tolerance: 0.3 };
    sources[borders] = {
      type: "geojson",
      lineMetrics: true,
      data: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { kind: "within" }, geometry: { type: "MultiLineString", coordinates: loaded.borders.within } },
          ...historyDrawData(loaded).features
        ]
      }
    };
    if (options.labels) sources[labels] = { type: "geojson", data: historyLabels(loaded) };
    fills.push({ id: id("history-fill"), type: "fill", metadata: group("land"), source: shapes, paint: { "fill-color": ["get", "color"], "fill-opacity": fade(full * shown), "fill-antialias": true } } as unknown as LayerSpecification);
    lines.push({
      id: id("history-within"),
      type: "line",
      metadata: group("boundaries"),
      source: borders,
      filter: ["==", ["get", "kind"], "within"],
      layout: { "line-join": "round" },
      paint: { "line-color": theme.admin1, "line-opacity": withinOpacity * shown, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 8, 1.4], "line-dasharray": [2, 2] }
    } as unknown as LayerSpecification);
    // One year keeps the borders' id and colour key, so the borders draw-on finds it.
    lines.push({
      id: several ? historyLayerId("history-between", year) : BORDERS_DRAW_LAYER_ID,
      type: "line",
      metadata: { ...group("boundaries"), [LAYER_COLOR_KEY_ID]: theme.border },
      source: borders,
      filter: ["==", ["get", "kind"], "between"],
      layout: { "line-join": "round" },
      paint: { "line-color": theme.border, "line-opacity": betweenOpacity * shown, "line-width": width }
    } as unknown as LayerSpecification);
    names.push({
      id: id("history-labels"),
      type: "symbol",
      metadata: group("labels"),
      source: labels,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Segoe UI Semibold", "Arial"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 6, 16],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
        "text-max-width": 8,
        "symbol-sort-key": ["get", "rank"],
        // Two years' names share the frame while they cross-fade.
        ...(several ? { "text-allow-overlap": true } : {})
      },
      paint: { "text-color": theme.textCountry, "text-halo-color": theme.halo, "text-halo-width": 1.4, "text-opacity": shown }
    } as unknown as LayerSpecification);
  });
  const sea = { id: "history-sea", type: "fill", metadata: group("water"), source: NATURAL_EARTH_SOURCE, "source-layer": "ocean", paint: { "fill-color": theme.ocean, "fill-antialias": true } } as unknown as LayerSpecification;

  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    if (layer.id === BORDERS_DRAW_LAYER_ID) layers.push(...lines);
    else if (layer.id === "country-labels" && options.labels) layers.push(...names);
    if (REPLACED.has(layer.id)) continue;
    layers.push(layer);
    // The fills sit on the land (over a satellite picture, on the picture), and the sea over them.
    if (layer.id === (options.satellite ? "satellite" : "land")) layers.push(...fills, ...(options.satellite ? [] : [sea]));
  }
  const animation: HistoryAnimation | null = several ? { years: loadedYears.map((l) => l.year.year), fill: full, within: withinOpacity, between: betweenOpacity } : null;
  return { ...style, sources, layers, ...(animation ? { metadata: { ...(style.metadata as object), [HISTORY_METADATA_KEY]: animation } } : {}) };
}
