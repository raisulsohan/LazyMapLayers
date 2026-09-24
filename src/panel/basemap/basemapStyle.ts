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
import { naturalEarthStyle, type WorldImagery } from "./naturalEarthStyle.ts";
import { hasImagery, imageryPath } from "../imagery/packs.ts";
import { protomapsStyle } from "./protomapsStyle.ts";
import { withProjection } from "./projection.ts";
import { regionTiers, type ZoomRamp } from "../../core/tiles/regionFade.ts";
import { hexToRgb, themeFrom, type Theme, type ThemeLike } from "../../core/style/themes.ts";
import type { DataFill } from "../../core/style/dataFill.ts";
import type { HeatSetting } from "../../core/style/heat.ts";
import { OWN_IMAGERY_LAYER, OWN_IMAGERY_SOURCE, ownImageryLayer, ownImagerySource, type OwnImagery } from "../../core/style/ownImagery.ts";
import type { Areas, Highlight } from "../../core/style/highlights.ts";
import { hillshadeIndex, hillshadePaint, type TerrainSetting } from "../../core/style/terrain.ts";
import type { Bbox } from "../../core/tiles/tileMath.ts";
import { hasTerrainPack, terrainArchivePath } from "../terrain.ts";

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
  /** The map's look (core/style/themes.ts); the default theme when missing or unknown. */
  theme?: ThemeLike;
  /** Shaded relief over the land (needs the relief pack; ignored by satellite looks). */
  relief?: boolean;
  /** Highlighted countries and custom areas (their own render pass), and the areas' polygons. */
  highlights?: Highlight[];
  /** Numbers on the map: a colour per country (a choropleth). */
  data?: DataFill | null;
  /** Heat: points that warm the map around them (their own render pass). */
  heat?: HeatSetting | null;
  areas?: Areas;
  /** Adds an invisible layer of country shapes, so the preview can tell which country was clicked. */
  countryHits?: boolean;
  /** The sky above the horizon of a tilted flat map (default on; off leaves it transparent). */
  sky?: boolean;
  /** Tiles of the user's own (an XYZ address or a PMTiles archive), drawn over the ground and under the lines. */
  own?: OwnImagery | null;
  /** The map's elevation pack and how strongly slopes are shaded; ignored when the pack is not on this computer. */
  terrain?: TerrainSetting | null;
};

export const HILLSHADE_SOURCE = "lml-hillshade";
/** 3D terrain reads the pack through its own source (MapLibre asks for that). */
export const TERRAIN_SOURCE = "lml-terrain-3d";

/** True when the terrain setting names a pack that is installed here. */
export const terrainUsable = (terrain: TerrainSetting | null | undefined): terrain is TerrainSetting => !!terrain && hasTerrainPack(terrain.pack);

/**
 * Water polygons from region tiles of zoom 12 and below can be triangulated wrongly (wedges across
 * rivers), so they wait for zoom 13 tiles; rivers and canals show as lines before that. Regions with no
 * tiles past zoom 12 never draw water polygons (the sea still shows between their land polygons).
 */
export const REGION_WATER_MIN_ZOOM = 13;
const WATER_POLYGON_LAYER = "water";

/** A region file's bounds and maximum zoom from its PMTiles v3 header (read synchronously), or null. */
export function regionHeader(name: string): { bounds: Bbox; maxZoom: number } | null {
  try {
    const nodeFs = fs();
    const fd = nodeFs.openSync(regionArchivePath(name), "r");
    const header = new Uint8Array(127);
    nodeFs.readSync(fd, header, 0, 127, 0);
    nodeFs.closeSync(fd);
    const view = new DataView(header.buffer);
    return {
      bounds: { west: view.getInt32(102, true) / 1e7, south: view.getInt32(106, true) / 1e7, east: view.getInt32(110, true) / 1e7, north: view.getInt32(114, true) / 1e7 },
      maxZoom: header[101]
    };
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
  return fadeIn ? rampWindow(layer, { from, to }, null) : rampWindow(layer, null, { from, to });
}

/**
 * Fades a layer in over `fadeIn` and out over `fadeOut` (either may be null), and limits its zoom range
 * to match. A constant opacity is folded into the ramps; a zoom-dependent one keeps its own curve.
 */
function rampWindow(layer: LayerSpecification, fadeIn: ZoomRamp | null, fadeOut: ZoomRamp | null): LayerSpecification {
  const limited = { ...layer } as LayerSpecification & { minzoom?: number; maxzoom?: number };
  if (fadeIn && (limited.minzoom ?? 0) < fadeIn.from) limited.minzoom = fadeIn.from;
  if (fadeOut) limited.maxzoom = Math.min(limited.maxzoom ?? 24, fadeOut.to);
  const key = OPACITY_PROPERTY[layer.type];
  if (!key) return limited;
  const paint = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };
  const current = paint[key] ?? 1;
  if (typeof current !== "number") return limited;
  const stops: number[] = [];
  if (fadeIn) stops.push(fadeIn.from, 0, fadeIn.to, current);
  if (fadeOut) stops.push(Math.max(fadeOut.from, stops.length ? stops[stops.length - 2] + 1e-3 : fadeOut.from), current, Math.max(fadeOut.to, (stops.length ? stops[stops.length - 2] : fadeOut.from) + 2e-3), 0);
  if (!stops.length) return limited;
  paint[key] = ["interpolate", ["linear"], ["zoom"], ...stops];
  return { ...limited, paint } as LayerSpecification;
}

export function worldOverlayPath(name: "borders.geojson" | "labels.json"): string {
  return path().join(extensionRoot(), "data", name);
}

let bordersCache: unknown = null;

function bordersData(): unknown {
  if (!bordersCache) bordersCache = JSON.parse(fs().readFileSync(worldOverlayPath("borders.geojson"), "utf8"));
  return bordersCache;
}

function withAnimatedBorders(style: StyleSpecification, theme: Theme): StyleSpecification {
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
      "line-gradient": bordersGradient(100, theme.border)
    }
  } as LayerSpecification;
  return { ...style, sources: { ...style.sources, "lml-borders": { type: "geojson", data: bordersData() as GeoJSON.FeatureCollection, lineMetrics: true } }, layers };
}

/** Metadata key under which the borders layer carries its colour (themes change it). */
export const LAYER_COLOR_KEY = "lml:color";

/** The line gradient that shows the first `percent` % of every border line, in the layer's colour. */
export function bordersGradient(percent: number, color: string): unknown {
  const p = Math.max(0, Math.min(100, percent)) / 100;
  const [r, g, b] = hexToRgb(color).map((v) => Math.round(v * 255));
  const clear = `rgba(${r},${g},${b},0)`;
  if (p >= 1) return ["interpolate", ["linear"], ["line-progress"], 0, color, 1, color];
  if (p <= 0) return ["interpolate", ["linear"], ["line-progress"], 0, clear, 1, clear];
  const soft = Math.min(0.02, p / 2);
  return ["interpolate", ["linear"], ["line-progress"], 0, color, p - soft, color, p, clear, 1, clear];
}

/** The user's tiles after the last ground fill of the world (background, land, water, imagery) and before its first line. */
function withOwnImagery(style: StyleSpecification, own: OwnImagery): StyleSpecification {
  const groupOf = (l: LayerSpecification) => String((l as { metadata?: Record<string, unknown> }).metadata?.["lml:group"] ?? "");
  const layers = [...style.layers];
  let at = 0;
  layers.forEach((layer, index) => {
    if ((layer.type === "background" || layer.type === "fill" || layer.type === "raster") && ["background", "land", "water", "imagery"].includes(groupOf(layer))) at = index + 1;
  });
  layers.splice(at, 0, ownImageryLayer(own) as unknown as LayerSpecification);
  return { ...style, sources: { ...style.sources, [OWN_IMAGERY_SOURCE]: ownImagerySource(own) as unknown as StyleSpecification["sources"][string] }, layers };
}

export function basemapStyle(basemap: BasemapSource, options: BasemapStyleOptions): StyleSpecification {
  const theme = themeFrom(options.theme);
  const imagery: WorldImagery = {};
  if (theme.satellite && hasImagery("blue-marble")) imagery.satelliteUrl = registerLocalArchive("lml-blue-marble", imageryPath("blue-marble"));
  if (options.relief && !theme.satellite && hasImagery("relief")) imagery.reliefUrl = registerLocalArchive("lml-relief", imageryPath("relief"));
  let world = naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()), { labels: options.labels, theme, imagery, highlights: options.highlights, areas: options.areas, data: options.data, heat: options.heat, countryHits: options.countryHits });
  if (options.animations?.includes("bordersDraw")) world = withAnimatedBorders(world, theme);
  if (options.own) world = withOwnImagery(world, options.own);
  let style = world;
  const regions = regionNames(basemap);
  if (regions.length) {
    const groupOf = (l: LayerSpecification) => (l as { metadata?: Record<string, unknown> }).metadata?.["lml:group"];
    const ground = (l: LayerSpecification) => (l.type === "background" || l.type === "fill" || l.type === "raster") && ["background", "land", "water", "imagery"].includes(String(groupOf(l)));
    const viewport = options.viewport ?? { width: 1920, height: 1080 };
    const headers = regions.map((name) => ({ name, header: regionHeader(name) }));
    const tiers = regionTiers(
      headers.filter((h) => h.header).map((h) => ({ name: h.name, bounds: h.header!.bounds, maxZoom: h.header!.maxZoom })),
      viewport
    );
    const tierOf = (name: string) => tiers[name] ?? { fadeIn: { from: REGION_FADE.from, to: REGION_FADE.to }, fadeOut: null };
    // Natural Earth lines and labels give way where the first region's detail is complete.
    const worldFade = regions.map((name) => tierOf(name).fadeIn).reduce((a, b) => (b.to < a.to ? b : a));
    // Highlights are not part of the hand-over: they stay whole at every zoom, above the regions.
    const worldLayers = world.layers.map((layer) => {
      if (layer.type === "background" || layer.type === "fill" || groupOf(layer) === "highlight") return layer;
      return { ...rampOpacity(layer, worldFade.from, worldFade.to, false), maxzoom: worldFade.to } as LayerSpecification;
    });
    const sources = { ...world.sources };
    const regionLayers: LayerSpecification[] = [];
    let light = world.light;
    regions.forEach((name, index) => {
      const region = protomapsStyle(registerLocalArchive(name, regionArchivePath(name)), { labels: options.labels, theme });
      light = region.light;
      // Several regions: one source each, layer ids made unique.
      const sourceId = index === 0 ? "osm" : `osm-${name}`;
      for (const [id, source] of Object.entries(region.sources)) sources[id === "osm" ? sourceId : id] = source;
      const tier = tierOf(name);
      const maxZoom = headers[index].header?.maxZoom ?? 15;
      for (const layer of region.layers) {
        if (layer.type === "background") continue;
        const group = groupOf(layer);
        const polygons = layer.id === WATER_POLYGON_LAYER;
        if (polygons && maxZoom < REGION_WATER_MIN_ZOOM) continue;
        const fadeIn = polygons ? { from: Math.max(REGION_WATER_MIN_ZOOM, tier.fadeIn.from), to: Math.max(REGION_WATER_MIN_ZOOM + 0.5, tier.fadeIn.to) } : tier.fadeIn;
        // A wider region keeps its land and water under a detailed one, but hands over its lines.
        const fadeOut = tier.fadeOut && group !== "land" && group !== "water" ? tier.fadeOut : null;
        const minzoom = (layer as { minzoom?: number }).minzoom ?? 0;
        const faded = rampWindow(layer, minzoom >= fadeIn.to ? null : fadeIn, fadeOut);
        // Region layer ids carry the region name, so they never clash with the world layers.
        regionLayers.push({ ...faded, id: `${layer.id}@${name}`, source: sourceId } as LayerSpecification);
      }
    });
    style = {
      ...world,
      name: `${world.name} + ${regions.join(", ")}`,
      sources,
      light,
      // With the user's own tiles, every ground fill (world and region) goes under them and every line
      // over them, so a downloaded area's roads and buildings stand on the picture.
      layers: options.own
        ? [
            ...worldLayers.filter((l) => ground(l) && l.id !== OWN_IMAGERY_LAYER),
            ...regionLayers.filter((l) => ground(l)),
            ...worldLayers.filter((l) => l.id === OWN_IMAGERY_LAYER),
            ...worldLayers.filter((l) => !ground(l) && groupOf(l) !== "labels" && groupOf(l) !== "highlight"),
            ...regionLayers.filter((l) => !ground(l) && groupOf(l) !== "labels"),
            ...worldLayers.filter((l) => groupOf(l) === "highlight"),
            ...worldLayers.filter((l) => groupOf(l) === "labels"),
            ...regionLayers.filter((l) => groupOf(l) === "labels")
          ]
        : [
            ...worldLayers.filter((l) => groupOf(l) !== "labels" && groupOf(l) !== "highlight"),
            ...regionLayers.filter((l) => groupOf(l) !== "labels"),
            ...worldLayers.filter((l) => groupOf(l) === "highlight"),
            ...worldLayers.filter((l) => groupOf(l) === "labels"),
            ...regionLayers.filter((l) => groupOf(l) === "labels")
          ]
    };
  }
  if (terrainUsable(options.terrain) && options.terrain.height > 0) {
    // 3D terrain: the ground rises by the pack's elevation times the height. The centre point is held at
    // ground × height by whoever moves the camera (the renderer and the preview), see core/ae/projectionExpression.ts.
    style = {
      ...style,
      sources: { ...style.sources, [TERRAIN_SOURCE]: { type: "raster-dem", url: registerLocalArchive(`lml-terrain-${options.terrain.pack}`, terrainArchivePath(options.terrain.pack)), encoding: "terrarium", tileSize: 512 } },
      terrain: { source: TERRAIN_SOURCE, exaggeration: options.terrain.height }
    };
  }
  if (terrainUsable(options.terrain) && options.terrain.shade > 0) {
    // Shaded slopes from the elevation pack, above the ground's colours and below everything drawn on it.
    // They count as imagery: part of the base, land and water passes, never of the mattes.
    const layers = style.layers.slice();
    layers.splice(hillshadeIndex(layers.map((l) => String((l as { metadata?: Record<string, unknown> }).metadata?.["lml:group"] ?? "overlay"))), 0, {
      id: "hillshade",
      type: "hillshade",
      // Its own group, so it can be rendered as its own pass; the land and water passes still hold it.
      metadata: { "lml:group": "terrain" },
      source: HILLSHADE_SOURCE,
      paint: hillshadePaint(theme, options.terrain.shade)
    } as LayerSpecification);
    style = {
      ...style,
      sources: { ...style.sources, [HILLSHADE_SOURCE]: { type: "raster-dem", url: registerLocalArchive(`lml-terrain-${options.terrain.pack}`, terrainArchivePath(options.terrain.pack)), encoding: "terrarium", tileSize: 512, attribution: "© Mapterhorn" } },
      layers
    };
  }
  style = withProjection(style, options.projection ?? "mercator", theme, options.sky !== false);
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
