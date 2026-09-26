// LB6: the oceans are named on a turning globe.
//
// A globe turns from the South Atlantic past the Indian Ocean to the Pacific, labelled with the natural world. An ocean's wide name fits
// on the planet only after the smaller names around it have come on; the oceans must still be named
// (they go first and the others make way), with no two names over each other on any frame checked.
// A frame is saved to look at.

import { natureClassOf } from "../core/labels/nature.ts";
import { PREVIEW_SETTINGS } from "../core/render/plan.ts";
import { callHost, evalScript, fs, path } from "./cep.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

type Shown = { labelId: string; text: string; boxes: (number[] | null)[] };

export async function runOceanNameTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const out: Record<string, unknown> = {};
  const roots: string[] = [];
  try {
    const map = await createMapComp({ name: "LB6 oceans", width: 1920, height: 1080, duration: 12, frameRate: 25, view: { center: { lat: -15, lng: -40 }, zoom: 2.2, bearing: 0, pitch: 0 }, newScene: true, projection: "globe" });
    await callHost("setControlKeys", { mapId: map.id, name: "Longitude", times: [0, 12], values: [-40, 260] });
    const made = await autoLabels(map.id, { theme: "paper", maxLabels: 80, language: { kind: "fixed", language: "en" }, english: false });
    out.labels = made.labels;
    // Every name's box on screen at a frame every half second: where its layer stands and how big it is.
    const times = Array.from({ length: 24 }, (_, i) => i * 0.5);
    const shown = JSON.parse(
      await evalScript(`(function () {
        var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, out = [], times = ${JSON.stringify(times)};
        for (var i = 1; i <= scene.numLayers; i++) {
          var layer = scene.layer(i), tag = LML.tag.read(layer);
          if (!tag || tag.kind !== "label" || tag.part !== "text") continue;
          var text = layer.property("ADBE Text Properties").property("ADBE Text Document").value.text;
          var boxes = [];
          for (var t = 0; t < times.length; t++) {
            var o = layer.property("ADBE Transform Group").property("ADBE Opacity").valueAtTime(times[t], false);
            if (o < 1) { boxes.push(null); continue; }
            var r = layer.sourceRectAtTime(times[t], false), p = layer.property("ADBE Transform Group").property("ADBE Position").valueAtTime(times[t], false);
            var a = layer.property("ADBE Transform Group").property("ADBE Anchor Point").valueAtTime(times[t], false);
            boxes.push([p[0] - a[0] + r.left, p[1] - a[1] + r.top, r.width, r.height]);
          }
          out.push({ labelId: tag.labelId, text: text, boxes: boxes });
        }
        return LML.json.stringify(out);
      })()`)
    ) as Shown[];
    const oceans = shown.filter((l) => natureClassOf(l.labelId) === "ocean" && l.boxes.some(Boolean));
    out.oceans = oceans.map((l) => `${l.text} (${l.boxes.filter(Boolean).length} of ${times.length})`);
    for (const name of ["Atlantic", "Indian", "Pacific"]) check(oceans.some((l) => l.text.toLowerCase().includes(name.toLowerCase())), `the ${name} Ocean is never named as the globe turns (${out.oceans})`);
    let overlaps = 0;
    for (let t = 0; t < times.length; t++) {
      const on = shown.map((l) => l.boxes[t]).filter((b): b is number[] => !!b);
      for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
        const [a, b] = [on[i], on[j]];
        // The text's own rectangle, a little inside the placer's box (which adds padding and halo); fades
        // happen inside a name's time on screen, so no two names overlap even while fading.
        if (a[0] + 2 < b[0] + b[2] && b[0] + 2 < a[0] + a[2] && a[1] + 2 < b[1] + b[3] && b[1] + 2 < a[1] + a[3]) overlaps++;
      }
    }
    out.overlaps = overlaps;
    check(overlaps === 0, `${overlaps} pairs of names overlap`);
    const render = await runRenderJob({ mapId: map.id, quality: "preview", settings: PREVIEW_SETTINGS, basemap: { kind: "world" }, theme: "paper" });
    roots.push(render.storeRoot);
    const file = path().join(spikeDir(), "LB6-frame.png").split(String.fromCharCode(92)).join("/");
    fs().rmSync(file, { force: true });
    await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.saveFrameToPng(7, new File(${JSON.stringify(file)})); return "1"; })()`);
    for (let i = 0; i < 60 && !fs().existsSync(file); i++) await new Promise((resolve) => setTimeout(resolve, 250));
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
  log(`LB6 oceans on a turning globe: ${JSON.stringify(out)}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, ...out };
}
