// TH1: a contact sheet of every theme, drawn by the real frame renderer: the world, a subcontinent and
// (when the Paris region is on disk) a tilted city. For judging the looks by eye; it also fails when a
// theme's style does not load or draws an empty frame.

import type { View } from "../core/camera/camera.ts";
import { THEMES } from "../core/style/themes.ts";
import { basemapStyle, type BasemapSource } from "./basemap/basemapStyle.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { fs, path } from "./cep.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const CELL_WIDTH = 480;
const CELL_HEIGHT = 270;

export async function runThemeTests(log: SpikeLog): Promise<Record<string, unknown>> {
  const regions = ["paris-wide", "paris"].filter((name) => fs().existsSync(regionArchivePath(name)));
  const views: { name: string; view: View; basemap: BasemapSource }[] = [
    { name: "world", view: { center: { lat: 28, lng: 45 }, zoom: 2.3, bearing: 0, pitch: 0 }, basemap: { kind: "world" } },
    { name: "south-asia", view: { center: { lat: 23.5, lng: 86 }, zoom: 4.6, bearing: 0, pitch: 0 }, basemap: { kind: "world" } }
  ];
  if (regions.includes("paris")) views.push({ name: "paris", view: { center: { lat: 48.8584, lng: 2.3 }, zoom: 14.2, bearing: 25, pitch: 55 }, basemap: { kind: "regions", names: regions } });

  const sheet = document.createElement("canvas");
  sheet.width = CELL_WIDTH * views.length;
  sheet.height = CELL_HEIGHT * THEMES.length;
  const context = sheet.getContext("2d")!;
  const problems: string[] = [];
  const started = performance.now();

  for (const [row, theme] of THEMES.entries()) {
    for (const [column, shot] of views.entries()) {
      const style = basemapStyle(shot.basemap, { labels: true, theme: theme.id, viewport: { width: WIDTH, height: HEIGHT } });
      const renderer = new FrameRenderer({ width: WIDTH, height: HEIGHT, style });
      try {
        await renderer.init();
        const frame = await renderer.renderFrame(shot.view, 0);
        const colours = new Set<number>();
        for (let i = 0; i < frame.rgba.length; i += 4 * 997) colours.add((frame.rgba[i] << 16) | (frame.rgba[i + 1] << 8) | frame.rgba[i + 2]);
        if (colours.size < 3) problems.push(`${theme.id} / ${shot.name}: the frame is almost one colour`);
        const cell = document.createElement("canvas");
        cell.width = frame.width;
        cell.height = frame.height;
        const pixels = new ImageData(frame.width, frame.height);
        pixels.data.set(frame.rgba);
        cell.getContext("2d")!.putImageData(pixels, 0, 0);
        context.drawImage(cell, column * CELL_WIDTH, row * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
        context.fillStyle = theme.dark ? "#ffffff" : "#000000";
        context.font = "600 15px Segoe UI";
        context.fillText(theme.label, column * CELL_WIDTH + 8, row * CELL_HEIGHT + 20);
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
  log(`TH1 themes: ${THEMES.length} themes x ${views.length} views in ${((performance.now() - started) / 1000).toFixed(1)} s, ${problems.length} problems (${file})`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, themes: THEMES.length, views: views.map((v) => v.name), file, problems };
}
