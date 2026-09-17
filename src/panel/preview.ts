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
import { scaleStyleSizes } from "../core/style/scaleStyle.ts";
import { basemapStyle, regionNames, type BasemapSource } from "./basemap/basemapStyle.ts";
import { ensureMaplibreWorker, regionArchivePath } from "./basemap/maplibreSetup.ts";
import { fs, isInCep } from "./cep.ts";

export type PreviewEvents = {
  onView: (view: View) => void;
  onMoveEnd: (view: View, byUser: boolean) => void;
  onClick: (position: { lat: number; lng: number }, event: MouseEvent) => void;
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
type Look = { theme: string | null; relief: boolean };
let shown: { source: BasemapSource; projection: MapProjection; look: Look } = { source: { kind: "world" }, projection: "mercator", look: { theme: null, relief: false } };
/** False shows sizes exactly as they render (tiny in a small panel). */
let readable = true;

/** Sizes are scaled up by the inverse of the preview's scale (in steps, so resizing rarely restyles). */
function sizeFactor(): number {
  if (!readable) return 1;
  return Math.max(1, Math.min(8, Math.round((1 / Math.max(0.01, scale)) * 4) / 4));
}

export function previewStyle(source: BasemapSource, projection: MapProjection, look: Look = { theme: null, relief: false }): StyleSpecification {
  if (!isInCep()) return BLANK_STYLE;
  const usable: BasemapSource = regionNames(source).every((name) => fs().existsSync(regionArchivePath(name))) ? source : { kind: "world" };
  return scaleStyleSizes(basemapStyle(usable, { labels: true, projection, viewport: comp, theme: look.theme, relief: look.relief }), sizeFactor());
}

let styledFactor = 1;
let restyleTimer: ReturnType<typeof setTimeout> | null = null;

/** Rebuilds the style when the size factor changed (after the panel was resized). */
function restyleSoon(): void {
  if (restyleTimer) clearTimeout(restyleTimer);
  restyleTimer = setTimeout(() => {
    restyleTimer = null;
    if (map && sizeFactor() !== styledFactor) setPreviewStyle(shown.source, shown.projection, shown.look);
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
    m.on("move", () => events.onView(toCompView(m)));
    m.on("load", () => events.onView(toCompView(m)));
    m.on("moveend", (e) => {
      // Dragging and scrolling carry the original input event; moves made by code do not.
      const data = e as unknown as { originalEvent?: unknown; lmlByUser?: boolean };
      events.onMoveEnd(toCompView(m), !!data.originalEvent || !!data.lmlByUser);
    });
    m.on("error", (e) => events.onError(String(e.error?.message ?? e)));
    m.on("click", (e) => events.onClick({ lat: e.lngLat.lat, lng: e.lngLat.lng }, e.originalEvent));
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
