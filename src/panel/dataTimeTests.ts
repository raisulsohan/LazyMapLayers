// DT2: colours by category, and numbers that change over the years.
//
// Categories: a table of blocs colours each country with its bloc's colour from the palette, in the
// rendered pixels, and the legend lists the blocs. Over time: a table of three years drives the
// rendered data pass through the "Data Time" slider, so Bangladesh at the first frame and at the
// last take the colours of their years, the move renders every frame (the camera holds still but the
// colours do not), and the year layer counts 2000, 2010, 2020 with the slider.

import { project, type View } from "../core/camera/camera.ts";
import { readDataTable } from "../core/data/dataTable.ts";
import { detectSeries, readSeries } from "../core/data/series.ts";
import { buildLookup, joinValues } from "../core/data/join.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { categoryPaletteById } from "../core/style/categories.ts";
import { dataFillColors, DEFAULT_DATA_FILL, normaliseDataFill, type DataFill } from "../core/style/dataFill.ts";
import { hexToRgb } from "../core/style/themes.ts";
import { callHost, evalScript, fs, path } from "./cep.ts";
import { countryJoinTargets } from "./data/countries.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob, type RenderJobResult } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 960, height: 540 };
const hex = (rgb: number[]) => `#${rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const near = (a: number[], b: number[], slack = 6) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= slack);

function pixelReader(result: RenderJobResult, view: View) {
  const sequence = result.sequences.find((s) => s.pass === "highlight-DATA");
  if (!sequence) return null;
  return (frame: number, place: { lat: number; lng: number }) => {
    const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(frame))))).rgba;
    const p = project(view, SIZE, place);
    const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
  };
}

export async function runDataTimeTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const view: View = { center: { lat: 24, lng: 84 }, zoom: 3, bearing: 0, pitch: 0 };
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
  const roots: string[] = [];
  const lookup = buildLookup(countryJoinTargets());
  const dhaka = { lat: 23.8, lng: 90.4 };
  const delhi = { lat: 28.6, lng: 77.2 };
  const kathmandu = { lat: 27.7, lng: 85.3 };

  // 1. Categories.
  const catMap = await createMapComp({ name: "DT2 categories", width: SIZE.width, height: SIZE.height, duration: 0.2, frameRate: 25, view, newScene: true });
  const blocs = readDataTable([["Country", "Bloc"], ["Bangladesh", "SAARC"], ["India", "SAARC"], ["Nepal", "SAARC"], ["China", "SCO"], ["Russia", "SCO"], ["Japan", "Quad"]], "blocs.csv")!;
  check(!!blocs && blocs.headings[blocs.valueColumn] === "Bloc", "a table of blocs was not read as one to colour by");
  const catRows = blocs.rows.map((row) => ({ key: row[0], value: row[1] }));
  const catJoined = joinValues(catRows, lookup);
  const catFill = normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "Bloc", values: {}, categories: Object.fromEntries(catJoined.matched.map((m) => [m.code, m.value])), palette: "safe", opacity: 1 })!;
  const catColours = dataFillColors(catFill);
  check(catColours.legend.map((row) => row.label).join(",") === "SAARC,SCO,Quad", `the legend lists ${catColours.legend.map((row) => row.label).join(",")}`);
  const catRender = await runRenderJob({ mapId: catMap.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: catFill });
  roots.push(catRender.storeRoot);
  const catPixel = pixelReader(catRender, view);
  check(!!catPixel, "no data pass was rendered for the categories");
  const safe = categoryPaletteById("safe").colours.map((c) => hexToRgb(c).map((v) => Math.round(v * 255)));
  if (catPixel) {
    const bd = catPixel(0, dhaka);
    const beijing = catPixel(0, { lat: 39.9, lng: 116.4 });
    check(near(bd, safe[0]), `Bangladesh (SAARC) is ${hex(bd)}, not ${hex(safe[0])}`);
    check(near(beijing, safe[1]), `China (SCO) is ${hex(beijing)}, not ${hex(safe[1])}`);
    check(near(catPixel(0, delhi), bd), "India and Bangladesh are in one bloc but differ in colour");
  }

  // 2. Over time: a wide table of three years.
  const timeMap = await createMapComp({ name: "DT2 over time", width: SIZE.width, height: SIZE.height, duration: 1, frameRate: 25, view, newScene: true });
  const table = readDataTable(
    [
      ["Country", "2000", "2010", "2020"],
      ["Bangladesh", "10", "50", "100"],
      ["India", "100", "100", "100"],
      ["Nepal", "5", "", "95"]
    ],
    "growth.csv"
  )!;
  const shape = detectSeries(table);
  check(shape?.kind === "wide", `the years were read as ${shape?.kind ?? "nothing"}`);
  const series = shape ? readSeries(table, shape, 0, 1) : { times: [], rows: [] };
  const joined = joinValues(series.rows.map((row) => ({ key: row.key, value: row.values })), lookup);
  const fill: DataFill = normaliseDataFill({ ...DEFAULT_DATA_FILL, column: "Growth", values: {}, series: { times: series.times, values: Object.fromEntries(joined.matched.map((m) => [m.code, m.value])) }, steps: 5, opacity: 1 })!;
  check(!!fill?.series, "the series was not kept");
  await callHost("setControlKeys", { mapId: timeMap.id, name: "Data Time", times: [0, 24 / 25], values: [2000, 2020] });
  const timeRender = await runRenderJob({ mapId: timeMap.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: fill });
  roots.push(timeRender.storeRoot);
  check(timeRender.rendered === 25, `${timeRender.rendered} of 25 frames were drawn; the colours change every frame`);
  const timePixel = pixelReader(timeRender, view);
  if (timePixel) {
    const want = (time: number, code: string) => hexToRgb(dataFillColors(fill, time).colors[code]).map((v) => Math.round(v * 255));
    const first = timePixel(0, dhaka);
    const last = timePixel(24, dhaka);
    check(near(first, want(2000, "BGD")), `Bangladesh at 2000 is ${hex(first)}, not ${hex(want(2000, "BGD"))}`);
    check(near(last, want(2020, "BGD")), `Bangladesh at 2020 is ${hex(last)}, not ${hex(want(2020, "BGD"))}`);
    check(!near(first, last, 20), "Bangladesh looks the same in 2000 and 2020");
    check(near(timePixel(0, delhi), timePixel(24, delhi)), "India changed colour though its number did not");
    // Nepal has no 2010: the middle frame is straight between 5 and 95.
    const middle = timePixel(12, kathmandu);
    check(near(middle, want(2010, "NPL")), `Nepal in 2010 is ${hex(middle)}, not ${hex(want(2010, "NPL"))}`);
  } else problems.push("no data pass was rendered for the years");

  // 3. The year on screen.
  let years: string[] = [];
  try {
    await callHost("addDataYear", { mapId: timeMap.id, corner: "bottomRight", fonts: ["SegoeUI-Semibold", "ArialMT"], color: [1, 1, 1], haloColor: [0, 0, 0], halo: 3 });
    years = JSON.parse(
      await evalScript(`(function () {
        var scene = LML.pins.findMapLayer(${JSON.stringify(timeMap.id)}).containingComp, out = [];
        for (var i = 1; i <= scene.numLayers; i++) {
          var tag = LML.tag.read(scene.layer(i));
          if (!tag || tag.kind !== "dataYear") continue;
          var text = scene.layer(i).property("ADBE Text Properties").property("ADBE Text Document");
          out.push(String(text.valueAtTime(0, false).text), String(text.valueAtTime(0.48, false).text), String(text.valueAtTime(24 / 25, false).text));
        }
        return LML.json.stringify(out);
      })()`)
    ) as string[];
  } catch (error) {
    problems.push(`the year layer: ${error instanceof Error ? error.message : String(error)}`);
  }
  check(years.join(",") === "2000,2010,2020", `the year layer counts ${years.join(",") || "nothing"}`);

  for (const root of roots) {
    try {
      fs().rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Left for the next run.
    }
  }
  const passed = problems.length === 0;
  log(`DT2 categories and years: ${passed ? "blocs in their colours, Bangladesh through its years, the year counting" : `${problems.length} problems`}`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, framesDrawn: timeRender.rendered, years };
}
