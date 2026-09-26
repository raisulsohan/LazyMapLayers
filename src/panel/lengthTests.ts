// LN1: a scene made longer after its map was made.
//
// A 2-second map in a scene stretched to 4 seconds renders all 4 seconds: the map comp grows to the
// scene's end and its layer with it. A second map whose layer the user trimmed to 1 second grows
// its comp too but keeps the trim. Nothing grows when nothing needs to.

import { PREVIEW_SETTINGS } from "../core/render/plan.ts";
import { callHost, evalScript, fs } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";

type Lengths = { scene: number; mapComp: number; outPoint: number };

async function lengthsOf(mapId: string): Promise<Lengths> {
  return JSON.parse(
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(mapId)});
      return LML.json.stringify({ scene: layer.containingComp.duration, mapComp: layer.source.duration, outPoint: layer.outPoint });
    })()`)
  ) as Lengths;
}

export async function runLengthTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const out: Record<string, unknown> = {};
  const roots: string[] = [];
  try {
    const view = { center: { lat: 23.8, lng: 90.4 }, zoom: 5, bearing: 0, pitch: 0 };
    const map = await createMapComp({ name: "LN1 length", width: 640, height: 360, duration: 2, frameRate: 25, view, newScene: true });
    await callHost("setControlKeys", { mapId: map.id, name: "Zoom", times: [0, 2], values: [5, 6] });
    // The designer makes the scene longer in After Effects.
    await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.duration = 4; return "1"; })()`);
    const first = await runRenderJob({ mapId: map.id, quality: "preview", settings: PREVIEW_SETTINGS, basemap: { kind: "world" } });
    roots.push(first.storeRoot);
    const grown = await lengthsOf(map.id);
    out.grown = { ...grown, frames: first.frames, grewFrom: first.grewFrom };
    check(Math.abs(grown.mapComp - 4) < 1e-6 && Math.abs(grown.outPoint - 4) < 1e-6, `after the render the map is ${grown.mapComp} s and its layer ends at ${grown.outPoint} s, in a 4 s scene`);
    check(first.frames === 100, `${first.frames} frames were rendered for 4 seconds`);
    check(first.grewFrom !== undefined && Math.abs(first.grewFrom - 2) < 1e-6, `the render does not say the map grew from 2 s (${first.grewFrom})`);
    // Rendered again: nothing to grow.
    const again = await runRenderJob({ mapId: map.id, quality: "preview", settings: PREVIEW_SETTINGS, basemap: { kind: "world" } });
    roots.push(again.storeRoot);
    check(again.grewFrom === undefined, "the map grew again when it was already long enough");

    // A layer the user trimmed keeps its trim.
    const trimmed = await createMapComp({ name: "LN1 trimmed", width: 640, height: 360, duration: 2, frameRate: 25, view, newScene: true });
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(trimmed.id)});
      layer.outPoint = 1;
      layer.containingComp.duration = 4;
      return "1";
    })()`);
    const fitted = await callHost<{ grown: boolean }>("fitMapToScene", { mapId: trimmed.id });
    const kept = await lengthsOf(trimmed.id);
    out.trimmed = kept;
    check(fitted.grown && Math.abs(kept.mapComp - 4) < 1e-6, `the trimmed map comp is ${kept.mapComp} s`);
    check(Math.abs(kept.outPoint - 1) < 1e-6, `the user's trim to 1 s became ${kept.outPoint} s`);
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
  log(`LN1 map length: ${JSON.stringify(out)}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, ...out };
}
