// DT3: a prism map, drawn by the renderer.
//
// The same numbers rendered flat and raised, over a tilted view of South Asia: raised, the data pass
// covers more of the frame (the prisms' sides), India - the largest number - stands above the ground
// where the flat map has nothing, and a small number keeps a sliver. On the globe the prisms render
// too. Frames are saved to look at.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { DEFAULT_DATA_FILL, normaliseDataFill } from "../core/style/dataFill.ts";
import { encodePng } from "../core/image/png.ts";
import { fs, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob, type RenderJobResult } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 960, height: 540 };

function dataPass(result: RenderJobResult): Uint8Array | null {
  const sequence = result.sequences.find((s) => s.pass === "highlight-DATA");
  if (!sequence) return null;
  return decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;
}

const covered = (rgba: Uint8Array) => {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 20) n++;
  return n;
};

export async function runPrismTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
  const values = { IND: 1400, BGD: 170, NPL: 30, PAK: 240, LKA: 22, BTN: 0.8 };
  const flat = normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "People", values, opacity: 1 })!;
  const raised = normaliseDataFill({ ...flat, extrude: { maxKm: 1500 } })!;
  const view: View = { center: { lat: 21, lng: 80 }, zoom: 3.6, bearing: 0, pitch: 55 };
  const roots: string[] = [];
  const counts: Record<string, number> = {};
  try {
    const map = await createMapComp({ name: "DT3 prisms", width: SIZE.width, height: SIZE.height, duration: 0.04, frameRate: 25, view, newScene: true });
    const flatRender = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: flat });
    roots.push(flatRender.storeRoot);
    const flatPixels = dataPass(flatRender);
    const raisedRender = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: raised });
    roots.push(raisedRender.storeRoot);
    const raisedPixels = dataPass(raisedRender);
    check(!!flatPixels && !!raisedPixels, "a data pass was not rendered");
    if (flatPixels && raisedPixels) {
      counts.flat = covered(flatPixels);
      counts.raised = covered(raisedPixels);
      check(counts.raised > counts.flat * 1.05, `raised, the data covers ${counts.raised} pixels against ${counts.flat} flat`);
      // Straight above central India, higher up the frame than the ground: only a prism is there.
      const india = project(view, SIZE, { lat: 22, lng: 79 });
      const above = (Math.round(india.y - 120) * SIZE.width + Math.round(india.x)) * 4;
      check(raisedPixels[above + 3] > 200 && flatPixels[above + 3] < 20, `above India: ${raisedPixels[above + 3]} raised, ${flatPixels[above + 3]} flat`);
      const dir = path().join(spikeDir(), "DT3-frames");
      fs().mkdirSync(dir, { recursive: true });
      fs().writeFileSync(path().join(dir, "raised.png"), encodePng(raisedPixels, SIZE.width, SIZE.height));
    }
    // On the globe.
    const globe = await createMapComp({ name: "DT3 prisms globe", width: SIZE.width, height: SIZE.height, duration: 0.04, frameRate: 25, view: { center: { lat: 20, lng: 80 }, zoom: 1.8, bearing: 0, pitch: 40 }, newScene: true, projection: "globe" });
    const globeRender = await runRenderJob({ mapId: globe.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: raised });
    roots.push(globeRender.storeRoot);
    const globePixels = dataPass(globeRender);
    counts.globe = globePixels ? covered(globePixels) : 0;
    check(counts.globe > 500, `the prisms on the globe cover ${counts.globe} pixels`);
    if (globePixels) fs().writeFileSync(path().join(spikeDir(), "DT3-frames", "globe.png"), encodePng(globePixels, SIZE.width, SIZE.height));
  } catch (error) {
    problems.push(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const root of roots) {
    try {
      fs().rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Left for the next run.
    }
  }
  const passed = problems.length === 0;
  log(`DT3 prism map: ${JSON.stringify(counts)}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, counts };
}
