// "Render map": samples the map layer's camera for every frame, renders the basemap with MapLibre,
// writes a PNG sequence and imports (or swaps) it into the map comp.

import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../../core/camera/camera.ts";
import { encodePng } from "../../core/image/png.ts";
import { callHost, fs, os, path } from "../cep.ts";
import { naturalEarthArchivePath, regionArchivePath, registerLocalArchive } from "../basemap/maplibreSetup.ts";
import { naturalEarthStyle } from "../basemap/naturalEarthStyle.ts";
import { protomapsStyle } from "../basemap/protomapsStyle.ts";
import { FrameRenderer } from "./frameRenderer.ts";

export type BasemapSource = { kind: "world" } | { kind: "region"; name: string };

export type RenderMapOptions = {
  basemap: BasemapSource;
  /** Output size relative to the map comp: 1 for final frames, 0.5 for quick proxies. */
  scale?: number;
  labels?: boolean;
  /** Debug/test markers drawn into the basemap as solid circles (radius in comp pixels). */
  markers?: { lat: number; lng: number; radius?: number; color?: string }[];
  onProgress?: (done: number, total: number) => void;
};

type Sampled = {
  mapCompName: string;
  width: number;
  height: number;
  frameRate: number;
  frames: number;
  firstFrame: number;
  views: View[];
  projectFolder: string | null;
};

export type RenderMapResult = { frames: number; folder: string; msPerFrame: number; imported: { layerIndex: number; width: number; height: number } };

function styleFor(options: RenderMapOptions): StyleSpecification {
  const style =
    options.basemap.kind === "region"
      ? protomapsStyle(registerLocalArchive(options.basemap.name, regionArchivePath(options.basemap.name)), { labels: options.labels ?? false })
      : naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()), { labels: options.labels ?? false });
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

function outputFolder(sampled: Sampled, mapId: string): string {
  const safe = sampled.mapCompName.replace(/[^A-Za-z0-9 _-]+/g, "_").trim() || "Map";
  const base = sampled.projectFolder
    ? path().join(sampled.projectFolder, "LazyMapLayers Renders")
    : path().join(process.env.APPDATA ?? os().homedir(), "LazyMapLayers", "renders");
  // A new folder per render: After Effects caches footage by path, so reusing names can show old frames.
  return path().join(base, `${safe} ${mapId}`, `base ${Date.now()}`);
}

export async function renderMap(mapId: string, options: RenderMapOptions): Promise<RenderMapResult> {
  const sampled = await callHost<Sampled>("sampleViews", { mapId });
  const scale = options.scale ?? 1;
  const folder = outputFolder(sampled, mapId);
  fs().mkdirSync(folder, { recursive: true });

  // The container keeps comp size so the geographic extent is unchanged; pixelRatio sets resolution.
  const renderer = new FrameRenderer({ width: sampled.width, height: sampled.height, pixelRatio: scale, style: styleFor(options) });
  const started = performance.now();
  try {
    await renderer.init();
    for (let i = 0; i < sampled.views.length; i++) {
      const frameNumber = sampled.firstFrame + i;
      const frame = await renderer.renderFrame(sampled.views[i], (frameNumber * 1000) / sampled.frameRate);
      const png = encodePng(frame.rgba, frame.width, frame.height, { level: 1, opaque: true });
      fs().writeFileSync(path().join(folder, `frame_${String(frameNumber).padStart(5, "0")}.png`), png);
      options.onProgress?.(i + 1, sampled.views.length);
    }
  } finally {
    renderer.destroy();
  }
  const msPerFrame = (performance.now() - started) / sampled.views.length;
  const firstFramePath = path().join(folder, `frame_${String(sampled.firstFrame).padStart(5, "0")}.png`);
  const imported = await callHost<{ layerIndex: number; width: number; height: number }>("importBasemap", { mapId, firstFramePath });
  return { frames: sampled.views.length, folder, msPerFrame, imported };
}
