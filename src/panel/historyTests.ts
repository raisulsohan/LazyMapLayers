// HB1: historical borders (D92). Installs the pack from its GitHub release when it is not on this
// computer yet (online, so HB1 runs only when named), then renders South Asia in several years and
// reads the colour at known places: British India in 1914 and 1945 in the colour of the United
// Kingdom, India and Pakistan apart in 1947 with East Bengal in Pakistan's colour, Bangladesh in its own
// colour in 1971, and the Bay of Bengal still the sea in every year. A look with its own country
// colours and one without are both tried, and the borders draw-on must find the past's borders.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { encodePng } from "../core/image/png.ts";
import { hexToRgb, themeById, type Theme } from "../core/style/themes.ts";
import { historyPalette, rulerColours } from "../core/history/historyStyle.ts";
import { HISTORY_PACK } from "../core/history/packInfo.ts";
import { basemapStyle } from "./basemap/basemapStyle.ts";
import { HISTORY_BORDERS_SOURCE, HISTORY_SOURCE } from "./basemap/historyLayers.ts";
import { downloadHistoryPack, hasHistoryPack, historyManifest, loadHistoryYear } from "./data/history.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { callHost, evalScript, fs, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
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

  // The History Year slider: 1945 to 1947 drawn together, the renderer cross-fading per frame. Halfway,
  // central India is halfway between the British colour and India's; at the ends it is each year's own.
  {
    const theme = themeById("atlas");
    const palette = historyPalette(theme);
    const british = rgb255(rulerColours(loadHistoryYear(1945)!.rulers, palette).get("United Kingdom")!);
    const later = rulerColours(loadHistoryYear(1947)!.rulers, palette);
    const india = rgb255(later.get("India")!);
    const pakistan = rgb255(later.get("Pakistan")!);
    const style = basemapStyle({ kind: "world" }, { labels: false, theme, viewport: SIZE, history: { year: 1945 }, historyYears: [1945, 1947], animations: ["historyYear"], offlineWorld: false });
    if (!style.layers.some((layer) => layer.id === "history-fill@1947")) problems.push("a keyed slider: the style lacks the second year");
    const renderer = new FrameRenderer({ ...SIZE, style, antialias: true });
    try {
      await renderer.init();
      const expected: [number, string, number[]][] = [
        [1945, "British", british],
        [1946, "halfway", british.map((v, i) => Math.round(v + (india[i] - v) * 0.5))],
        [1947, "India", india]
      ];
      for (const [year, what, want] of expected) {
        const frame = await renderer.renderFrame({ ...VIEW, animation: { historyYear: year } } as View, 0);
        fs().writeFileSync(path().join(folder, `fade-${year}.png`), encodePng(frame.rgba, frame.width, frame.height));
        const scale = frame.width / SIZE.width;
        const at = (place: { lat: number; lng: number }) => {
          const point = renderer.maplibre.project([place.lng, place.lat]);
          return colourAround(frame, point.x * scale, point.y * scale);
        };
        const india = at(CENTRAL_INDIA);
        read[`fade ${year} central India`] = `rgb(${india.join(",")})`;
        if (distance(india, want) > 8) problems.push(`fade ${year}: central India rgb(${india.join(",")}), expected ${what} rgb(${want.join(",")})`);
        const sea = at(BAY_OF_BENGAL);
        if (distance(sea, rgb255(theme.ocean)) > 8) problems.push(`fade ${year}: the Bay of Bengal is rgb(${sea.join(",")}), not the sea`);
        if (year === 1947) {
          const bengal = at(EAST_BENGAL);
          if (distance(bengal, pakistan) > 8) problems.push(`fade 1947: East Bengal rgb(${bengal.join(",")}), expected Pakistan rgb(${pakistan.join(",")})`);
        }
      }
    } finally {
      renderer.destroy();
    }
  }

  // In After Effects: the History Year slider on a real map, keyed from 1945 to 1947 over a second, read
  // back by the panel, rendered (every frame differs), and counted on screen by the year layer.
  {
    const theme = themeById("atlas");
    const palette = historyPalette(theme);
    const british = rgb255(rulerColours(loadHistoryYear(1945)!.rulers, palette).get("United Kingdom")!);
    const india = rgb255(rulerColours(loadHistoryYear(1947)!.rulers, palette).get("India")!);
    const map = await createMapComp({ name: "HB1 over time", width: SIZE.width, height: SIZE.height, duration: 1, frameRate: 25, view: VIEW, newScene: true });
    await callHost("setMapSettings", { mapId: map.id, history: { year: 1945 } });
    await callHost("setControlKeys", { mapId: map.id, name: "History Year", times: [0, 24 / 25], values: [1945, 1947] });
    const listed = (await callHost<{ mapId: string; history: unknown; historySlider: { now: number; keys: number[] | null } | null }[]>("listMaps")).find((m) => m.mapId === map.id);
    if (JSON.stringify(listed?.historySlider?.keys) !== "[1945,1947]") problems.push(`the panel reads the slider's keys as ${JSON.stringify(listed?.historySlider?.keys)}`);
    const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
    const result = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "atlas", history: { year: 1945 } });
    read["over time frames drawn"] = String(result.rendered);
    if (result.rendered !== 25) problems.push(`${result.rendered} of 25 frames were drawn; the years change every frame`);
    const base = result.sequences.find((sequence) => sequence.pass === "base");
    if (base) {
      const pixel = (frame: number) => {
        const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(base.folder, sequenceFileName(frame))))).rgba;
        const p = project(VIEW, SIZE, CENTRAL_INDIA);
        const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
        return [rgba[i], rgba[i + 1], rgba[i + 2]];
      };
      for (const [frame, want, what] of [[0, british, "British"], [12, british.map((v, i) => Math.round(v + (india[i] - v) * 0.5)), "halfway"], [24, india, "India"]] as [number, number[], string][]) {
        const got = pixel(frame);
        read[`over time frame ${frame}`] = `rgb(${got.join(",")})`;
        if (distance(got, want) > 8) problems.push(`over time frame ${frame}: central India rgb(${got.join(",")}), expected ${what} rgb(${want.join(",")})`);
      }
    } else problems.push("over time: no base pass was rendered");
    fs().rmSync(result.storeRoot, { recursive: true, force: true, maxRetries: 3 });
    try {
      await callHost("addDataYear", { mapId: map.id, history: true, corner: "bottomRight", fonts: ["SegoeUI-Semibold", "ArialMT"], color: [1, 1, 1], haloColor: [0, 0, 0], halo: 3 });
      const counted = JSON.parse(
        await evalScript(`(function () {
          var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, out = [];
          for (var i = 1; i <= scene.numLayers; i++) {
            var tag = LML.tag.read(scene.layer(i));
            if (!tag || tag.kind !== "historyYear") continue;
            var text = scene.layer(i).property("ADBE Text Properties").property("ADBE Text Document");
            out.push(String(text.valueAtTime(0, false).text), String(text.valueAtTime(0.48, false).text), String(text.valueAtTime(24 / 25, false).text));
          }
          return LML.json.stringify(out);
        })()`)
      ) as string[];
      read["year layer"] = counted.join(",");
      if (counted.join(",") !== "1945,1946,1947") problems.push(`the year layer counts ${counted.join(",") || "nothing"}`);
    } catch (error) {
      problems.push(`the year layer: ${error instanceof Error ? error.message : String(error)}`);
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
