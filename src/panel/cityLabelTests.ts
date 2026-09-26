// LB5: the names inside a downloaded city.
//
// A slow move over central Paris at street zooms, labelled from the Paris region's own tiles:
// districts, landmarks and stations, the Seine bent along its line, and the main streets along
// theirs. Checked on the layers: the kinds are there, streets and the river are set on a "Line" mask
// path that follows their line, reads left to right and moves as the map turns, names are French in
// the local language, and placing the names again after a size change keeps every city name instead
// of dropping it. Frames are saved with the region rendered under them, to look at.

import type { View } from "../core/camera/camera.ts";
import { resolveLabelTemplate } from "../core/labels/labelTemplate.ts";
import { featureClassOf } from "../core/labels/nature.ts";
import { PREVIEW_SETTINGS } from "../core/render/plan.ts";
import { themeById } from "../core/style/themes.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { evalScript, fs, path } from "./cep.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { repositionLabels } from "./labels/repositionLabels.ts";
import { createMapComp, setView } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

type Layer = { labelId: string; part: string; text: string; rotation: number | null; rotationExpression: boolean; onLine: boolean; lineError: string; ends: number[][] | null };

async function labelLayers(mapId: string, time: number): Promise<Layer[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "label") continue;
        var properties = layer.property("ADBE Text Properties");
        var rotate = layer.property("ADBE Transform Group").property("ADBE Rotate Z");
        var masks = layer.property("ADBE Mask Parade"), line = null, onLine = false, ends = null;
        for (var m = 1; masks && m <= masks.numProperties; m++) if (masks.property(m).name === "Line") line = masks.property(m);
        if (line && properties) {
          onLine = properties.property("ADBE Text Path Options").property("ADBE Text Path").value === line.propertyIndex;
          var v = line.property("ADBE Mask Shape").valueAtTime(${time}, false).vertices;
          // The path's ends, and the step at its middle by length, where the name's centre sits.
          if (v.length > 1) {
            var total = 0, k = 0, walked = 0;
            for (k = 1; k < v.length; k++) total += Math.sqrt(Math.pow(v[k][0] - v[k - 1][0], 2) + Math.pow(v[k][1] - v[k - 1][1], 2));
            for (k = 1; k < v.length; k++) {
              walked += Math.sqrt(Math.pow(v[k][0] - v[k - 1][0], 2) + Math.pow(v[k][1] - v[k - 1][1], 2));
              if (walked >= total / 2) break;
            }
            ends = [v[k - 1], v[k]];
          }
        }
        out.push({ labelId: tag.labelId, part: tag.part, text: properties ? properties.property("ADBE Text Document").value.text : "",
          rotation: rotate ? rotate.valueAtTime(${time}, false) : null, rotationExpression: !!(rotate && rotate.expressionEnabled && rotate.expression),
          onLine: onLine, lineError: line ? String(line.property("ADBE Mask Shape").expressionError || "") : "", ends: ends });
      }
      return LML.json.stringify(out);
    })()`)
  ) as Layer[];
}

async function saveFrame(mapId: string, time: number, name: string): Promise<boolean> {
  const file = path().join(spikeDir(), "LB5-frames", `${name}.png`).split(String.fromCharCode(92)).join("/");
  fs().mkdirSync(path().dirname(file), { recursive: true });
  fs().rmSync(file, { force: true });
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp.saveFrameToPng(${time}, new File(${JSON.stringify(file)})); return "1"; })()`);
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

const angleOf = (step: number[][]) => (Math.atan2(step[1][1] - step[0][1], step[1][0] - step[0][0]) * 180) / Math.PI;

/** A name reads left to right at its middle (or runs nearly straight up or down, where either way reads). */
const upright = (step: number[][] | null) => !!step && step[1][0] - step[0][0] > -0.2 * Math.abs(step[1][1] - step[0][1]);

export async function runCityLabelTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const archive = regionArchivePath("paris");
  if (!fs().existsSync(archive)) return { passed: false, problems: ["the Paris region is not downloaded"] };
  const start: View = { center: { lng: 2.3376, lat: 48.8566 }, zoom: 14.2, bearing: 0, pitch: 0 };
  const end: View = { center: { lng: 2.3522, lat: 48.8545 }, zoom: 14.6, bearing: 25, pitch: 35 };
  const map = await createMapComp({ name: "LB5 city", width: 1920, height: 1080, duration: 5, frameRate: 25, view: start, newScene: true });
  const at = (time: number) => evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.time = ${time}; return "1"; })()`);
  await at(0);
  await setView(map.id, start, true);
  await at(4.5);
  await setView(map.id, end, true);
  const saved: string[] = [];
  let result: Awaited<ReturnType<typeof autoLabels>> | null = null;
  let layers: Layer[] = [];

  try {
    result = await autoLabels(map.id, { theme: "daylight", maxLabels: 60, regions: [archive], language: { kind: "local" }, english: false });
    layers = await labelLayers(map.id, 0);
    const texts = layers.filter((l) => l.part === "text");
    const kinds = new Map<string, Layer[]>();
    for (const l of texts) {
      const kind = featureClassOf(l.labelId) ?? l.labelId.split(":")[0];
      kinds.set(kind, [...(kinds.get(kind) ?? []), l]);
    }
    const count = (kind: string) => kinds.get(kind)?.length ?? 0;
    check(count("district") >= 2, `only ${count("district")} districts were named`);
    check(count("landmark") + count("station") + count("park") + count("campus") >= 3, "almost no landmarks, stations, parks or campuses were named");
    check(count("street") >= 4, `only ${count("street")} streets were named`);
    check(count("cityWater") >= 1, "the Seine was not named");
    const turned = texts.filter((l) => featureClassOf(l.labelId) === "street" || featureClassOf(l.labelId) === "cityWater");
    for (const l of turned) {
      if (l.onLine) {
        check(!l.lineError, `${l.text}'s line: ${l.lineError}`);
        check(!l.rotationExpression && l.rotation === 0, `${l.text} is still turned as well as bent`);
        check(upright(l.ends), `${l.text} reads right to left: ${JSON.stringify(l.ends)}`);
      } else {
        // A line that turns too sharply at the name keeps a straight name turned along it.
        check(l.rotationExpression, `${l.text} is neither bent along its line nor turned with it`);
        check(l.rotation !== null && Math.abs(l.rotation) <= 90.001, `${l.text} is turned ${l.rotation} degrees, upside down`);
      }
    }
    const bent = turned.filter((l) => l.onLine);
    check(bent.length >= turned.length / 2, `only ${bent.length} of ${turned.length} street and river names are bent along their line`);
    check(bent.some((l) => !!l.ends && Math.abs(angleOf(l.ends)) > 5), "no street or river name lies at an angle");
    const seine = texts.find((l) => featureClassOf(l.labelId) === "cityWater" && /Seine/.test(l.text));
    check(!!seine, `the Seine is not among the water names (${(kinds.get("cityWater") ?? []).map((l) => l.text).join(", ")})`);
    check(texts.some((l) => featureClassOf(l.labelId) === "street" && /^(Rue|Boulevard|Avenue|Quai|Pont|Place)\b/.test(l.text)), `no street is named in French (${(kinds.get("street") ?? []).slice(0, 6).map((l) => l.text).join(", ")})`);
    const cityCount = texts.filter((l) => l.labelId.startsWith("city:")).length;

    // The streets and the river keep their turn at the end of the move, where the map has turned 25 degrees.
    const later = (await labelLayers(map.id, 4.6)).filter((l) => l.part === "text" && l.onLine);
    const moved = later.filter((l) => {
      const first = turned.find((t) => t.labelId === l.labelId);
      return first?.ends && l.ends && Math.abs(angleOf(first.ends) - angleOf(l.ends)) > 5;
    });
    check(moved.length > 0, "no street name turned with the map as it rotated");
    for (const l of later) check(upright(l.ends), `at the end of the move ${l.text} reads right to left: ${JSON.stringify(l.ends)}`);

    await runRenderJob({ mapId: map.id, quality: "preview", settings: PREVIEW_SETTINGS, basemap: { kind: "region", name: "paris" }, theme: "daylight" });
    for (const [time, name] of [[0, "start"], [4.6, "end"]] as const) if (await saveFrame(map.id, time, name)) saved.push(name);
    check(saved.length === 2, `only ${saved.length} frames were saved`);

    // Bigger names, placed again: the city names are placed again too, not dropped as unknown.
    const bigger = { ...resolveLabelTemplate(themeById("daylight")), size: 30, countrySize: 34 };
    const again = await repositionLabels(map.id, { template: bigger });
    check(again.unknown === 0, `${again.unknown} names were unknown when placed again`);
    check(again.labels >= cityCount, `only ${again.labels} of ${cityCount + (texts.length - cityCount)} names were placed again`);
  } catch (error) {
    problems.push(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = problems.length === 0;
  const kinds: Record<string, number> = {};
  for (const l of layers.filter((x) => x.part === "text")) {
    const k = featureClassOf(l.labelId) ?? l.labelId.split(":")[0];
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  log(`LB5 city names: ${result ? `${result.labels} names (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ")}) in ${result.seconds.toFixed(1)} s` : "no labels"}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, kinds, timings: result?.timings, texts: layers.filter((l) => l.part === "text").map((l) => `${featureClassOf(l.labelId) ?? "world"}: ${l.text}${l.onLine ? " (on its line)" : ""}`), frames: saved.map((n) => path().join(spikeDir(), "LB5-frames", `${n}.png`)) };
}
