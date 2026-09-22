// The preview map shows exactly the frame that renders. Its box has the comp's size in CSS pixels and is
// scaled down to fit the panel, with the pixel ratio lowered by the same factor: MapLibre works at the
// comp's own zoom (same framing, tiles and fades as the final frames) while the GPU only draws as many
// pixels as the panel shows. MapLibre corrects mouse positions for the scale.
//
// Scaled down, labels and lines would be a fraction of their size and unreadable, so by default the
// preview's text and line sizes are scaled up by the same factor ("readable"). The exact look, with
// sizes as they render, is one click away.

import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../core/camera/camera.ts";
import type { MapProjection } from "../core/camera/globe.ts";
import { isoOfCountry } from "../core/data/boundarySet.ts";
import type { Imported } from "../core/data/importLines.ts";
import { simplifyLine } from "../core/geo/simplify.ts";
import type { Areas, Highlight } from "../core/style/highlights.ts";
import type { ThemeLike } from "../core/style/themes.ts";
import type { DataFill } from "../core/style/dataFill.ts";
import { scaleStyleSizes } from "../core/style/scaleStyle.ts";
import type { TerrainSetting } from "../core/style/terrain.ts";
import { COUNTRY_HIT_LAYER } from "./basemap/naturalEarthStyle.ts";
import { basemapStyle, regionNames, type BasemapSource } from "./basemap/basemapStyle.ts";
import { ensureMaplibreWorker, regionArchivePath } from "./basemap/maplibreSetup.ts";
import { fs, isInCep } from "./cep.ts";

export type PreviewEvents = {
  onView: (view: View) => void;
  onMoveEnd: (view: View, byUser: boolean) => void;
  onClick: (position: { lat: number; lng: number }, event: MouseEvent, point: { x: number; y: number }) => void;
  onError: (message: string) => void;
};

const DEFAULT_COMP = { width: 1920, height: 1080 };

let map: maplibregl.Map | null = null;
let wrap: HTMLElement | null = null;
let box: HTMLElement | null = null;
let comp = { ...DEFAULT_COMP };
/** Scale of the comp-sized box inside the panel (1 = full size). */
let scale = 1;
let observer: ResizeObserver | null = null;
/** Event data that marks a move started from the panel's own controls (the zoom strip) as the user's. */
const BY_USER = { lmlByUser: true };

/** A plain style for running the panel in a normal browser (development only). */
const BLANK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#0d1b2a" } }] };

/** What the preview shows now, so the style can be rebuilt when the panel is resized. */
export type Look = { theme: ThemeLike; relief: boolean; highlights?: Highlight[]; areas?: Areas; data?: DataFill | null; sky?: boolean; terrain?: TerrainSetting | null };
let shown: { source: BasemapSource; projection: MapProjection; look: Look } = { source: { kind: "world" }, projection: "mercator", look: { theme: null, relief: false } };
/** False shows sizes exactly as they render (tiny in a small panel). */
let readable = true;

/** Sizes are scaled up by the inverse of the preview's scale (in steps, so resizing rarely restyles). */
function sizeFactor(): number {
  if (!readable) return 1;
  return Math.max(1, Math.min(8, Math.round((1 / Math.max(0.01, scale)) * 4) / 4));
}

/** The imported file the Import sheet lists, drawn over the preview only (never rendered). */
let importOverlay: GeoJSON.FeatureCollection | null = null;
const IMPORT_SOURCE = "lml-import";

/** Shows an imported file's lines and places in the preview, or clears them (null). */
export function setPreviewImport(data: Pick<Imported, "lines" | "places"> | null): void {
  const next: GeoJSON.FeatureCollection | null = data && {
    type: "FeatureCollection",
    features: [
      // Light enough to redraw while the view moves: the longest lines, thinned.
      ...data.lines.slice(0, 60).map((line) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: simplifyLine(line.points, 1500).map((p) => [p.lng, p.lat]) }
      })),
      ...data.places.slice(0, 500).map((place) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] } }))
    ]
  };
  if (!next && !importOverlay) return;
  importOverlay = next;
  setPreviewStyle(shown.source, shown.projection, shown.look);
}

function withImportOverlay(style: StyleSpecification): StyleSpecification {
  if (!importOverlay) return style;
  // Sized for the panel, whatever the scale of the preview box.
  const k = 1 / Math.max(0.05, scale);
  const overlay = { "lml:group": "overlay" };
  return {
    ...style,
    sources: { ...style.sources, [IMPORT_SOURCE]: { type: "geojson", data: importOverlay, tolerance: 0.2 } },
    layers: [
      ...style.layers,
      { id: "lml-import-casing", type: "line", metadata: overlay, source: IMPORT_SOURCE, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#0b1621", "line-opacity": 0.7, "line-width": 4.5 * k } },
      { id: "lml-import-line", type: "line", metadata: overlay, source: IMPORT_SOURCE, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffc740", "line-width": 2.2 * k } },
      { id: "lml-import-places", type: "circle", metadata: overlay, source: IMPORT_SOURCE, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 3.2 * k, "circle-color": "#ffffff", "circle-stroke-color": "#0b1621", "circle-stroke-width": 1.4 * k } }
    ]
  };
}

export function previewStyle(source: BasemapSource, projection: MapProjection, look: Look = { theme: null, relief: false }): StyleSpecification {
  if (!isInCep()) return withImportOverlay(BLANK_STYLE);
  const usable: BasemapSource = regionNames(source).every((name) => fs().existsSync(regionArchivePath(name))) ? source : { kind: "world" };
  const style = scaleStyleSizes(basemapStyle(usable, { labels: true, projection, viewport: comp, theme: look.theme, relief: look.relief, highlights: look.highlights, areas: look.areas, data: look.data, countryHits: true, sky: look.sky, terrain: look.terrain }), sizeFactor(), (layer) => layer.metadata?.["lml:group"] === "highlight");
  return withImportOverlay(style);
}

let styledFactor = 1;
let restyleTimer: ReturnType<typeof setTimeout> | null = null;

/** Rebuilds the style when the size factor changed (after the panel was resized). */
function restyleSoon(): void {
  if (restyleTimer) clearTimeout(restyleTimer);
  restyleTimer = setTimeout(() => {
    restyleTimer = null;
    if (map && (sizeFactor() !== styledFactor || importOverlay)) setPreviewStyle(shown.source, shown.projection, shown.look);
  }, 250);
}

export const previewReadable = () => readable;

export function setPreviewReadable(value: boolean): void {
  if (readable === value) return;
  readable = value;
  setPreviewStyle(shown.source, shown.projection, shown.look);
}

function toCompView(m: maplibregl.Map): View {
  const c = m.getCenter();
  return { center: { lng: c.lng, lat: c.lat }, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
}


let overlay: HTMLElement | null = null;

/** An element laid over the preview, framed exactly like the comp (the keep-out zones are drawn in it). */
export function setPreviewOverlay(node: HTMLElement | null): void {
  overlay = node;
  layout();
}

function layout(): void {
  if (!wrap || !box) return;
  const availableWidth = wrap.clientWidth;
  const availableHeight = wrap.clientHeight;
  if (availableWidth < 2 || availableHeight < 2) return;
  const next = Math.min(availableWidth / comp.width, availableHeight / comp.height);
  const sized = box.style.width === `${comp.width}px` && box.style.height === `${comp.height}px`;
  box.style.width = `${comp.width}px`;
  box.style.height = `${comp.height}px`;
  box.style.transformOrigin = "0 0";
  box.style.transform = `scale(${next})`;
  box.style.left = `${Math.floor((availableWidth - comp.width * next) / 2)}px`;
  box.style.top = `${Math.floor((availableHeight - comp.height * next) / 2)}px`;
  if (overlay) {
    overlay.style.left = box.style.left;
    overlay.style.top = box.style.top;
    overlay.style.width = `${Math.round(comp.width * next)}px`;
    overlay.style.height = `${Math.round(comp.height * next)}px`;
  }
  if (!map) {
    scale = next;
    return;
  }
  if (!sized) map.resize();
  if (!sized || Math.abs(next - scale) > 1e-4) {
    scale = next;
    // Draw only the pixels the panel shows (at most twice the comp's own resolution).
    map.setPixelRatio(Math.min(2, scale * (window.devicePixelRatio || 1)));
    restyleSoon();
  }
}

export function initPreview(wrapNode: HTMLElement, boxNode: HTMLElement, events: PreviewEvents): () => void {
  wrap = wrapNode;
  box = boxNode;
  layout();
  try {
    ensureMaplibreWorker();
    map = new maplibregl.Map({
      container: boxNode,
      style: previewStyle(shown.source, shown.projection, shown.look),
      center: [10, 25],
      zoom: 1.2,
      minZoom: -2,
      maxPitch: 85,
      pixelRatio: Math.min(2, scale * (window.devicePixelRatio || 1)),
      // The panel shows the data credit itself: inside the scaled box it would be too small to read.
      attributionControl: false,
      // Frames are captured for shot thumbnails inside the render event, so no preserved buffer is needed.
      fadeDuration: 0
    });
    const m = map;
    // With 3D terrain the centre point stays at the map's ground level, where the camera maths counts from.
    m.setCenterClampedToGround(false);
    m.on("move", () => events.onView(toCompView(m)));
    m.on("load", () => events.onView(toCompView(m)));
    m.on("moveend", (e) => {
      // Dragging and scrolling carry the original input event; moves made by code do not.
      const data = e as unknown as { originalEvent?: unknown; lmlByUser?: boolean };
      events.onMoveEnd(toCompView(m), !!data.originalEvent || !!data.lmlByUser);
    });
    m.on("error", (e) => events.onError(String(e.error?.message ?? e)));
    m.on("click", (e) => events.onClick({ lat: e.lngLat.lat, lng: e.lngLat.lng }, e.originalEvent, { x: e.point.x, y: e.point.y }));
  } catch (error) {
    events.onError(error instanceof Error ? error.message : String(error));
  }
  observer = new ResizeObserver(() => layout());
  observer.observe(wrapNode);
  return () => {
    observer?.disconnect();
    observer = null;
    map?.remove();
    map = null;
  };
}

export const previewMap = () => map;

/** The country under a point of the preview (in the map box's own pixels), or null over the sea. */
export function countryAt(point: { x: number; y: number }): { code: string; name: string; iso: string } | null {
  if (!map || !map.getLayer(COUNTRY_HIT_LAYER)) return null;
  const hit = map.queryRenderedFeatures([point.x, point.y], { layers: [COUNTRY_HIT_LAYER] })[0];
  const code = hit?.properties?.adm0_a3;
  if (typeof code !== "string" || !code) return null;
  return { code, name: String(hit.properties?.name_long ?? hit.properties?.name ?? code), iso: isoOfCountry(code, hit.properties?.iso_a3) };
}

/** The frame the preview shows, as a view of the comp. */
export function compView(): View | null {
  return map ? toCompView(map) : null;
}

export function setCompSize(width: number, height: number): void {
  if (width === comp.width && height === comp.height) return;
  const before = compView();
  // The same picture in a taller or shorter comp sits at a different zoom.
  const zoomChange = Math.log2(Math.max(16, height) / comp.height);
  comp = { width: Math.max(16, width), height: Math.max(16, height) };
  layout();
  if (before) showCompView({ ...before, zoom: before.zoom + zoomChange });
}

export const compSize = () => comp;

export function setPreviewStyle(source: BasemapSource, projection: MapProjection, look: Look = shown.look): void {
  shown = { source, projection, look };
  styledFactor = sizeFactor();
  map?.setStyle(previewStyle(source, projection, look));
  map?.setCenterElevation((look.terrain?.ground ?? 0) * (look.terrain?.height ?? 0));
}

/** Shows a view of the comp. `animate` glides there (for search results); otherwise it jumps. */
export function showCompView(view: View, animate = false): void {
  if (!map) return;
  const target = { center: [view.center.lng, view.center.lat] as [number, number], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch };
  if (animate) map.flyTo({ ...target, duration: 900, essential: true });
  else map.jumpTo(target);
}

export function zoomPreviewBy(delta: number): void {
  if (!map) return;
  map.easeTo({ zoom: map.getZoom() + delta, duration: 200 }, BY_USER);
}

export function resetNorth(levelPitch: boolean): void {
  if (!map) return;
  map.easeTo(levelPitch ? { bearing: 0, pitch: 0, duration: 300 } : { bearing: 0, duration: 300 }, BY_USER);
}

export function setCompZoom(zoom: number): void {
  if (!map) return;
  map.jumpTo({ zoom }, BY_USER);
}

/**
 * A small JPEG of what the preview shows now (a data URL), or null. The canvas is read inside the
 * render event, where the drawing buffer is still valid.
 */
export function captureThumbnail(width = 160): Promise<string | null> {
  const m = map;
  if (!m) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    m.once("render", () => {
      try {
        const source = m.getCanvas();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.max(1, Math.round((width * source.height) / Math.max(1, source.width)));
        const context = canvas.getContext("2d");
        if (!context) return finish(null);
        context.fillStyle = "#0b1118";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        finish(null);
      }
    });
    m.triggerRepaint();
    setTimeout(() => finish(null), 1500);
  });
}
