// OW1: the offline world (OpenStreetMap to zoom 9 from the data pack, D91) under every map.
//
// Like WB1, every view is rendered twice, with the offline world and without it, and the pixels that
// differ are what it really draws. Out at zoom 5 it must draw nothing (Natural Earth still carries
// the world); from zoom 8 it must fill the ground with coasts, rivers, roads and places; the large
// lakes stay water although its land covers them; and a frame stays inside the render budget.

import type { View } from "../core/camera/camera.ts";
import { encodePng } from "../core/image/png.ts";
import { hexToRgb, themeById } from "../core/style/themes.ts";
import { basemapStyle } from "./basemap/basemapStyle.ts";
import { hasOfflineWorld } from "./basemap/maplibreSetup.ts";
import { hasImagery } from "./imagery/packs.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { fs, path } from "./cep.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 640, height: 360 };
const PIXELS = SIZE.width * SIZE.height;

/** Places across the world where the far field used to be thin, at the zooms a flight passes through. */
const PLACES: { name: string; center: { lat: number; lng: number }; zooms: number[] }[] = [
  { name: "dhaka", center: { lat: 23.78, lng: 90.4 }, zooms: [5, 8, 10] },
  { name: "paris", center: { lat: 48.86, lng: 2.35 }, zooms: [5, 8, 10] },
  { name: "alps", center: { lat: 46.5, lng: 9.5 }, zooms: [8] },
  { name: "amazon", center: { lat: -3.1, lng: -60.0 }, zooms: [8] },
  { name: "nile-delta", center: { lat: 30.6, lng: 31.2 }, zooms: [8] },
  { name: "norway", center: { lat: 61.0, lng: 6.0 }, zooms: [8] },
  { name: "nairobi", center: { lat: -1.29, lng: 36.82 }, zooms: [9] },
  { name: "tokyo", center: { lat: 35.68, lng: 139.76 }, zooms: [9] }
];

/** Share of pixels (in %) that differ between two frames of the same size. */
function differing(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let at = 0; at < a.length; at += 4) if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) n++;
  return (n / PIXELS) * 100;
}

/** Lakes whose middle must stay the colour of water once the offline world's land is drawn. */
const LAKES: { name: string; center: { lat: number; lng: number }; zoom: number }[] = [
  { name: "caspian", center: { lat: 42.0, lng: 50.5 }, zoom: 7.2 },
  { name: "michigan", center: { lat: 44.0, lng: -87.0 }, zoom: 7.5 },
  { name: "victoria", center: { lat: -1.0, lng: 33.0 }, zoom: 7.5 }
];

async function frameAt(offlineWorld: boolean, view: View, look: { theme?: string; relief?: boolean } = {}): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const style = basemapStyle({ kind: "world" }, { labels: false, theme: themeById(look.theme ?? null), viewport: SIZE, offlineWorld, relief: look.relief });
  const renderer = new FrameRenderer({ ...SIZE, style, antialias: true });
  try {
    await renderer.init();
    const frame = await renderer.renderFrame(view, 0);
    return { rgba: frame.rgba, width: frame.width, height: frame.height };
  } finally {
    renderer.destroy();
  }
}

export async function runOfflineWorldTest(log: SpikeLog): Promise<Record<string, unknown>> {
  if (!hasOfflineWorld()) return { passed: false, problems: ["the offline world is not installed (offline/world.pmtiles in the user data folder)"] };
  const problems: string[] = [];
  const folder = path().join(spikeDir(), "OW1-frames");
  fs().mkdirSync(folder, { recursive: true });
  const save = (name: string, frame: { rgba: Uint8Array; width: number; height: number }) => fs().writeFileSync(path().join(folder, `${name}.png`), encodePng(frame.rgba, frame.width, frame.height));
  const shares: Record<string, number> = {};

  for (const place of PLACES) {
    for (const zoom of place.zooms) {
      const view: View = { center: place.center, zoom, bearing: 0, pitch: 0 };
      const full = await frameAt(true, view);
      const plain = await frameAt(false, view);
      save(`${place.name}-z${zoom}`, full);
      if (zoom >= 8) save(`${place.name}-z${zoom}-without`, plain);
      let drawn = 0;
      for (let at = 0; at < full.rgba.length; at += 4) {
        if (full.rgba[at] !== plain.rgba[at] || full.rgba[at + 1] !== plain.rgba[at + 1] || full.rgba[at + 2] !== plain.rgba[at + 2]) drawn++;
      }
      const share = (drawn / PIXELS) * 100;
      shares[`${place.name} z${zoom}`] = Math.round(share * 10) / 10;
      log(`OW1 ${place.name} zoom ${zoom}: the offline world paints ${share.toFixed(1)} % of the frame`, "muted");
      if (zoom < 6 && share > 0.1) problems.push(`${place.name} at zoom ${zoom} already changes ${share.toFixed(1)} % of the frame; Natural Earth should carry it alone`);
      if (zoom >= 8 && share < 5) problems.push(`${place.name} at zoom ${zoom}: the offline world paints only ${share.toFixed(1)} %`);
    }
  }

  const ocean = hexToRgb(themeById(null).ocean).map((v) => Math.round(v * 255));
  const lakes: Record<string, number> = {};
  for (const lake of LAKES) {
    const frame = await frameAt(true, { center: lake.center, zoom: lake.zoom, bearing: 0, pitch: 0 });
    save(`lake-${lake.name}`, frame);
    // A patch in the middle, not one pixel: a border may run through a lake (Victoria's does).
    let water = 0;
    let counted = 0;
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const at = (((frame.height >> 1) + dy) * frame.width + (frame.width >> 1) + dx) * 4;
        const off = Math.max(Math.abs(frame.rgba[at] - ocean[0]), Math.abs(frame.rgba[at + 1] - ocean[1]), Math.abs(frame.rgba[at + 2] - ocean[2]));
        if (off <= 16) water++;
        counted++;
      }
    }
    const share = Math.round((water / counted) * 100);
    lakes[lake.name] = share;
    if (share < 80) problems.push(`only ${share} % of the middle of ${lake.name} is the water colour ${ocean.join(",")}`);
  }

  // Looks that keep their own ground: the satellite picture stays the ground (only lines come on top),
  // country colours stay until they fade (7.5 to 9.5), and the shaded relief stays over the new ground.
  const looks: Record<string, number> = {};
  const dhaka8: View = { center: { lat: 23.78, lng: 90.4 }, zoom: 8, bearing: 0, pitch: 0 };
  if (hasImagery("blue-marble")) {
    const full = await frameAt(true, dhaka8, { theme: "satellite" });
    const plain = await frameAt(false, dhaka8, { theme: "satellite" });
    save("satellite-dhaka-z8", full);
    save("satellite-dhaka-z8-without", plain);
    looks.satelliteChanged = Math.round(differing(full.rgba, plain.rgba) * 10) / 10;
    if (looks.satelliteChanged > 35) problems.push(`over the satellite picture the offline world changes ${looks.satelliteChanged} % of the frame; it should only add lines`);
  }
  const europe7: View = { center: { lat: 48.5, lng: 10 }, zoom: 7, bearing: 0, pitch: 0 };
  {
    const full = await frameAt(true, europe7, { theme: "atlas" });
    const plain = await frameAt(false, europe7, { theme: "atlas" });
    save("atlas-europe-z7", full);
    looks.atlasChanged = Math.round(differing(full.rgba, plain.rgba) * 10) / 10;
    if (looks.atlasChanged > 35) problems.push(`with country colours the offline world changes ${looks.atlasChanged} % of the frame at zoom 7; the colours should still hold`);
  }
  if (hasImagery("relief")) {
    const alps: View = { center: { lat: 46.5, lng: 9.5 }, zoom: 7.5, bearing: 0, pitch: 0 };
    const shaded = await frameAt(true, alps, { theme: "daylight", relief: true });
    const flat = await frameAt(true, alps, { theme: "daylight", relief: false });
    save("relief-alps-z7.5", shaded);
    looks.reliefShows = Math.round(differing(shaded.rgba, flat.rgba) * 10) / 10;
    if (looks.reliefShows < 20) problems.push(`the shaded relief shows on only ${looks.reliefShows} % of the Alps once the offline world is there`);
  }

  // The render budget (docs/PERFORMANCE.md): a 1080p frame of the base pass, here over a city at zoom 9.
  const style = basemapStyle({ kind: "world" }, { labels: false, theme: themeById(null), viewport: { width: 1920, height: 1080 } });
  const renderer = new FrameRenderer({ width: 1920, height: 1080, style, antialias: true });
  const times: number[] = [];
  try {
    await renderer.init();
    for (let i = 0; i < 8; i++) {
      const started = performance.now();
      await renderer.renderFrame({ center: { lat: 23.78 + i * 0.02, lng: 90.4 + i * 0.03 }, zoom: 9 - i * 0.1, bearing: i * 3, pitch: 0 }, i * 40);
      times.push(performance.now() - started);
    }
  } finally {
    renderer.destroy();
  }
  const steady = times.slice(2);
  const average = steady.reduce((a, b) => a + b, 0) / steady.length;
  if (average > 300) problems.push(`a 1080p frame at zoom 9 takes ${average.toFixed(0)} ms, over the 300 ms budget`);

  const passed = problems.length === 0;
  log(`OW1 offline world: ${Object.entries(shares).map(([k, v]) => `${k} ${v} %`).join(", ")}; lakes ${Object.entries(lakes).map(([k, v]) => `${k} ${v} %`).join(", ")} water; 1080p frame ${average.toFixed(0)} ms; ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, shares, lakes, looks, msPerFrame1080: Math.round(average), folder, problems };
}
