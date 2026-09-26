// Off-screen frame renderer: one hidden MapLibre map sized to the comp. Each frame freezes MapLibre's
// clock, jumps to the exact camera, waits for every tile, then draws once per needed render (layer
// group set) and reads the pixels back, box-filtered on the GPU when supersampling.
//
// Render groups hide layers by overriding each style layer's isHidden() on the main thread. MapLibre's
// painter and style update skip hidden layers, while the worker-built tile buckets stay untouched, so
// switching groups between draws costs no tile reloads.

import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../../core/camera/camera.ts";
import { flipAndUnpremultiply } from "../../core/image/png.ts";
import { groupVisibleIn, skyVisibleIn, type LayerGroup, type RenderId } from "../../core/render/passes.ts";
import { ensureMaplibreWorker } from "../basemap/maplibreSetup.ts";
import { BORDERS_DRAW_LAYER, LAYER_COLOR_KEY, bordersGradient } from "../basemap/basemapStyle.ts";
import type { AnimatedView } from "../../core/render/plan.ts";
import { GpuReader } from "./gpuReader.ts";
import { SERIES_METADATA_KEY, seriesMatchAt, type SeriesPaint } from "../../core/style/dataFill.ts";

export type FrameRendererOptions = {
  /** Container size in CSS pixels: the comp size, which fixes the geographic extent. */
  width: number;
  height: number;
  /** Canvas resolution relative to the container (output scale times supersampling). */
  pixelRatio?: number;
  /** Box-filter factor applied on the GPU before reading pixels back. */
  supersample?: number;
  style: StyleSpecification;
  /** Multisample antialiasing of the canvas; costs GPU memory on very large canvases. */
  antialias?: boolean;
  /** Vertical field of view in degrees. MapLibre's default is about 36.87. */
  fovDegrees?: number;
  /**
   * 3D terrain: the height (exaggeration) and ground level (metres) the map's sliders hold when they
   * are not keyed. Keyed values arrive per frame in the view's animation ("terrainHeight",
   * "groundLevel"). The centre stays at ground × height, the level the camera maths counts from.
   */
  terrain?: { ground: number; height: number };
};

export type RenderedFrame = {
  /** Straight RGBA, top row first. */
  rgba: Uint8Array;
  width: number;
  height: number;
  timings: { waitMs: number; drawMs: number; readMs: number };
};

type HideableLayer = { isHidden: (zoom?: number, roundMinZoom?: boolean) => boolean };

export const GROUP_METADATA_KEY = "lml:group";

/** The code of the highlight a style layer belongs to, or null. */
export function layerHighlight(layer: { metadata?: unknown }): string | null {
  const code = (layer.metadata as Record<string, unknown> | undefined)?.["lml:highlight"];
  return typeof code === "string" ? code : null;
}

export function layerGroup(layer: { metadata?: unknown }): LayerGroup {
  const metadata = layer.metadata as Record<string, unknown> | undefined;
  const group = metadata?.[GROUP_METADATA_KEY];
  return typeof group === "string" ? (group as LayerGroup) : "overlay";
}

/** Rendering copy of a style: no transitions, so paint changes apply on the frame they are made. */
function renderStyle(style: StyleSpecification): StyleSpecification {
  return { ...style, transition: { duration: 0, delay: 0 } };
}

export class FrameRenderer {
  readonly options: FrameRendererOptions;
  private map: maplibregl.Map | null = null;
  private container: HTMLDivElement | null = null;
  private reader: GpuReader | null = null;
  private groups = new Map<string, LayerGroup>();
  private highlightOf = new Map<string, string | null>();
  private hidden = new Set<string>();
  private visibleRender: string | null = null;
  /** True while a render must not show the sky or the globe's atmosphere (every render but the base and the water fill). */
  private skyHidden = false;
  /** Frames in which MapLibre moved the camera out of the mountains (its picture then differs from the maths of linked layers). */
  cameraLifted = 0;
  private animation: Record<string, number> = {};

  constructor(options: FrameRendererOptions) {
    this.options = options;
  }

  get canvasWidth(): number {
    return Math.floor(this.options.width * (this.options.pixelRatio ?? 1));
  }

  get canvasHeight(): number {
    return Math.floor(this.options.height * (this.options.pixelRatio ?? 1));
  }

  async init(): Promise<void> {
    ensureMaplibreWorker();
    let stage = document.getElementById("render-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "render-stage";
      document.body.appendChild(stage);
    }
    const container = document.createElement("div");
    container.style.width = `${this.options.width}px`;
    container.style.height = `${this.options.height}px`;
    stage.appendChild(container);
    this.container = container;

    const style = renderStyle(this.options.style);
    const map = new maplibregl.Map({
      container,
      style,
      interactive: false,
      attributionControl: false,
      pixelRatio: this.options.pixelRatio ?? 1,
      maxCanvasSize: [16384, 16384],
      // No fades: a frame depends only on its camera, never on the frames drawn before it.
      fadeDuration: 0,
      canvasContextAttributes: { antialias: this.options.antialias ?? true, preserveDrawingBuffer: true },
      maxPitch: 85,
      renderWorldCopies: true,
      centerClampedToGround: false
    });
    this.map = map;
    if (this.options.fovDegrees !== undefined) map.setVerticalFieldOfView(this.options.fovDegrees);
    await new Promise<void>((resolve, reject) => {
      map.once("load", () => resolve());
      map.once("error", (e) => reject(e.error ?? new Error("map failed to load")));
    });
    if (map.getCanvas().width !== this.canvasWidth || map.getCanvas().height !== this.canvasHeight) {
      throw new Error(`canvas is ${map.getCanvas().width}x${map.getCanvas().height}, expected ${this.canvasWidth}x${this.canvasHeight} (GPU size limit?)`);
    }
    for (const layer of style.layers) {
      this.groups.set(layer.id, layerGroup(layer));
      this.highlightOf.set(layer.id, layerHighlight(layer));
    }
    this.installGroupHiding();
    this.installSkyHiding();
    this.reader = new GpuReader(this.gl());
  }

  get maplibre(): maplibregl.Map {
    if (!this.map) throw new Error("renderer not initialised");
    return this.map;
  }

  hasGroup(group: LayerGroup): boolean {
    return [...this.groups.values()].includes(group);
  }

  private gl(): WebGL2RenderingContext {
    const gl = this.maplibre.getCanvas().getContext("webgl2");
    if (!gl) throw new Error("WebGL2 is not available");
    return gl;
  }

  private installGroupHiding(): void {
    const map = this.maplibre;
    for (const id of this.groups.keys()) {
      const layer = map.getLayer(id) as unknown as HideableLayer | undefined;
      if (!layer) continue;
      const original = layer.isHidden.bind(layer);
      const hidden = this.hidden;
      layer.isHidden = (zoom?: number, roundMinZoom?: boolean) => hidden.has(id) || original(zoom, roundMinZoom);
    }
  }

  /**
   * The sky and the globe's atmosphere are not style layers, so MapLibre would draw them into every
   * render: a roads or highlight pass would carry its own copy of the sky. They belong to the picture's
   * background, so only the base render and the water fill (which holds the background) show them.
   * Like group hiding, this reaches into MapLibre's painter (maplibre-gl is pinned; R1 covers it).
   */
  private installSkyHiding(): void {
    type Draw = (...args: unknown[]) => void;
    const painter = (this.maplibre as unknown as { painter?: { drawFunctions?: Record<string, Draw> } }).painter;
    const shared = painter?.drawFunctions;
    if (!painter || !shared || typeof shared.sky !== "function" || typeof shared.atmosphere !== "function") throw new Error("this MapLibre build draws the sky in a way the renderer does not know");
    // A copy for this map alone: the preview map keeps the functions all maps share.
    painter.drawFunctions = {
      ...shared,
      sky: (...args: unknown[]) => {
        if (!this.skyHidden) shared.sky(...args);
      },
      atmosphere: (...args: unknown[]) => {
        if (!this.skyHidden) shared.atmosphere(...args);
      }
    };
  }

  /** Shows only the layers that belong to a render. */
  private showRender(render: RenderId, labels: boolean): void {
    const signature = `${render}:${labels}`;
    if (this.visibleRender === signature) return;
    this.hidden.clear();
    for (const [id, group] of this.groups) if (!groupVisibleIn(render, group, { labels, highlight: this.highlightOf.get(id) })) this.hidden.add(id);
    this.skyHidden = !skyVisibleIn(render);
    this.visibleRender = signature;
  }

  /** Moves the camera and waits until every tile it needs is loaded. `timeMs` freezes MapLibre's clock. */
  async setView(view: AnimatedView, timeMs: number): Promise<number> {
    const map = this.maplibre;
    const started = performance.now();
    maplibregl.setNow(timeMs);
    this.applyAnimation(view.animation);
    const height = view.animation?.terrainHeight ?? this.options.terrain?.height ?? 0;
    const ground = view.animation?.groundLevel ?? this.options.terrain?.ground ?? 0;
    const terrain = (map as unknown as { terrain?: { exaggeration: number } | null }).terrain;
    if (terrain && terrain.exaggeration !== height) terrain.exaggeration = height;
    // With 3D terrain MapLibre would lift the centre onto the ground; the elevation given here keeps it where the camera maths expects it.
    map.jumpTo({ center: [view.center.lng, view.center.lat], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch, elevation: ground * height });
    if (terrain && (Math.abs(map.getZoom() - view.zoom) > 1e-6 || Math.abs(map.getPitch() - view.pitch) > 1e-6)) this.cameraLifted++;
    // Tiles are chosen with every layer visible, so each render of this camera uses the same tiles.
    this.hidden.clear();
    this.skyHidden = false;
    this.visibleRender = null;
    await this.waitForTiles();
    return performance.now() - started;
  }

  /** Sets animated style values (paint changes only, so no tiles reload). */
  private applyAnimation(animation: Record<string, number> | undefined): void {
    const bordersDraw = animation?.bordersDraw;
    if (bordersDraw !== undefined && bordersDraw !== this.animation.bordersDraw && this.groups.has(BORDERS_DRAW_LAYER) && this.maplibre.getLayer(BORDERS_DRAW_LAYER)?.type === "line") {
      const metadata = this.maplibre.getLayer(BORDERS_DRAW_LAYER)?.metadata as Record<string, unknown> | undefined;
      const color = typeof metadata?.[LAYER_COLOR_KEY] === "string" ? (metadata[LAYER_COLOR_KEY] as string) : "#9fb3c6";
      this.maplibre.setPaintProperty(BORDERS_DRAW_LAYER, "line-gradient", bordersGradient(bordersDraw, color) as never);
      this.animation.bordersDraw = bordersDraw;
    }
    // Numbers over time: the colours of the moment the Data Time slider stands at.
    const dataTime = animation?.dataTime;
    if (dataTime !== undefined && dataTime !== this.animation.dataTime) {
      const layer = this.maplibre.getLayer("data-fill");
      const series = (layer?.metadata as Record<string, unknown> | undefined)?.[SERIES_METADATA_KEY] as SeriesPaint | undefined;
      if (layer && series) this.maplibre.setPaintProperty("data-fill", "fill-color", seriesMatchAt(series, dataTime) as never);
      this.animation.dataTime = dataTime;
    }
  }

  /** Draws one render at the current camera: premultiplied RGBA8 at output size, rows bottom-up. */
  draw(render: RenderId, labels = false): { pixels: Uint8Array; width: number; height: number } {
    this.showRender(render, labels);
    this.maplibre.redraw();
    return this.reader!.read(this.options.supersample ?? 1);
  }

  /** Renders one full frame (every layer) as straight RGBA, top row first. */
  async renderFrame(view: View, timeMs: number): Promise<RenderedFrame> {
    const t0 = performance.now();
    await this.setView(view, timeMs);
    const t1 = performance.now();
    this.hidden.clear();
    this.skyHidden = false;
    this.visibleRender = "all";
    this.maplibre.redraw();
    const t2 = performance.now();
    const read = this.reader!.read(this.options.supersample ?? 1);
    const rgba = flipAndUnpremultiply(read.pixels, read.width, read.height);
    const t3 = performance.now();
    return { rgba, width: read.width, height: read.height, timings: { waitMs: t1 - t0, drawMs: t2 - t1, readMs: t3 - t2 } };
  }

  private waitForTiles(timeoutMs = 120000): Promise<void> {
    const map = this.maplibre;
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        map.redraw();
        if (map.isStyleLoaded() && map.areTilesLoaded()) {
          resolve();
          return;
        }
        if (performance.now() - started > timeoutMs) {
          reject(new Error("timed out waiting for tiles"));
          return;
        }
        setTimeout(check, 4);
      };
      check();
    });
  }

  destroy(): void {
    maplibregl.restoreNow();
    try {
      this.reader?.destroy();
    } catch {
      // The context may already be gone.
    }
    this.reader = null;
    this.map?.remove();
    this.map = null;
    this.container?.remove();
    this.container = null;
  }
}
