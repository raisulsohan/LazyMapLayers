// Off-screen frame renderer: one hidden MapLibre map sized to the output frame. Each frame freezes
// MapLibre's clock at the frame time, jumps to the exact camera, waits for tiles, draws
// synchronously and reads the pixels back.

import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../../core/camera/camera.ts";
import { flipAndUnpremultiply } from "../../core/image/png.ts";
import { ensureMaplibreWorker } from "../basemap/maplibreSetup.ts";

export type FrameRendererOptions = {
  width: number;
  height: number;
  /** Supersampling factor; the canvas is width*pixelRatio by height*pixelRatio. */
  pixelRatio?: number;
  style: StyleSpecification;
  /** Vertical field of view in degrees. MapLibre's default is about 36.87. */
  fovDegrees?: number;
};

export type RenderedFrame = {
  /** Straight RGBA, top row first, at canvas size. */
  rgba: Uint8Array;
  width: number;
  height: number;
  timings: { waitMs: number; drawMs: number; readMs: number };
};

export class FrameRenderer {
  readonly options: FrameRendererOptions;
  private map: maplibregl.Map | null = null;
  private container: HTMLDivElement | null = null;

  constructor(options: FrameRendererOptions) {
    this.options = options;
  }

  get canvasWidth(): number {
    return Math.round(this.options.width * (this.options.pixelRatio ?? 1));
  }

  get canvasHeight(): number {
    return Math.round(this.options.height * (this.options.pixelRatio ?? 1));
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

    const map = new maplibregl.Map({
      container,
      style: this.options.style,
      interactive: false,
      attributionControl: false,
      pixelRatio: this.options.pixelRatio ?? 1,
      maxCanvasSize: [16384, 16384],
      fadeDuration: 300,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
      maxPitch: 85,
      renderWorldCopies: true
    });
    this.map = map;
    if (this.options.fovDegrees !== undefined) map.setVerticalFieldOfView(this.options.fovDegrees);
    await new Promise<void>((resolve, reject) => {
      map.once("load", () => resolve());
      map.once("error", (e) => reject(e.error ?? new Error("map failed to load")));
    });
  }

  get maplibre(): maplibregl.Map {
    if (!this.map) throw new Error("renderer not initialised");
    return this.map;
  }

  /** Renders one frame. `timeMs` drives fades and transitions deterministically. */
  async renderFrame(view: View, timeMs: number): Promise<RenderedFrame> {
    const map = this.maplibre;
    const t0 = performance.now();
    maplibregl.setNow(timeMs);
    map.jumpTo({ center: [view.center.lng, view.center.lat], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
    await this.waitForTiles();
    const t1 = performance.now();
    map.redraw();
    const t2 = performance.now();
    const gl = map.getCanvas().getContext("webgl2") as WebGL2RenderingContext;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rgba = flipAndUnpremultiply(pixels, width, height);
    const t3 = performance.now();
    return { rgba, width, height, timings: { waitMs: t1 - t0, drawMs: t2 - t1, readMs: t3 - t2 } };
  }

  private waitForTiles(timeoutMs = 60000): Promise<void> {
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
    this.map?.remove();
    this.map = null;
    this.container?.remove();
    this.container = null;
  }
}
