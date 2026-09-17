// W1: renders one view in separate groups to find where an artefact comes from (spikes/W1-*.png).

import { encodePng, flipAndUnpremultiply } from "../core/image/png.ts";
import type { View } from "../core/camera/camera.ts";
import { fs, path } from "./cep.ts";
import { basemapStyle, type BasemapSource } from "./basemap/basemapStyle.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

export async function runDiagnostics(log: SpikeLog): Promise<Record<string, unknown>> {
  const view: View = { center: { lat: 48.86, lng: 2.29 }, zoom: 11.3, bearing: 28, pitch: 0 };
  const out: string[] = [];
  const save = (name: string, frame: { pixels: Uint8Array; width: number; height: number }) => {
    const file = path().join(spikeDir(), `W1-${name}.png`);
    fs().writeFileSync(file, encodePng(flipAndUnpremultiply(frame.pixels, frame.width, frame.height), frame.width, frame.height, { level: 1 }));
    out.push(file);
  };
  for (const [name, basemap] of [
    ["combined", { kind: "regions", names: ["paris"] }],
    ["region-only", { kind: "region", name: "paris" }]
  ] as [string, BasemapSource][]) {
    const style = basemapStyle(basemap, { labels: false, projection: "mercator" });
    if (name === "region-only") style.layers = style.layers.filter((l) => !("source" in l) || l.source !== "natural-earth");
    const renderer = new FrameRenderer({ width: 1280, height: 720, style, antialias: true });
    try {
      await renderer.init();
      await renderer.setView(view, 0);
      save(`${name}-base`, renderer.draw("base"));
      save(`${name}-land`, renderer.draw("land"));
      save(`${name}-water`, renderer.draw("waterShapes"));
      log(`W1 ${name}: layers ${style.layers.map((l) => l.id).join(", ")}`, "muted");
    } finally {
      renderer.destroy();
    }
  }
  return { files: out };
}
