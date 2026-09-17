// W1: renders a few views of the demo basemap (world plus wide and detailed regions) to check how
// regions hand over between zoom levels (spikes/W1-*.png).

import { encodePng, flipAndUnpremultiply } from "../core/image/png.ts";
import type { View } from "../core/camera/camera.ts";
import { fs, path } from "./cep.ts";
import { basemapStyle, type BasemapSource } from "./basemap/basemapStyle.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

export async function runDiagnostics(log: SpikeLog): Promise<Record<string, unknown>> {
  const names = ["paris-wide", "paris", "tokyo-wide", "tokyo"].filter((n) => fs().existsSync(regionArchivePath(n)));
  const basemap: BasemapSource = { kind: "regions", names };
  const views: [string, View][] = [
    ["paris-09.5", { center: { lat: 48.86, lng: 2.33 }, zoom: 9.5, bearing: 20, pitch: 0 }],
    ["paris-10.8", { center: { lat: 48.86, lng: 2.31 }, zoom: 10.8, bearing: 25, pitch: 0 }],
    ["paris-12.0", { center: { lat: 48.858, lng: 2.3 }, zoom: 12.0, bearing: 30, pitch: 20 }],
    ["tokyo-09.5", { center: { lat: 35.6, lng: 139.8 }, zoom: 9.5, bearing: -20, pitch: 0 }],
    ["tokyo-11.0", { center: { lat: 35.64, lng: 139.76 }, zoom: 11, bearing: -22, pitch: 0 }],
    ["tokyo-12.4", { center: { lat: 35.655, lng: 139.75 }, zoom: 12.4, bearing: -25, pitch: 25 }],
    ["tokyo-14.6", { center: { lat: 35.6605, lng: 139.7482 }, zoom: 14.6, bearing: -25, pitch: 55 }]
  ];
  const style = basemapStyle(basemap, { labels: false, projection: "globe", viewport: { width: 1280, height: 720 } });
  const renderer = new FrameRenderer({ width: 1280, height: 720, style, antialias: true });
  const files: string[] = [];
  try {
    await renderer.init();
    for (const [name, view] of views) {
      await renderer.setView(view, 0);
      const frame = renderer.draw("base");
      const file = path().join(spikeDir(), `W1-${name}.png`);
      fs().writeFileSync(file, encodePng(flipAndUnpremultiply(frame.pixels, frame.width, frame.height), frame.width, frame.height, { level: 1 }));
      files.push(file);
    }
    log(`W1 rendered ${files.length} views with ${names.join(", ")}`, "muted");
  } finally {
    renderer.destroy();
  }
  return { names, files };
}
