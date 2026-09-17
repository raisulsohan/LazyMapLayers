// The style a map renders with, shared by the preview and the renderer.
//
// World maps use the offline Natural Earth style. Region maps put the downloaded OpenStreetMap region
// on top of the world: Natural Earth carries every zoom (and the globe), the region fades in from
// zoom 9 to 9.8 where its tiles have full detail, and the world's own lines fade out above zoom 9, so a
// flight from space into a city never shows a seam or a patchwork of missing tiles.
//
// With a "Borders Draw-on" control on the map, country borders come from a GeoJSON source with line
// metrics, so the renderer can draw them on per frame (see applyAnimation).

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapProjection } from "../../core/camera/globe.ts";
import { extensionRoot, fs, path } from "../cep.ts";
import { naturalEarthArchivePath, regionArchivePath, registerLocalArchive } from "./maplibreSetup.ts";
import { naturalEarthStyle } from "./naturalEarthStyle.ts";
import { protomapsStyle } from "./protomapsStyle.ts";
import { withProjection } from "./projection.ts";
import { regionFadeZooms } from "../../core/tiles/regionFade.ts";
import type { Bbox } from "../../core/tiles/tileMath.ts";

export type BasemapSource = { kind: "world" } | { kind: "region"; name: string } | { kind: "regions"; names: string[] };

/** The downloaded regions a basemap uses (none for the world map). */
export function regionNames(basemap: BasemapSource): string[] {
  return basemap.kind === "region" ? [basemap.name] : basemap.kind === "regions" ? basemap.names : [];
}

export type Marker = { lat: number; lng: number; radius?: number; color?: string };

export type BasemapStyleOptions = {
  labels: boolean;
  projection?: MapProjection;
  markers?: Marker[];
  /** Style animations the map has controls for, such as "bordersDraw". */
  animations?: string[];
  /** The frame size, which decides when a region is large enough on screen to appear. */
  viewport?: { width: number; height: number };
};

/** Water polygons from region tiles below this zoom can be triangulated wrongly (wedges across rivers). */
export const REGION_WATER_MIN_ZOOM = 12;

/** A region file's bounds from its PMTiles v3 header (read synchronously), or null. */
export function regionBounds(name: string): Bbox | null {
  try {
    const nodeFs = fs();
    const fd = nodeFs.openSync(regionArchivePath(name), "r");
    const header = new Uint8Array(127);
    nodeFs.readSync(fd, header, 0, 127, 0);
    nodeFs.closeSync(fd);
    const view = new DataView(header.buffer);
    return { west: view.getInt32(102, true) / 1e7, south: view.getInt32(106, true) / 1e7, east: view.getInt32(110, true) / 1e7, north: view.getInt32(114, true) / 1e7 };
  } catch {
    return null;
  }
}

export const REGION_FADE = { from: 9, to: 9.8 } as const;
export const BORDERS_DRAW_LAYER = "boundaries";

const OPACITY_PROPERTY: Partial<Record<LayerSpecification["type"], string>> = {
  fill: "fill-opacity",
  line: "line-opacity",
  circle: "circle-opacity",
  symbol: "text-opacity",
  "fill-extrusion": "fill-extrusion-opacity",
  raster: "raster-opacity"
};

/** Multiplies a layer's constant opacity by a zoom ramp; layers with zoom-dependent opacity only get the zoom limit. */
function rampOpacity(layer: LayerSpecification, from: number, to: number, fadeIn: boolean): LayerSpecification {
  const key = OPACITY_PROPERTY[layer.type];
  if (!key) return layer;
  const paint = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };
  const current = paint[key] ?? 1;
  if (typeof current !== "number") return layer;
  paint[key] = fadeIn ? ["interpolate", ["linear"], ["zoom"], from, 0, to, current] : ["interpolate", ["linear"], ["zoom"], from, current, to, 0];
  return { ...layer, paint } as LayerSpecification;
}

export function worldOverlayPath(name: "borders.geojson" | "labels.json"): string {
  return path().join(extensionRoot(), "data", name);
}

let bordersCache: unknown = null;

function bordersData(): unknown {
  if (!bordersCache) bordersCache = JSON.parse(fs().readFileSync(worldOverlayPath("borders.geojson"), "utf8"));
  return bordersCache;
}

function withAnimatedBorders(style: StyleSpecification): StyleSpecification {
  const index = style.layers.findIndex((l) => l.id === BORDERS_DRAW_LAYER);
  if (index < 0) return style;
  const original = style.layers[index] as LayerSpecification & { paint?: Record<string, unknown>; metadata?: unknown };
  const layers = [...style.layers];
  layers[index] = {
    id: BORDERS_DRAW_LAYER,
    type: "line",
    source: "lml-borders",
    metadata: original.metadata,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": (original.paint?.["line-width"] as number) ?? 1,
      "line-gradient": bordersGradient(100)
    }
  } as LayerSpecification;
  return { ...style, sources: { ...style.sources, "lml-borders": { type: "geojson", data: bordersData() as GeoJSON.FeatureCollection, lineMetrics: true } }, layers };
}

export const BORDERS_COLOR = "#9fb3c6";

/** The line gradient that shows the first `percent` % of every border line. */
export function bordersGradient(percent: number): unknown {
  const p = Math.max(0, Math.min(100, percent)) / 100;
  if (p >= 1) return ["interpolate", ["linear"], ["line-progress"], 0, BORDERS_COLOR, 1, BORDERS_COLOR];
  if (p <= 0) return ["interpolate", ["linear"], ["line-progress"], 0, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0)"];
  const soft = Math.min(0.02, p / 2);
  return ["interpolate", ["linear"], ["line-progress"], 0, BORDERS_COLOR, p - soft, BORDERS_COLOR, p, "rgba(159,179,198,0)", 1, "rgba(159,179,198,0)"];
}

export function basemapStyle(basemap: BasemapSource, options: BasemapStyleOptions): StyleSpecification {
  let world = naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()), { labels: options.labels });
  if (options.animations?.includes("bordersDraw")) world = withAnimatedBorders(world);
  let style = world;
  const regions = regionNames(basemap);
  if (regions.length) {
    const groupOf = (l: LayerSpecification) => (l as { metadata?: Record<string, unknown> }).metadata?.["lml:group"];
    const viewport = options.viewport ?? { width: 1920, height: 1080 };
    const fades = regions.map((name) => {
      const bounds = regionBounds(name);
      return bounds ? regionFadeZooms(bounds, viewport) : { from: REGION_FADE.from, to: REGION_FADE.to };
    });
    // Natural Earth lines and labels give way where the first region's detail is complete.
    const worldFade = fades.reduce((a, b) => (b.to < a.to ? b : a));
    const worldLayers = world.layers.map((layer) => {
      if (layer.type === "background" || layer.type === "fill") return layer;
      return { ...rampOpacity(layer, worldFade.from, worldFade.to, false), maxzoom: worldFade.to } as LayerSpecification;
    });
    const sources = { ...world.sources };
    const regionLayers: LayerSpecification[] = [];
    let light = world.light;
    regions.forEach((name, index) => {
      const region = protomapsStyle(registerLocalArchive(name, regionArchivePath(name)), { labels: options.labels });
      light = region.light;
      // Several regions: one source each, layer ids made unique.
      const sourceId = index === 0 ? "osm" : `osm-${name}`;
      for (const [id, source] of Object.entries(region.sources)) sources[id === "osm" ? sourceId : id] = source;
      for (const layer of region.layers) {
        if (layer.type === "background") continue;
        const fade = groupOf(layer) === "water" ? { from: Math.max(REGION_WATER_MIN_ZOOM, fades[index].from), to: Math.max(REGION_WATER_MIN_ZOOM + 0.6, fades[index].to) } : fades[index];
        const minzoom = (layer as { minzoom?: number }).minzoom ?? 0;
        const faded = minzoom >= fade.to ? layer : ({ ...rampOpacity(layer, fade.from, fade.to, true), minzoom: fade.from } as LayerSpecification);
        // Region layer ids carry the region name, so they never clash with the world layers.
        regionLayers.push({ ...faded, id: `${layer.id}@${name}`, source: sourceId } as LayerSpecification);
      }
    });
    style = {
      ...world,
      name: `${world.name} + ${regions.join(", ")}`,
      sources,
      light,
      layers: [
        ...worldLayers.filter((l) => groupOf(l) !== "labels"),
        ...regionLayers.filter((l) => groupOf(l) !== "labels"),
        ...worldLayers.filter((l) => groupOf(l) === "labels"),
        ...regionLayers.filter((l) => groupOf(l) === "labels")
      ]
    };
  }
  style = withProjection(style, options.projection ?? "mercator");
  if (options.markers?.length) {
    style.sources["lml-markers"] = {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: options.markers.map((m) => ({
          type: "Feature",
          properties: { radius: m.radius ?? 5, color: m.color ?? "#ff0000" },
          geometry: { type: "Point", coordinates: [m.lng, m.lat] }
        }))
      }
    };
    style.layers.push({
      id: "lml-markers",
      type: "circle",
      source: "lml-markers",
      metadata: { "lml:group": "overlay" },
      paint: {
        "circle-radius": ["get", "radius"],
        "circle-color": ["get", "color"],
        "circle-pitch-alignment": "viewport",
        "circle-pitch-scale": "viewport"
      }
    });
  }
  return style;
}
