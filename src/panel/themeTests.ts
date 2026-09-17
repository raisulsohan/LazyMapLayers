// TH1: a contact sheet of every theme, drawn by the real frame renderer: the world, a subcontinent and
// (when the Paris region is on disk) a tilted city. For judging the looks by eye; it also fails when a
// theme's style does not load or draws an empty frame.

import type { View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { THEMES } from "../core/style/themes.ts";
import { basemapStyle, type BasemapSource } from "./basemap/basemapStyle.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { fs, path } from "./cep.ts";
import { hasImagery } from "./imagery/packs.ts";
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
