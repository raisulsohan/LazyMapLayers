// TH1: a contact sheet of every theme, drawn by the real frame renderer: the world, a subcontinent and
// (when the Paris region is on disk) a tilted city. For judging the looks by eye; it also fails when a
// theme's style does not load or draws an empty frame.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { THEMES } from "../core/style/themes.ts";
import { basemapStyle, type BasemapSource } from "./basemap/basemapStyle.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { callHost, evalScript, fs, path } from "./cep.ts";
import { hasImagery } from "./imagery/packs.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { createMapComp } from "./mapApi.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const CELL_WIDTH = 400;
const CELL_HEIGHT = 225;

export async function runThemeTests(log: SpikeLog): Promise<Record<string, unknown>> {
  const regions = ["paris-wide", "paris"].filter((name) => fs().existsSync(regionArchivePath(name)));
  const views: { name: string; view: View; basemap: BasemapSource }[] = [
    { name: "world", view: { center: { lat: 28, lng: 45 }, zoom: 2.3, bearing: 0, pitch: 0 }, basemap: { kind: "world" } },
    { name: "south-asia", view: { center: { lat: 23.5, lng: 86 }, zoom: 4.6, bearing: 0, pitch: 0 }, basemap: { kind: "world" } }
  ];
  if (regions.includes("paris")) views.push({ name: "paris", view: { center: { lat: 48.8584, lng: 2.3 }, zoom: 14.2, bearing: 25, pitch: 55 }, basemap: { kind: "regions", names: regions } });

  // Every look, then the looks that gain most from shaded relief, with it (when the pack is installed).
  const rows: { theme: (typeof THEMES)[number]; relief: boolean }[] = THEMES.map((theme) => ({ theme, relief: false }));
  if (hasImagery("relief")) for (const id of ["midnight", "daylight", "paper"]) rows.push({ theme: THEMES.find((t) => t.id === id)!, relief: true });

  const sheet = document.createElement("canvas");
  sheet.width = CELL_WIDTH * views.length;
  sheet.height = CELL_HEIGHT * rows.length;
  const context = sheet.getContext("2d")!;
  const problems: string[] = [];
  const started = performance.now();

  for (const [row, { theme, relief }] of rows.entries()) {
    for (const [column, shot] of views.entries()) {
      const style = basemapStyle(shot.basemap, { labels: true, theme: theme.id, relief, viewport: { width: WIDTH, height: HEIGHT } });
      const renderer = new FrameRenderer({ width: WIDTH, height: HEIGHT, style });
      try {
        await renderer.init();
        const frame = await renderer.renderFrame(shot.view, 0);
        const colours = new Set<number>();
        for (let i = 0; i < frame.rgba.length; i += 4 * 997) colours.add((frame.rgba[i] << 16) | (frame.rgba[i + 1] << 8) | frame.rgba[i + 2]);
        if (colours.size < 3) problems.push(`${theme.id}${relief ? " + relief" : ""} / ${shot.name}: the frame is almost one colour`);
        const cell = document.createElement("canvas");
        cell.width = frame.width;
        cell.height = frame.height;
        const pixels = new ImageData(frame.width, frame.height);
        pixels.data.set(frame.rgba);
        cell.getContext("2d")!.putImageData(pixels, 0, 0);
        context.drawImage(cell, column * CELL_WIDTH, row * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
        context.fillStyle = theme.dark ? "#ffffff" : "#000000";
        context.font = "600 15px Segoe UI";
        context.fillText(relief ? `${theme.label} + relief` : theme.label, column * CELL_WIDTH + 8, row * CELL_HEIGHT + 20);
      } catch (error) {
        problems.push(`${theme.id} / ${shot.name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        renderer.destroy();
      }
    }
  }

  const file = path().join(spikeDir(), "themes.png");
  fs().writeFileSync(file, Buffer.from(sheet.toDataURL("image/png").split(",")[1], "base64"));
  const passed = problems.length === 0;
  log(`TH1 themes: ${rows.length} looks x ${views.length} views in ${((performance.now() - started) / 1000).toFixed(1)} s, ${problems.length} problems (${file})`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, themes: THEMES.length, views: views.map((v) => v.name), file, problems };
}

// SAT1: the Satellite look through the real render job, with passes. The picture must colour the land
// and water passes, while the mattes still come from the land polygons and cover every pixel once.
export async function runSatelliteTest(log: SpikeLog): Promise<Record<string, unknown>> {
  if (!hasImagery("blue-marble")) {
    log("SAT1 skipped: the satellite imagery pack is not installed", "muted");
    return { passed: true, skipped: true };
  }
  const problems: string[] = [];
  const view: View = { center: { lat: 22, lng: 84 }, zoom: 4.2, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "SAT1 satellite", width: 1280, height: 720, duration: 1, frameRate: 25, view, newScene: true });
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base", "land", "water", "landMatte", "waterMatte"] }, DEFAULT_FINAL_SETTINGS);
  const result = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "satellite" });
  const read = (pass: string) => {
    const sequence = result.sequences.find((s) => s.pass === pass);
    if (!sequence) throw new Error(`no ${pass} sequence`);
    return decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;
  };
  const colours = (rgba: Uint8Array) => {
    const seen = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4 * 53) if (rgba[i + 3] > 200) seen.add((rgba[i] >> 3 << 10) | (rgba[i + 1] >> 3 << 5) | (rgba[i + 2] >> 3));
    return seen.size;
  };
  const land = read("land");
  const water = read("water");
  const landMatte = read("landMatte");
  const waterMatte = read("waterMatte");
  let matteErrors = 0;
  let landPixels = 0;
  let shapeErrors = 0;
  for (let i = 3; i < landMatte.length; i += 4) {
    if (Math.abs(landMatte[i] + waterMatte[i] - 255) > 1) matteErrors++;
    if (landMatte[i] > 127) landPixels++;
    if (Math.abs(land[i] - landMatte[i]) > 2) shapeErrors++;
  }
  const landShare = landPixels / (landMatte.length / 4);
  if (matteErrors) problems.push(`${matteErrors} pixels are not covered exactly once by the mattes`);
  if (landShare < 0.2 || landShare > 0.85) problems.push(`the land matte covers ${(landShare * 100).toFixed(0)} % of the frame`);
  if (shapeErrors) problems.push(`the land pass differs from the land matte's shape on ${shapeErrors} pixels`);
  const landColours = colours(land);
  const waterColours = colours(water);
  if (landColours < 60) problems.push(`the land pass has only ${landColours} colours: the picture is missing`);
  if (waterColours < 8) problems.push(`the water pass has only ${waterColours} colours: the picture is missing`);
  const passed = problems.length === 0;
  log(`SAT1 satellite passes: land ${(landShare * 100).toFixed(0)} % of the frame, ${landColours} land colours, ${waterColours} water colours, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, landShare, landColours, waterColours, problems };
}

// HL1: highlighted countries through the real render job. The highlight must arrive as its own layer,
// switched on, above a base pass that stays clean; its pixels must sit on the country and nowhere
// else; and a map without highlights must lose the layer again.
export async function runHighlightTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const size = { width: 1280, height: 720 };
  const view: View = { center: { lat: 23.7, lng: 86 }, zoom: 4.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "HL1 highlight", ...size, duration: 1, frameRate: 25, view, newScene: true });
  const highlights = [{ code: "BGD", name: "Bangladesh", color: "#ff9d2e", fill: 0.5, outline: 3 }];
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
  const first = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, highlights });
  const read = (result: typeof first, pass: string) => {
    const sequence = result.sequences.find((s) => s.pass === pass);
    if (!sequence) throw new Error(`no ${pass} sequence`);
    return decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;
  };
  if (first.passes.join(",") !== "base,highlight") problems.push(`passes rendered: ${first.passes.join(",")}`);
  const at = (rgba: Uint8Array, place: { lat: number; lng: number }) => {
    const p = project(view, size, place);
    const i = (Math.round(p.y) * size.width + Math.round(p.x)) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
  };
  const dhaka = { lat: 23.8, lng: 90.4 };
  const delhi = { lat: 28.6, lng: 77.2 };
  const bay = { lat: 15, lng: 88 };
  const pass = read(first, "highlight");
  const inside = at(pass, dhaka);
  // Premultiplied #ff9d2e at half opacity is about (128, 79, 23, 128); the file stores it unpremultiplied.
  if (inside[3] < 100 || inside[3] > 160 || inside[0] < 200 || inside[2] > 90) problems.push(`Dhaka in the highlight pass is ${inside}`);
  if (at(pass, delhi)[3] !== 0 || at(pass, bay)[3] !== 0) problems.push(`the highlight pass is not empty outside Bangladesh: Delhi ${at(pass, delhi)}, the bay ${at(pass, bay)}`);
  const base = read(first, "base");
  const baseDhaka = at(base, dhaka);
  const baseDelhi = at(base, delhi);
  if (Math.abs(baseDhaka[0] - baseDelhi[0]) > 6 || Math.abs(baseDhaka[2] - baseDelhi[2]) > 6) problems.push(`the base pass is tinted under the highlight: ${baseDhaka} vs ${baseDelhi}`);

  const layers = async () =>
    JSON.parse(
      await evalScript(`(function () { var c = LML.pins.findMapLayer(${JSON.stringify(map.id)}).source, out = []; for (var i = 1; i <= c.numLayers; i++) { var t = LML.tag.read(c.layer(i)); out.push({ pass: t ? t.pass : "?", enabled: c.layer(i).enabled, name: c.layer(i).name }); } return LML.json.stringify(out); })()`)
    ) as { pass: string; enabled: boolean; name: string }[];
  const withHighlight = await layers();
  if (withHighlight.map((l) => `${l.pass}:${l.enabled}`).join(",") !== "highlight:true,base:true") problems.push(`layers after the first render: ${JSON.stringify(withHighlight)}`);

  // A colour change redraws the highlight pass alone: the base pass keeps its cached image.
  const baseKeyBefore = first.sequences.find((s) => s.pass === "base")!.firstFramePath;
  const recoloured = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, highlights: [{ ...highlights[0], color: "#36b3ff" }] });
  const blue = at(read(recoloured, "highlight"), dhaka);
  if (blue[2] < 200 || blue[0] > 110) problems.push(`the recoloured highlight is ${blue}`);
  const sameBase = Buffer.compare(fs().readFileSync(baseKeyBefore), fs().readFileSync(recoloured.sequences.find((s) => s.pass === "base")!.firstFramePath)) === 0;
  if (!sameBase) problems.push("the base pass changed with the highlight's colour");

  // Without highlights the layer goes away.
  const none = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, highlights: [] });
  const withoutHighlight = await layers();
  if (none.passes.join(",") !== "base" || withoutHighlight.map((l) => l.pass).join(",") !== "base") problems.push(`after removing the highlight: passes ${none.passes.join(",")}, layers ${JSON.stringify(withoutHighlight)}`);

  // A picture of the result for people: two highlights over the satellite look (when it is installed).
  try {
    const sample = await runRenderJob({
      mapId: map.id,
      quality: "final",
      settings,
      basemap: { kind: "world" },
      theme: hasImagery("blue-marble") ? "satellite" : "midnight",
      highlights: [
        { code: "BGD", name: "Bangladesh", color: "#ff9d2e", fill: 0.45, outline: 3 },
        { code: "NPL", name: "Nepal", color: "#36b3ff", fill: 0.45, outline: 3 }
      ]
    });
    const sheet = document.createElement("canvas");
    sheet.width = size.width;
    sheet.height = size.height;
    const context = sheet.getContext("2d")!;
    for (const pass of ["base", "highlight"]) {
      const file = path().join(sample.sequences.find((q) => q.pass === pass)!.folder, sequenceFileName(0));
      context.drawImage(await createImageBitmap(new Blob([fs().readFileSync(file)], { type: "image/png" })), 0, 0);
    }
    fs().writeFileSync(path().join(spikeDir(), "highlight-sample.png"), Buffer.from(sheet.toDataURL("image/png").split(",")[1], "base64"));
  } catch (error) {
    problems.push(`the sample picture failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = problems.length === 0;
  log(`HL1 highlight pass: Dhaka ${inside.join(",")}, own layer switched on, base untouched, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, inside, problems };
}

// LB1: auto labels arrive in small batches. No single call may keep After Effects busy for long, a
// cancelled build stops early and leaves the viewer on the scene, and Remove labels clears them all.
export async function runLabelTimingTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 48, lng: 12 }, zoom: 4.3, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "LB1 labels", width: 1920, height: 1080, duration: 6, frameRate: 25, view, newScene: true });
  let calls = 0;
  const result = await autoLabels(map.id, { maxLabels: 60, onProgress: () => calls++ });
  if (result.expressionErrors.length) problems.push(`expression errors: ${result.expressionErrors.slice(0, 3).join("; ")}`);
  if (result.labels !== result.planned || result.cancelled) problems.push(`built ${result.labels} of ${result.planned} labels`);
  if (calls < 2) problems.push(`only ${calls} batches`);
  if (result.longestCallMs > 3000) problems.push(`one call kept After Effects busy for ${result.longestCallMs} ms`);

  // Cancel after the first batch.
  const stopper = new AbortController();
  const cancelled = await autoLabels(map.id, { maxLabels: 60, signal: stopper.signal, onProgress: () => stopper.abort() });
  if (!cancelled.cancelled || cancelled.labels >= cancelled.planned) problems.push(`cancelling built ${cancelled.labels} of ${cancelled.planned} labels`);
  const state = JSON.parse(
    await evalScript(`(function () { var l = LML.pins.findMapLayer(${JSON.stringify(map.id)}); var scene = l.containingComp, n = 0; for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "label") n++; } return LML.json.stringify({ labelLayers: n, sceneInViewer: app.project.activeItem === scene, pending: LML.labels.pending !== null }); })()`)
  ) as { labelLayers: number; sceneInViewer: boolean; pending: boolean };
  if (state.labelLayers !== cancelled.layers) problems.push(`${state.labelLayers} label layers after cancelling, expected ${cancelled.layers} (the old ones are replaced)`);
  if (!state.sceneInViewer || state.pending) problems.push(`after cancelling the viewer is ${state.sceneInViewer ? "on" : "not on"} the scene, pending ${state.pending}`);

  const removed = await callHost<{ removed: number }>("removeLabels", { mapId: map.id });
  if (removed.removed !== cancelled.layers) problems.push(`Remove labels removed ${removed.removed} of ${cancelled.layers} layers`);

  const passed = problems.length === 0;
  log(
    `LB1 labels: ${result.labels} labels (${result.layers} layers) in ${result.seconds.toFixed(1)} s over ${calls} calls, longest ${result.longestCallMs} ms; host ${JSON.stringify(result.hostTimings)}; ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, labels: result.labels, layers: result.layers, seconds: result.seconds, calls, longestCallMs: result.longestCallMs, host: result.hostTimings, problems };
}
