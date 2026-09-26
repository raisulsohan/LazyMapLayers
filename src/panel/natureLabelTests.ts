// LB4: names of the natural world, built in After Effects.
//
// A flight from the Bay of Bengal up to Mount Everest, labelled with seas and rivers and with
// mountains and deserts switched on. Checked on the text layers themselves: water names are set in
// an italic font in the look's water colour, ranges in spaced capitals, Everest carries a triangle
// and its height, and switching the two kinds off leaves none of them. In Bengali the sea is named
// in Bengali, upright, in a font that shapes it. Frames are saved to look at.

import type { View } from "../core/camera/camera.ts";
import { resolveLabelTemplate } from "../core/labels/labelTemplate.ts";
import { natureClassOf } from "../core/labels/nature.ts";
import { hexToRgb, themeById } from "../core/style/themes.ts";
import { PREVIEW_SETTINGS } from "../core/render/plan.ts";
import { evalScript, fs, path } from "./cep.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { createMapComp, setView } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

type LabelLayer = { labelId: string; part: string; text: string; font: string; fill: number[]; tracking: number; star: number | null; shape: string | null };

async function labelLayers(mapId: string): Promise<LabelLayer[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "label") continue;
        var properties = layer.property("ADBE Text Properties");
        if (properties) {
          var doc = properties.property("ADBE Text Document").value;
          out.push({ labelId: tag.labelId, part: tag.part, text: doc.text, font: doc.font, fill: doc.applyFill ? doc.fillColor : [0, 0, 0], tracking: doc.tracking, star: null, shape: null });
          continue;
        }
        var contents = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
        var star = contents.property("ADBE Vector Shape - Star");
        out.push({ labelId: tag.labelId, part: tag.part, text: "", font: "", fill: [0, 0, 0], tracking: 0,
          star: star ? star.property("ADBE Vector Star Points").value : null,
          shape: star ? (star.property("ADBE Vector Star Type").value === 2 ? "polygon" : "star") : (contents.property("ADBE Vector Shape - Ellipse") ? "circle" : null) });
      }
      return LML.json.stringify(out);
    })()`)
  ) as LabelLayer[];
}

async function saveFrame(mapId: string, time: number, name: string): Promise<boolean> {
  const file = path().join(spikeDir(), "LB4-frames", `${name}.png`).split(String.fromCharCode(92)).join("/");
  fs().mkdirSync(path().dirname(file), { recursive: true });
  fs().rmSync(file, { force: true });
  await evalScript(`(function () { var s = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp; s.saveFrameToPng(${time}, new File(${JSON.stringify(file)})); return "1"; })()`);
  let size = -1;
  for (let i = 0; i < 80; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!fs().existsSync(file)) continue;
    const now = fs().statSync(file).size;
    if (now > 0 && now === size) break;
    size = now;
  }
  return size > 0;
}

const near = (got: number[], want: number[], tolerance = 2 / 255) => want.every((v, i) => Math.abs(got[i] - v) <= tolerance);

export async function runNatureLabelTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const paper = themeById("paper");
  const template = resolveLabelTemplate(paper);
  const bay: View = { center: { lng: 87.5, lat: 19.5 }, zoom: 3.3, bearing: 0, pitch: 0 };
  const everest: View = { center: { lng: 86.925, lat: 27.99 }, zoom: 7.2, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "LB4 nature", width: 1920, height: 1080, duration: 4, frameRate: 25, view: bay, newScene: true });
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.time = 0; return "1"; })()`);
  await setView(map.id, bay, true);
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.time = 3.5; return "1"; })()`);
  await setView(map.id, everest, true);
  let saved: string[] = [];
  let result: Awaited<ReturnType<typeof autoLabels>> | null = null;
  let layers: LabelLayer[] = [];

  try {
    // In English first, so every name is in a script that has italics and capitals.
    result = await autoLabels(map.id, { theme: "paper", maxLabels: 60, language: { kind: "fixed", language: "en" }, english: false });
    layers = await labelLayers(map.id);
    const texts = layers.filter((l) => l.part === "text");
    const natural = texts.filter((l) => natureClassOf(l.labelId));
    const kinds = new Set(natural.map((l) => natureClassOf(l.labelId)));
    check(natural.length >= 4, `only ${natural.length} natural names were placed`);
    check(kinds.has("sea") || kinds.has("ocean"), "no sea or ocean was named over the Bay of Bengal");
    check(kinds.has("range") || kinds.has("peak"), "no range or peak was named on the way to Everest");

    const water = natural.filter((l) => ["sea", "ocean", "river", "lake"].includes(natureClassOf(l.labelId)!));
    check(water.length > 0, "no water was named");
    for (const name of water) {
      check(/Italic/i.test(name.font), `${name.text} is set in ${name.font}, not an italic`);
      check(near(name.fill, hexToRgb(template.waterColor)), `${name.text} is not in the water colour`);
    }
    const bayName = water.find((l) => /Bengal/.test(l.text));
    check(!!bayName, `the Bay of Bengal was not named (water: ${water.map((l) => l.text).join(", ")})`);

    const ranges = natural.filter((l) => natureClassOf(l.labelId) === "range" || natureClassOf(l.labelId) === "desert");
    for (const name of ranges) {
      check(name.text === name.text.toUpperCase() && name.tracking >= 300, `${name.text} is not in spaced capitals (tracking ${name.tracking})`);
      check(near(name.fill, hexToRgb(template.natureColor)), `${name.text} is not in the land colour`);
    }

    const everestText = texts.find((l) => natureClassOf(l.labelId) === "peak" && /Everest/.test(l.text));
    check(!!everestText, `Mount Everest was not named (peaks: ${texts.filter((l) => natureClassOf(l.labelId) === "peak").map((l) => l.text).join(", ")})`);
    if (everestText) {
      const height = layers.find((l) => l.labelId === everestText.labelId && l.part === "subtitle");
      check(!!height && /8,848 m$/.test(height.text), `Everest's height reads "${height ? height.text : "nothing"}"`);
      const mark = layers.find((l) => l.labelId === everestText.labelId && l.part === "dot");
      check(!!mark && mark.shape === "polygon" && mark.star === 3, `Everest's mark is ${mark ? `${mark.shape} with ${mark.star} points` : "missing"}`);
    }

    // A render of the basemap under the names, and frames to look at.
    await runRenderJob({ mapId: map.id, quality: "preview", settings: PREVIEW_SETTINGS, basemap: { kind: "world" }, theme: "paper" });
    for (const [time, name] of [[0, "bay"], [3.9, "everest"]] as const) if (await saveFrame(map.id, time, name)) saved.push(name);
    check(saved.length === 2, `only ${saved.length} frames were saved`);

    // In the local languages, with the English line: a river in China is named in Chinese with its
    // English name under it, and a peak keeps its English name beside its height.
    await autoLabels(map.id, { theme: "paper", maxLabels: 60, language: { kind: "local" }, english: true });
    const local = await labelLayers(map.id);
    const chinese = local.filter((l) => l.part === "text" && natureClassOf(l.labelId) && /[一-鿿]/.test(l.text));
    check(chinese.length > 0, "no natural feature in China was named in Chinese");
    const withEnglish = chinese.filter((l) => local.some((o) => o.labelId === l.labelId && o.part === "subtitle" && /[A-Za-z]/.test(o.text)));
    check(withEnglish.length === chinese.length, `${chinese.length - withEnglish.length} Chinese names have no English line`);
    const peakLine = local.find((l) => l.part === "subtitle" && /Everest/.test(l.text));
    check(!!peakLine && /8,848 m$/.test(peakLine.text), `Everest's line in the local languages reads "${peakLine ? peakLine.text : "nothing"}"`);
    if (await saveFrame(map.id, 3.9, "everest-local")) saved = [...saved, "everest-local"];

    // Both kinds off: no natural names at all.
    const plain = await autoLabels(map.id, { theme: "paper", maxLabels: 60, water: false, land: false });
    const left = (await labelLayers(map.id)).filter((l) => natureClassOf(l.labelId));
    check(left.length === 0 && plain.labels > 0, `${left.length} natural names left with both kinds switched off`);

    // In Bengali: the sea in Bengali, upright, in a font that shapes it.
    await autoLabels(map.id, { theme: "paper", maxLabels: 60, language: { kind: "fixed", language: "bn" }, english: false, places: false, countries: false });
    const bengali = (await labelLayers(map.id)).filter((l) => l.part === "text" && natureClassOf(l.labelId) === "sea");
    const bayBn = bengali.find((l) => /বঙ্গোপসাগর/.test(l.text));
    check(!!bayBn, `no Bengali Bay of Bengal (seas: ${bengali.map((l) => l.text).join(", ")})`);
    if (bayBn) check(!/Italic/i.test(bayBn.font) && /Nirmala|Bangla|Bengali/i.test(bayBn.font), `the Bengali sea name is set in ${bayBn.font}`);
    if (await saveFrame(map.id, 0, "bay-bengali")) saved = [...saved, "bay-bengali"];
  } catch (error) {
    problems.push(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = problems.length === 0;
  const summary = result ? `${result.labels} names of ${result.candidates} candidates, ${layers.filter((l) => l.part === "text" && natureClassOf(l.labelId)).length} natural` : "no labels";
  log(`LB4 natural names: ${summary}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return {
    passed,
    problems,
    placed: layers.filter((l) => l.part === "text").map((l) => ({ kind: natureClassOf(l.labelId) ?? l.labelId.split(":")[0], text: l.text, font: l.font })),
    frames: saved.map((name) => path().join(spikeDir(), "LB4-frames", `${name}.png`))
  };
}
