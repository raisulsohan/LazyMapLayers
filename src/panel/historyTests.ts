// HB1: historical borders (D92). Installs the pack from its GitHub release when it is not on this
// computer yet (online, so HB1 runs only when named), then renders South Asia in several years and
// reads the colour at known places: British India in 1914 and 1945 in the colour of the United
// Kingdom, India and Pakistan apart in 1947 with East Bengal in Pakistan's colour, Bangladesh in its own
// colour in 1971, and the Bay of Bengal still the sea in every year. A look with its own country
// colours and one without are both tried, and the borders draw-on must find the past's borders.

import type { View } from "../core/camera/camera.ts";
import { encodePng } from "../core/image/png.ts";
import { hexToRgb, themeById, type Theme } from "../core/style/themes.ts";
import { historyPalette, rulerColours } from "../core/history/historyStyle.ts";
import { HISTORY_PACK } from "../core/history/packInfo.ts";
import { basemapStyle } from "./basemap/basemapStyle.ts";
import { HISTORY_BORDERS_SOURCE, HISTORY_SOURCE } from "./basemap/historyLayers.ts";
import { downloadHistoryPack, hasHistoryPack, historyManifest, loadHistoryYear } from "./data/history.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { fs, path } from "./cep.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 640, height: 360 };
const VIEW: View = { center: { lat: 22, lng: 82 }, zoom: 3.6, bearing: 0, pitch: 0 };

type Probe = { name: string; lat: number; lng: number; ruler: string | null };
const CENTRAL_INDIA = { lat: 21, lng: 78 };
const EAST_BENGAL = { lat: 24.6, lng: 90.2 };
const SINDH = { lat: 27, lng: 68.8 };
const BAY_OF_BENGAL = { lat: 15, lng: 88 };

/** What each year must show at each place; null is the sea. */
const YEARS: { year: number | null; probes: Probe[] }[] = [
  { year: 1914, probes: [{ name: "central India", ...CENTRAL_INDIA, ruler: "United Kingdom" }, { name: "Bay of Bengal", ...BAY_OF_BENGAL, ruler: null }] },
  { year: 1945, probes: [{ name: "central India", ...CENTRAL_INDIA, ruler: "United Kingdom" }, { name: "East Bengal", ...EAST_BENGAL, ruler: "United Kingdom" }, { name: "Sindh", ...SINDH, ruler: "United Kingdom" }, { name: "Bay of Bengal", ...BAY_OF_BENGAL, ruler: null }] },
  { year: 1947, probes: [{ name: "central India", ...CENTRAL_INDIA, ruler: "India" }, { name: "East Bengal", ...EAST_BENGAL, ruler: "Pakistan" }, { name: "Sindh", ...SINDH, ruler: "Pakistan" }, { name: "Bay of Bengal", ...BAY_OF_BENGAL, ruler: null }] },
  { year: 1971, probes: [{ name: "central India", ...CENTRAL_INDIA, ruler: "India" }, { name: "East Bengal", ...EAST_BENGAL, ruler: "Bangladesh" }, { name: "Sindh", ...SINDH, ruler: "Pakistan" }, { name: "Bay of Bengal", ...BAY_OF_BENGAL, ruler: null }] }
];

/** The commonest colour in a 9 x 9 square around a pixel: a river or a border line through it does not count. */
function colourAround(frame: { rgba: Uint8Array; width: number; height: number }, x: number, y: number): [number, number, number] {
  const counts = new Map<number, number>();
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const px = Math.max(0, Math.min(frame.width - 1, Math.round(x) + dx));
      const py = Math.max(0, Math.min(frame.height - 1, Math.round(y) + dy));
      const at = (py * frame.width + px) * 4;
      const key = (frame.rgba[at] << 16) | (frame.rgba[at + 1] << 8) | frame.rgba[at + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

const rgb255 = (hex: string) => hexToRgb(hex).map((v) => Math.round(v * 255)) as [number, number, number];
const distance = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

export async function runHistoryTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  let downloaded: number | null = null;
  if (!hasHistoryPack()) {
    const started = performance.now();
    await downloadHistoryPack();
    downloaded = Math.round(performance.now() - started);
    log(`HB1 installed the pack (${(HISTORY_PACK.bytes / 1048576).toFixed(1)} MB) in ${(downloaded / 1000).toFixed(1)} s`, "muted");
  }
  const manifest = historyManifest();
  if (!manifest) return { passed: false, problems: ["the pack did not install"] };
  if (manifest.years.length !== 56) problems.push(`the pack has ${manifest.years.length} years, expected 56`);

  const folder = path().join(spikeDir(), "HB1-frames");
  fs().mkdirSync(folder, { recursive: true });
  const read: Record<string, string> = {};

  for (const theme of [themeById("atlas"), themeById("midnight")] as Theme[]) {
    const palette = historyPalette(theme);
    for (const { year, probes } of YEARS) {
      const colours = year === null ? new Map<string, string>() : rulerColours(loadHistoryYear(year)!.rulers, palette);
      const colourOf = (ruler: string | null) => rgb255(ruler === null ? theme.ocean : colours.get(ruler) ?? "#ff00ff");
      const style = basemapStyle({ kind: "world" }, { labels: false, theme, viewport: SIZE, history: year === null ? null : { year }, offlineWorld: false });
      if (year !== null && !style.sources[HISTORY_SOURCE]) {
        problems.push(`${theme.id} ${year}: the style has no historical shapes`);
        continue;
      }
      const renderer = new FrameRenderer({ ...SIZE, style, antialias: true });
      try {
        await renderer.init();
        const frame = await renderer.renderFrame(VIEW, 0);
        fs().writeFileSync(path().join(folder, `${theme.id}-${year}.png`), encodePng(frame.rgba, frame.width, frame.height));
        const scale = frame.width / SIZE.width;
        for (const probe of probes) {
          const point = renderer.maplibre.project([probe.lng, probe.lat]);
          const got = colourAround(frame, point.x * scale, point.y * scale);
          const want = colourOf(probe.ruler);
          read[`${theme.id} ${year} ${probe.name}`] = `rgb(${got.join(",")})`;
          const off = distance(got, want);
          if (off > 8) problems.push(`${theme.id} ${year} ${probe.name}: rgb(${got.join(",")}), expected ${probe.ruler ?? "the sea"} rgb(${want.join(",")})`);
        }
        // Neighbours read apart: India and Pakistan in 1947 and 1971, Pakistan and Bangladesh in 1971.
        for (const [a, b] of [["India", "Pakistan"], ["India", "Bangladesh"], ["India", "Nepal"], ["India", "China"]]) {
          if (year !== null && year >= 1947 && colours.get(a) && colours.get(a) === colours.get(b)) problems.push(`${theme.id} ${year}: ${a} and ${b} share a colour`);
        }
      } finally {
        renderer.destroy();
      }
    }
  }

  // The borders draw-on draws the past's borders, not today's.
  const drawOn = basemapStyle({ kind: "world" }, { labels: false, viewport: SIZE, history: { year: 1914 }, animations: ["bordersDraw"], offlineWorld: false });
  const borders = drawOn.layers.find((layer) => layer.id === "boundaries") as { source?: string; paint?: Record<string, unknown> } | undefined;
  const drawData = (drawOn.sources["lml-borders"] as { data?: GeoJSON.FeatureCollection } | undefined)?.data;
  if (borders?.source !== "lml-borders" || !borders.paint?.["line-gradient"]) problems.push("with history, the borders draw-on layer is missing");
  if (!drawData || drawData.features[0]?.geometry.type !== "MultiLineString" || !drawOn.sources[HISTORY_BORDERS_SOURCE]) problems.push("with history, the borders draw-on does not draw the past's borders");
  if (drawOn.layers.some((layer) => layer.id === "countries" || layer.id === "admin1" || layer.id === "country-labels")) problems.push("today's countries are still in the style");

  const passed = problems.length === 0;
  log(`HB1 historical borders: ${Object.entries(read).map(([k, v]) => `${k} ${v}`).join("; ")}; ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`HB1 ${problem}`, "fail");
  return { passed, problems, downloadedMs: downloaded, years: manifest.years.length, read, frames: folder };
}
