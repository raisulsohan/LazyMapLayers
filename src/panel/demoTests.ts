// D1: builds the Milestone A world flight demo in After Effects, renders it and saves After Effects
// frames at key moments for review (spikes/D1-frames).
// D1L: the same in a project that uses the Legacy ExtendScript expression engine (as projects made from
// many templates do). It also checks every expression in the scene for errors and compares its frames
// with the last D1 frames.

import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS } from "../core/render/plan.ts";
import { evalScript, fs, path } from "./cep.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { buildWorldFlight, TOKYO } from "./demo/worldFlight.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

export async function runDemoTest(log: SpikeLog, options: { width: number; height: number; engine?: "extendscript" } = { width: 1920, height: 1080 }): Promise<Record<string, unknown>> {
  let originalEngine: string | null = null;
  if (options.engine) {
    originalEngine = JSON.parse(await evalScript("LML.json.stringify(app.project.expressionEngine)")) as string;
    await evalScript(`app.project.expressionEngine = ${JSON.stringify(options.engine)}; "1"`);
  }
  const regions = ["paris-wide", "paris", "tokyo-wide", "tokyo"].filter((name) => fs().existsSync(regionArchivePath(name)));
  const hasTokyo = regions.includes("tokyo");
  const started = performance.now();
  const steps: string[] = [];
  const demo = await buildWorldFlight(
    { width: options.width, height: options.height, basemap: regions.length ? { kind: "regions", names: regions } : { kind: "world" }, second: TOKYO, secondZoom: hasTokyo ? undefined : 5.2 },
    (line) => {
      log(`D1 ${line}`, "muted");
      steps.push(line);
    }
  );
  const buildSeconds = (performance.now() - started) / 1000;
  log(`D1 demo built in ${buildSeconds.toFixed(1)} s: ${demo.labels.labels} labels, ${demo.expressionErrors.length} expression errors`, demo.expressionErrors.length ? "fail" : "ok");
  if (demo.expressionErrors.length) log(demo.expressionErrors.slice(0, 6).join(" | "), "fail");

  const render = await runRenderJob({ mapId: demo.mapId, quality: "final", settings: DEFAULT_FINAL_SETTINGS, basemap: regions.length ? { kind: "regions", names: regions } : { kind: "world" } });
  log(`D1 rendered ${render.rendered} of ${render.frames} frames at ${render.msPerRenderedFrame.toFixed(0)} ms each (${(render.totalMs / 1000).toFixed(0)} s)`, "ok");

  const out = path().join(spikeDir(), `D1-frames-${options.height}${options.engine ? "-legacy" : ""}`);
  fs().rmSync(out, { recursive: true, force: true });
  fs().mkdirSync(out, { recursive: true });
  const times = [0.5, 3, 6.5, 9, 11, 13, 15, 17.5, 19.5, 22.5, 25, 28, 31, 34, 35.5];
  const saved: string[] = [];
  const sizes: Record<string, number[]> = {};
  for (const pass of ["first", "after-purge"]) {
    if (pass === "after-purge") await evalScript("app.purge(PurgeTarget.IMAGE_CACHES); '1'");
  for (const time of times) {
    const file = path().join(out, `${pass === "first" ? "" : "purged-"}t${time.toFixed(1).padStart(4, "0")}.png`).split(String.fromCharCode(92)).join("/");
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(demo.mapId)});
      var scene = layer.containingComp;
      scene.saveFrameToPng(${time}, new File(${JSON.stringify(file)}));
      return "1";
    })()`);
    // After Effects writes the PNG in the background; wait until the file stops growing.
    let lastSize = -1;
    for (let wait = 0; wait < 300; wait++) {
      await new Promise((r) => setTimeout(r, 200));
      const size = fs().existsSync(file) ? fs().statSync(file).size : -1;
      if (size > 0 && size === lastSize) break;
      lastSize = size;
    }
    if (fs().existsSync(file)) {
      const image = decodePng(new Uint8Array(fs().readFileSync(file)));
      saved.push(`${time}s ${image.width}x${image.height}`);
      (sizes[time] ??= []).push(fs().statSync(file).size);
    }
  }
  }
  let engineCheck: Record<string, unknown> | null = null;
  if (options.engine) {
    engineCheck = JSON.parse(
      await evalScript(`(function () {
        var scene = LML.pins.findMapLayer(${JSON.stringify(demo.mapId)}).containingComp;
        var count = 0, broken = [];
        function walk(group, layer) {
          for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            if (p.propertyType !== PropertyType.PROPERTY) { walk(p, layer); continue; }
            if (!p.canSetExpression || p.expression === "") continue;
            count++;
            p.valueAtTime(20, false);
            if (p.expressionError || !p.expressionEnabled) broken.push(layer.name + ": " + p.expressionError);
          }
        }
        for (var l = 1; l <= scene.numLayers; l++) walk(scene.layer(l), scene.layer(l));
        return LML.json.stringify({ engine: app.project.expressionEngine, expressions: count, broken: broken.length, examples: broken.slice(0, 5) });
      })()`)
    ) as Record<string, unknown>;
    const reference = path().join(spikeDir(), `D1-frames-${options.height}`);
    const differences: Record<string, number> = {};
    for (const time of times) {
      const name = `t${time.toFixed(1).padStart(4, "0")}.png`;
      const a = path().join(reference, name);
      const b = path().join(out, name);
      if (!fs().existsSync(a) || !fs().existsSync(b)) continue;
      const imageA = decodePng(new Uint8Array(fs().readFileSync(a))).rgba;
      const imageB = decodePng(new Uint8Array(fs().readFileSync(b))).rgba;
      if (imageA.length !== imageB.length) continue;
      let sum = 0;
      for (let i = 0; i < imageA.length; i++) sum += Math.abs(imageA[i] - imageB[i]);
      differences[time] = Math.round((sum / imageA.length) * 1000) / 1000;
    }
    engineCheck.frameDifferences = differences;
    await evalScript(`app.project.expressionEngine = ${JSON.stringify(originalEngine)}; "1"`);
    log(`D1L legacy engine: ${engineCheck.expressions} expressions, ${engineCheck.broken} with errors; frame differences to D1 ${JSON.stringify(differences)}`, engineCheck.broken === 0 ? "ok" : "fail");
  }
  return {
    engineCheck,
    buildSeconds,
    steps,
    labels: demo.labels,
    expressionErrors: demo.expressionErrors,
    frames: render.frames,
    rendered: render.rendered,
    msPerRenderedFrame: Math.round(render.msPerRenderedFrame),
    renderSeconds: Math.round(render.totalMs / 1000),
    saved,
    sizes,
    regions
  };
}
