// Phase 2 renderer tests inside After Effects.
//
// R1 (1080p, 4 s): holds render once; an unchanged re-render draws nothing; a keyframe change redraws
//   only the frames whose camera changed; passes and mattes are consistent; no pops; preview becomes
//   a proxy and a final render switches it off; motion blur blurs moving frames only; a cancelled
//   render resumes from the cache; GPU box filtering equals the CPU reference; the comp stays light
//   and the data credit is added.
// R2 (4K, 10 s): the Phase 2 acceptance move: timing, pops, and a keyframe change redrawing only the
//   affected frames.

import type { View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { downsampleBox } from "../core/render/pixels.ts";
import { DEFAULT_FINAL_SETTINGS, PREVIEW_SETTINGS, normaliseSettings, sequenceFileName, type RenderSettings } from "../core/render/plan.ts";
import { PASS_IDS } from "../core/render/passes.ts";
import { findPops, meanAbsDifference } from "../core/render/temporal.ts";
import { evalScript, fs, path } from "./cep.ts";
import { naturalEarthArchivePath, regionArchivePath } from "./basemap/maplibreSetup.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { RenderCancelled, basemapStyle, runRenderJob, type BasemapSource, type RenderJobResult } from "./render/renderJob.ts";
import { createMapComp, setView } from "./mapApi.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

const at = (mapId: string, time: number) => host(`LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp.time = ${time}; return "1";`);

async function keyframe(mapId: string, time: number, view: View) {
  await at(mapId, time);
  await setView(mapId, view, true);
}

function readFrame(result: RenderJobResult, pass: string, frame: number) {
  const sequence = result.sequences.find((s) => s.pass === pass);
  if (!sequence) throw new Error(`no ${pass} sequence`);
  return decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(frame)))));
}

function sequencePops(result: RenderJobResult, pass = "base") {
  const differences: number[] = [];
  let previous = readFrame(result, pass, 0).rgba;
  for (let f = 1; f < result.frames; f++) {
    const current = readFrame(result, pass, f).rgba;
    differences.push(meanAbsDifference(previous, current, 2));
    previous = current;
  }
  return { pops: findPops(differences), maxDifference: Math.max(...differences), differences: differences.map((d) => Math.round(d * 100) / 100) };
}

type Check = { name: string; passed: boolean; detail: unknown };

/** Test renders are large; After Effects may still hold a file open, so failures are ignored. */
function removeRenders(root: string) {
  try {
    fs().rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Left for the next run to overwrite.
  }
}

export async function runRenderTests(log: SpikeLog, which: { r1: boolean; r2: boolean }): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const basemap: BasemapSource = fs().existsSync(regionArchivePath("paris")) ? { kind: "region", name: "paris" } : { kind: "world" };
  if (which.r1) out.R1 = await runR1(log, basemap);
  if (which.r2) out.R2 = await runR2(log, basemap);
  return out;
}

async function runR1(log: SpikeLog, basemap: BasemapSource): Promise<Record<string, unknown>> {
  const checks: Check[] = [];
  try {
    return await r1Body(log, basemap, checks);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    log(`R1 stopped: ${message}`, "fail");
    return { passed: false, checks, error: message };
  }
}

async function r1Body(log: SpikeLog, basemap: BasemapSource, checks: Check[]): Promise<Record<string, unknown>> {
  const check = (name: string, passed: boolean, detail: unknown = null) => {
    checks.push({ name, passed, detail });
    log(`R1 ${name}: ${passed ? "ok" : "FAILED"}${detail === null ? "" : ` ${JSON.stringify(detail)}`}`, passed ? "ok" : "fail");
  };
  const city = basemap.kind === "region";
  const a: View = city ? { center: { lng: 2.3222, lat: 48.8626 }, zoom: 13.1, bearing: 0, pitch: 30 } : { center: { lng: 5, lat: 45 }, zoom: 3.2, bearing: 0, pitch: 0 };
  const b: View = city ? { center: { lng: 2.2945, lat: 48.8584 }, zoom: 14.6, bearing: 35, pitch: 55 } : { center: { lng: 20, lat: 40 }, zoom: 4.6, bearing: 25, pitch: 40 };
  const map = await createMapComp({ name: "R1 renderer", width: 1920, height: 1080, duration: 4, frameRate: 25, view: a, newScene: true });
  await keyframe(map.id, 0, a);
  await keyframe(map.id, 1, a);
  await keyframe(map.id, 3.5, b);
  const allPasses: RenderSettings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, passes: [...PASS_IDS] });

  // 1. First final render with every pass.
  const first = await runRenderJob({ mapId: map.id, quality: "final", settings: allPasses, basemap });
  // Keep frame 60 of every pass for inspection (later renders prune these folders).
  const keep = path().join(spikeDir(), "R1-frames");
  fs().mkdirSync(keep, { recursive: true });
  for (const sequence of first.sequences) fs().copyFileSync(path().join(sequence.folder, sequenceFileName(60)), path().join(keep, `${sequence.pass}.png`));
  log(`R1 first render: ${first.rendered} of ${first.frames} frames drawn, ${first.msPerRenderedFrame.toFixed(0)} ms per frame (all ${first.passes.length} passes, 2x supersampling)`, "muted");
  // Frames 0-25 hold view A and 88-99 hold view B: 26 + 12 frames collapse into 2 renders.
  check("holds render once", first.rendered === first.frames - 25 - 11, { rendered: first.rendered, frames: first.frames });

  const comp = await host<{ layers: number; footage: number; passes: string[]; enabled: boolean[]; credit: string | null }>(`
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
    var mapComp = mapLayer.source, passes = [], enabled = [], footage = 0, credit = null;
    for (var i = 1; i <= mapComp.numLayers; i++) { var t = LML.tag.read(mapComp.layer(i)); passes.push(t ? t.pass : "?"); enabled.push(mapComp.layer(i).enabled); }
    for (var j = 1; j <= app.project.numItems; j++) { var ft = LML.tag.read(app.project.item(j)); if (ft && ft.kind === "basemapFootage" && ft.mapId === ${JSON.stringify(map.id)}) footage++; }
    var scene = mapLayer.containingComp;
    for (var k = 1; k <= scene.numLayers; k++) { var st = LML.tag.read(scene.layer(k)); if (st && st.kind === "attribution") credit = scene.layer(k).property("ADBE Text Properties").property("ADBE Text Document").value.text; }
    return LML.json.stringify({ layers: mapComp.numLayers, footage: footage, passes: passes, enabled: enabled, credit: credit });`);
  check("comp stays light: one layer and one footage item per pass", comp.layers === 8 && comp.footage === 8, comp);
  check("passes stack in order, only the basemap switched on", comp.passes.join(",") === "waterMatte,landMatte,buildings,roads,boundaries,water,land,base" && comp.enabled.filter(Boolean).length === 1, comp);
  check("data credit", city ? comp.credit === "© OpenStreetMap contributors" : comp.credit === null, comp.credit);

  // 2. Pass consistency on a moving frame.
  const f = 60;
  const land = readFrame(first, "landMatte", f).rgba;
  const water = readFrame(first, "waterMatte", f).rgba;
  let matteErrors = 0;
  let landPixels = 0;
  for (let i = 3; i < land.length; i += 4) {
    if (Math.abs(land[i] + water[i] - 255) > 1) matteErrors++;
    if (land[i] > 127) landPixels++;
  }
  check("land and water mattes cover every pixel once", matteErrors === 0 && landPixels > 0, { matteErrors, landShare: +(landPixels / (land.length / 4)).toFixed(3) });
  const coverage = (pass: string) => {
    const rgba = readFrame(first, pass, f).rgba;
    let n = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) n++;
    return +(n / (rgba.length / 4)).toFixed(4);
  };
  const shares = { roads: coverage("roads"), boundaries: coverage("boundaries"), buildings: coverage("buildings"), water: coverage("water"), land: coverage("land") };
  check("color passes carry content", city ? shares.roads > 0 && shares.buildings > 0 && shares.land > 0 && shares.water > 0 : shares.land > 0 && shares.water > 0, shares);
  // Base against the ground passes composited over each other, where no building holds them out
  // (held-out passes are meant to go over the basemap, so they do not rebuild it by plain "over").
  const composite = new Float32Array(1920 * 1080 * 3);
  const buildingsAlpha = readFrame(first, "buildings", f).rgba;
  for (const pass of ["land", "water", "boundaries", "roads"]) {
    const rgba = readFrame(first, pass, f).rgba;
    for (let p = 0; p < 1920 * 1080; p++) {
      const alpha = rgba[p * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) composite[p * 3 + c] = composite[p * 3 + c] * (1 - alpha) + rgba[p * 4 + c] * alpha;
    }
  }
  const base = readFrame(first, "base", f).rgba;
  let close = 0;
  let open = 0;
  for (let p = 0; p < 1920 * 1080; p++) {
    if (buildingsAlpha[p * 4 + 3] !== 0) continue;
    open++;
    const d = Math.abs(base[p * 4] - composite[p * 3]) + Math.abs(base[p * 4 + 1] - composite[p * 3 + 1]) + Math.abs(base[p * 4 + 2] - composite[p * 3 + 2]);
    if (d <= 9) close++;
  }
  const closeShare = close / Math.max(1, open);
  check("ground passes composite back to the basemap", closeShare > 0.98, { pixelsWithin3PerChannel: +closeShare.toFixed(4), comparedShare: +(open / (1920 * 1080)).toFixed(3) });

  // 3. Pops in the base sequence.
  const temporal = sequencePops(first);
  check("no pops in the base sequence", temporal.pops.length === 0, { pops: temporal.pops, maxDifference: temporal.maxDifference });

  // 4. Unchanged re-render draws nothing.
  const again = await runRenderJob({ mapId: map.id, quality: "final", settings: allPasses, basemap });
  check("unchanged re-render draws nothing", again.rendered === 0, { rendered: again.rendered, seconds: +(again.totalMs / 1000).toFixed(2) });

  // 5. A keyframe change at 3.5 s redraws only the frames after the hold ends at 1 s.
  await keyframe(map.id, 3.5, { ...b, bearing: b.bearing + 6 });
  const changed = await runRenderJob({ mapId: map.id, quality: "final", settings: allPasses, basemap });
  // Frames 26-87 move and 88-99 hold the new view B: 62 + 1 renders; frames 0-25 are untouched.
  check("keyframe change redraws only affected frames", changed.rendered === 63, { rendered: changed.rendered, reused: changed.reused });

  // 6. Preview becomes a proxy of the final render; a final render with the same move switches it off.
  const preview = await runRenderJob({ mapId: map.id, quality: "preview", settings: PREVIEW_SETTINGS, basemap });
  const afterPreview = await host<{ pass: string; hasProxy: boolean; useProxy: boolean; main: string }[]>(`return LML.json.stringify(LML.api.listPasses({ mapId: ${JSON.stringify(map.id)} }));`);
  const basePreview = afterPreview.find((p) => p.pass === "base")!;
  check("preview is a proxy of the final render", basePreview.hasProxy && basePreview.useProxy && basePreview.main === "final" && preview.geometry.width === 960, basePreview);
  const finalAgain = await runRenderJob({ mapId: map.id, quality: "final", settings: allPasses, basemap });
  const afterFinal = await host<{ pass: string; hasProxy: boolean; useProxy: boolean }[]>(`return LML.json.stringify(LML.api.listPasses({ mapId: ${JSON.stringify(map.id)} }));`);
  const baseFinal = afterFinal.find((p) => p.pass === "base")!;
  check("final render keeps a matching proxy but switches it off", finalAgain.rendered === 0 && baseFinal.hasProxy && !baseFinal.useProxy, baseFinal);

  // 7. Motion blur: moving frames blur, held frames stay identical and are reused.
  const blurSettings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, motionBlur: true, motionBlurSamples: 8 });
  const blurred = await runRenderJob({ mapId: map.id, quality: "final", settings: blurSettings, basemap });
  const sharp = await runRenderJob({ mapId: map.id, quality: "final", settings: { ...blurSettings, motionBlur: false }, basemap });
  fs().copyFileSync(path().join(blurred.sequences[0].folder, sequenceFileName(50)), path().join(keep, "base-motion-blur-50.png"));
  fs().copyFileSync(path().join(sharp.sequences[0].folder, sequenceFileName(50)), path().join(keep, "base-sharp-50.png"));
  const movingDiff = meanAbsDifference(readFrame(blurred, "base", 50).rgba, readFrame(sharp, "base", 50).rgba);
  const heldDiff = meanAbsDifference(readFrame(blurred, "base", 10).rgba, readFrame(sharp, "base", 10).rgba);
  check("motion blur changes moving frames only", movingDiff > 0.2 && heldDiff === 0 && blurred.rendered <= 63, {
    movingDiff: +movingDiff.toFixed(3),
    heldDiff,
    blurredRendered: blurred.rendered,
    msPerBlurredFrame: Math.round(blurred.msPerRenderedFrame)
  });

  // 8. Cancel after 15 frames, then resume from the cache.
  const fresh = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 3 });
  const controller = new AbortController();
  let cancelled = false;
  try {
    await runRenderJob(
      { mapId: map.id, quality: "final", settings: fresh, basemap },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.stage === "rendering" && p.rendered >= 15) controller.abort();
        }
      }
    );
  } catch (error) {
    cancelled = error instanceof RenderCancelled;
  }
  const resumed = await runRenderJob({ mapId: map.id, quality: "final", settings: fresh, basemap });
  check("cancelled render resumes from the cache", cancelled && resumed.rendered <= 64 - 15 && resumed.rendered > 0, { cancelled, resumedRendered: resumed.rendered });

  // 9. GPU box filter equals the CPU reference.
  const style = basemapStyle(basemap, { labels: false });
  const gpu = new FrameRenderer({ width: 480, height: 270, pixelRatio: 2 + 1e-4 / 480, supersample: 2, style, antialias: false });
  const cpu = new FrameRenderer({ width: 480, height: 270, pixelRatio: 2 + 1e-4 / 480, supersample: 1, style, antialias: false });
  try {
    await gpu.init();
    await cpu.init();
    await gpu.setView(b, 0);
    await cpu.setView(b, 0);
    const g = gpu.draw("base");
    const full = cpu.draw("base");
    const reference = downsampleBox(full.pixels, full.width, full.height, 2);
    let worst = 0;
    for (let i = 0; i < g.pixels.length; i++) worst = Math.max(worst, Math.abs(g.pixels[i] - reference.rgba[i]));
    check("GPU box filter matches the CPU reference", g.width === reference.width && worst <= 1, { worstChannelDifference: worst, size: [g.width, g.height] });
  } finally {
    gpu.destroy();
    cpu.destroy();
  }

  removeRenders(first.storeRoot);

  const passed = checks.every((c) => c.passed);
  log(`R1 renderer: ${checks.filter((c) => c.passed).length}/${checks.length} checks passed`, passed ? "ok" : "fail");
  return { passed, checks, firstRender: { rendered: first.rendered, msPerRenderedFrame: Math.round(first.msPerRenderedFrame), totalSeconds: +(first.totalMs / 1000).toFixed(1) }, differences: temporal.differences };
}

async function runR2(log: SpikeLog, basemap: BasemapSource): Promise<Record<string, unknown>> {
  const city = basemap.kind === "region";
  const a: View = city ? { center: { lng: 2.3488, lat: 48.8534 }, zoom: 12.2, bearing: -20, pitch: 0 } : { center: { lng: -30, lat: 30 }, zoom: 1.8, bearing: 0, pitch: 0 };
  const b: View = city ? { center: { lng: 2.2945, lat: 48.8584 }, zoom: 15.4, bearing: 40, pitch: 60 } : { center: { lng: 10, lat: 48 }, zoom: 5.5, bearing: 30, pitch: 50 };
  const map = await createMapComp({ name: "R2 4K move", width: 3840, height: 2160, duration: 10, frameRate: 25, view: a, newScene: true });
  const c: View = { ...b, bearing: b.bearing + 60, pitch: b.pitch + 5 };
  await keyframe(map.id, 0, a);
  await keyframe(map.id, 6, b);
  await keyframe(map.id, 10, c);
  // Ease the camera like a designer would: easy ease on every control keyframe.
  await host(`
    var layer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
    for (var i = 0; i < LML.map.CONTROLS.length; i++) {
      var prop = LML.map.controlValueProperty(layer, LML.map.CONTROLS[i].name);
      for (var k = 1; k <= prop.numKeys; k++) {
        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        var ease = [new KeyframeEase(0, 33.33)];
        prop.setTemporalEaseAtKey(k, ease, ease);
      }
    }
    return "1";`);
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 2 });
  const first = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap });
  log(`R2 4K: ${first.rendered} frames at ${first.msPerRenderedFrame.toFixed(0)} ms per frame (2x supersampling), ${(first.totalMs / 1000).toFixed(0)} s in total`, "ok");
  const temporal = sequencePops(first);
  log(`R2 pops: ${temporal.pops.length} (largest frame change ${temporal.maxDifference.toFixed(2)})`, temporal.pops.length === 0 ? "ok" : "fail");
  // Change only the last keyframe: frames up to 6 s (0-150) keep their cameras, 151-249 change.
  await keyframe(map.id, 10, { ...c, bearing: c.bearing + 10 });
  const changed = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap });
  log(`R2 after changing the end keyframe: ${changed.rendered} redrawn, ${changed.reused} reused`, "muted");
  const keep = path().join(spikeDir(), "R2-frames");
  fs().mkdirSync(keep, { recursive: true });
  for (const frame of [0, 125, 249]) fs().copyFileSync(path().join(first.sequences[0].folder, sequenceFileName(frame)), path().join(keep, `base-${frame}.png`));
  removeRenders(first.storeRoot);
  return {
    frames: first.frames,
    msPerRenderedFrame: Math.round(first.msPerRenderedFrame),
    totalSeconds: +(first.totalMs / 1000).toFixed(1),
    pops: temporal.pops,
    maxDifference: temporal.maxDifference,
    differences: temporal.differences,
    changedRendered: changed.rendered,
    changedReused: changed.reused,
    passed: temporal.pops.length === 0 && changed.rendered === 99
  };
}

export const renderTestArchives = () => [naturalEarthArchivePath(), regionArchivePath("paris")];
