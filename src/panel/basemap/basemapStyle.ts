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
import { hasOfflineWorld, naturalEarthArchivePath, offlineWorldPath, regionArchivePath, registerLocalArchive } from "./maplibreSetup.ts";
import { naturalEarthStyle, type WorldImagery } from "./naturalEarthStyle.ts";
import { hasImagery, imageryPath } from "../imagery/packs.ts";
import { hasSatellite, satellitePath } from "../imagery/sentinelBuild.ts";
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
import type { HistorySetting } from "../../core/history/historyStyle.ts";
import { loadHistoryYear, type LoadedYear } from "../data/history.ts";
import { historyDrawData, isHistoryLayer, withHistory } from "./historyLayers.ts";

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
  /** Draw the offline world when it is installed (the default); false leaves it out, for comparisons. */
  offlineWorld?: boolean;
  /** The world of another year instead of today's countries (D92); ignored when the pack or year is missing. */
  history?: HistorySetting | null;
  /** The pack's years a keyed History Year slider passes through; each is drawn and cross-faded per frame. */
  historyYears?: number[];
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

/**
 * Where the offline world (OpenStreetMap to zoom 9, D91) takes over from Natural Earth's lines. Natural
 * Earth carries the globe and the continents; from here on the coastlines, rivers, roads and borders of
 * every country come from the offline world, and downloaded regions draw over it as before.
 */
export const WORLD_DETAIL_FADE = { from: 6, to: 7 } as const;
/** The offline world's layers carry this name, like a region's carry the region's. */
export const WORLD_DETAIL = "world";
/** The world map's shaded relief (naturalEarthStyle), which goes over the offline world's ground. */
const RELIEF_LAYER = "relief";
/** Water kinds drawn as polygons from the offline world's low-zoom tiles: wide water reads well there,
 * while river polygons that thin are where low-zoom tiles go wrong (rivers stay as lines). */
const WORLD_DETAIL_WATER: string[] = ["ocean", "sea", "lake", "water", "reservoir", "lagoon", "bay", "strait", "basin"];
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

function withAnimatedBorders(style: StyleSpecification, theme: Theme, data: unknown = bordersData()): StyleSpecification {
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
  return { ...style, sources: { ...style.sources, "lml-borders": { type: "geojson", data: data as GeoJSON.FeatureCollection, lineMetrics: true } }, layers };
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
  const source = ownImagerySource(own, (name) => (hasSatellite(name) ? registerLocalArchive(`lml-satellite-${name}`, satellitePath(name)) : null));
  return { ...style, sources: { ...style.sources, [OWN_IMAGERY_SOURCE]: source as unknown as StyleSpecification["sources"][string] }, layers };
}

export function basemapStyle(basemap: BasemapSource, options: BasemapStyleOptions): StyleSpecification {
  const theme = themeFrom(options.theme);
  const imagery: WorldImagery = {};
  if (theme.satellite && hasImagery("blue-marble")) imagery.satelliteUrl = registerLocalArchive("lml-blue-marble", imageryPath("blue-marble"));
  if (options.relief && !theme.satellite && hasImagery("relief")) imagery.reliefUrl = registerLocalArchive("lml-relief", imageryPath("relief"));
  let world = naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()), { labels: options.labels, theme, imagery, highlights: options.highlights, areas: options.areas, data: options.data, heat: options.heat, countryHits: options.countryHits });
  // Another year: its shapes, borders and names take the place of today's countries.
  const pastYears = options.history ? (options.historyYears?.length ? options.historyYears : [options.history.year]).map(loadHistoryYear).filter((y): y is LoadedYear => !!y) : [];
  const past = pastYears[0] ?? null;
  if (past) world = withHistory(world, pastYears, theme, { labels: options.labels, satellite: !!imagery.satelliteUrl });
  // Several years cross-fade their own borders; the draw-on then has no layer to draw.
  if (options.animations?.includes("bordersDraw")) world = withAnimatedBorders(world, theme, past ? historyDrawData(past) : undefined);
  if (options.own) world = withOwnImagery(world, options.own);
  let style = world;
  const regions = regionNames(basemap);
  // The offline world goes under every map, the world map included, when the data pack is installed.
  const detail = options.offlineWorld !== false && hasOfflineWorld();
  if (regions.length || detail) {
    const groupOf = (l: LayerSpecification) => (l as { metadata?: Record<string, unknown> }).metadata?.["lml:group"];
    const ground = (l: LayerSpecification) => (l.type === "background" || l.type === "fill" || l.type === "raster") && ["background", "land", "water", "imagery"].includes(String(groupOf(l)));
    const viewport = options.viewport ?? { width: 1920, height: 1080 };
    const headers = regions.map((name) => ({ name, header: regionHeader(name) }));
    const tiers = regionTiers(
      headers.filter((h) => h.header).map((h) => ({ name: h.name, bounds: h.header!.bounds, maxZoom: h.header!.maxZoom })),
      viewport
    );
    const tierOf = (name: string) => tiers[name] ?? { fadeIn: { from: REGION_FADE.from, to: REGION_FADE.to }, fadeOut: null };
    // Natural Earth lines and labels give way where the first detail - the offline world, else a region - is complete.
    const earliest = (list: ZoomRamp[]) => (list.length ? list.reduce((a, b) => (b.to < a.to ? b : a)) : null);
    const regionFade = earliest(regions.map((name) => tierOf(name).fadeIn));
    const worldFade = earliest([...(detail ? [WORLD_DETAIL_FADE] : []), ...(regionFade ? [regionFade] : [])])!;
    // Highlights are not part of the hand-over: they stay whole at every zoom, above the regions. Pictures
    // (satellite, relief, the user's tiles) give way to a region's detail only: the offline world draws
    // its lines over them.
    const worldLayers = world.layers.map((layer) => {
      // The past has no detail to hand over to: its borders and names stay at every zoom.
      if (layer.type === "background" || layer.type === "fill" || groupOf(layer) === "highlight" || isHistoryLayer(layer)) return layer;
      if (layer.type === "raster") return regionFade ? ({ ...rampOpacity(layer, regionFade.from, regionFade.to, false), maxzoom: regionFade.to } as LayerSpecification) : layer;
      return { ...rampOpacity(layer, worldFade.from, worldFade.to, false), maxzoom: worldFade.to } as LayerSpecification;
    });
    // A look that colours every country keeps its colours until they fade (7.5 to 9.5); the offline
    // world's ground fades in over the same zooms, its lines at the usual hand-over.
    const detailGroundFade: ZoomRamp = theme.countryFills || past ? { from: 7.5, to: 9.5 } : WORLD_DETAIL_FADE;
    // Today's borders of the offline world and the regions would cross the past's.
    const todaysBorder = (layer: LayerSpecification) => !!past && layer.id.startsWith("boundaries");
    const sources = { ...world.sources };
    const detailLayers: LayerSpecification[] = [];
    const regionLayers: LayerSpecification[] = [];
    let light = world.light;
    // The offline world, under the downloaded regions: their ground covers it where they have detail.
    if (detail) {
      const offline = protomapsStyle(registerLocalArchive("lml-offline-world", offlineWorldPath()), { labels: options.labels, theme });
      const sourceId = "osm-world";
      // Over a satellite picture the picture is the ground: only lines and names come from the offline world.
      const satellite = !!imagery.satelliteUrl;
      for (const [id, source] of Object.entries(offline.sources)) sources[id === "osm" ? sourceId : id] = source;
      for (const layer of offline.layers) {
        if (layer.type === "background" || todaysBorder(layer)) continue;
        const group = groupOf(layer);
        if (satellite && (group === "land" || group === "water")) continue;
        let shown: LayerSpecification = layer;
        if (layer.id === WATER_POLYGON_LAYER) shown = { ...layer, filter: ["in", ["get", "kind"], ["literal", WORLD_DETAIL_WATER]] } as LayerSpecification;
        const fade = ground(layer) ? detailGroundFade : WORLD_DETAIL_FADE;
        const minzoom = (layer as { minzoom?: number }).minzoom ?? 0;
        // Like a wide region under a detailed one: its ground stays to fill the far field, but its lines
        // and names hand over where a downloaded region comes in, so a city is never drawn twice (and
        // its zoom 9 tiles need not be drawn again at street zooms).
        const faded = rampWindow(shown, minzoom >= fade.to ? null : fade, ground(layer) ? null : regionFade);
        detailLayers.push({ ...faded, id: `${layer.id}@${WORLD_DETAIL}`, source: sourceId } as LayerSpecification);
      }
    }
    regions.forEach((name, index) => {
      const region = protomapsStyle(registerLocalArchive(name, regionArchivePath(name)), { labels: options.labels, theme });
      light = region.light;
      // Several regions: one source each, layer ids made unique.
      const sourceId = index === 0 ? "osm" : `osm-${name}`;
      for (const [id, source] of Object.entries(region.sources)) sources[id === "osm" ? sourceId : id] = source;
      const tier = tierOf(name);
      const maxZoom = headers[index].header?.maxZoom ?? 15;
      for (const layer of region.layers) {
        if (layer.type === "background" || todaysBorder(layer)) continue;
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
    const lastWorldGround = worldLayers.reduce((at, layer, index) => (ground(layer) ? index : at), -1);
    // The shaded relief and the user's own tiles are drawn once more over the offline world's ground,
    // coming in as it does (and giving way to a region as the originals do), so they never disappear.
    const liftedPictures = detail
      ? world.layers
          .filter((layer) => layer.id === RELIEF_LAYER || layer.id === OWN_IMAGERY_LAYER)
          .map((layer) => ({ ...rampWindow(layer, detailGroundFade, regionFade), id: `${layer.id}@${WORLD_DETAIL}` }) as LayerSpecification)
      : [];
    style = {
      ...world,
      name: `${world.name} + ${[...(detail ? [WORLD_DETAIL] : []), ...regions].join(", ")}`,
      sources,
      light,
      // With the offline world: the ground of the world, then the offline world's ground with the shaded
      // relief over it (the relief must not vanish where the offline world takes over), then the regions'
      // ground and the user's own tiles; every line over all the ground, highlights and names on top.
      // With the user's own tiles, every ground fill (world and region) goes under them and every line
      // over them, so a downloaded area's roads and buildings stand on the picture.
      layers: detail
        ? [
            // The world map in its own order up to its last ground layer, so nothing changes out where the
            // offline world has not come in yet.
            ...worldLayers.slice(0, lastWorldGround + 1).filter((l) => groupOf(l) !== "labels" && groupOf(l) !== "highlight"),
            ...detailLayers.filter((l) => ground(l)),
            ...liftedPictures.filter((l) => l.id.startsWith(`${RELIEF_LAYER}@`)),
            ...regionLayers.filter((l) => ground(l)),
            ...liftedPictures.filter((l) => l.id.startsWith(`${OWN_IMAGERY_LAYER}@`)),
            ...worldLayers.slice(lastWorldGround + 1).filter((l) => groupOf(l) !== "labels" && groupOf(l) !== "highlight"),
            ...detailLayers.filter((l) => !ground(l) && groupOf(l) !== "labels"),
            ...regionLayers.filter((l) => !ground(l) && groupOf(l) !== "labels"),
            ...worldLayers.filter((l) => groupOf(l) === "highlight"),
            ...worldLayers.filter((l) => groupOf(l) === "labels"),
            ...detailLayers.filter((l) => groupOf(l) === "labels"),
            ...regionLayers.filter((l) => groupOf(l) === "labels")
          ]
        : options.own
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
