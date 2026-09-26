// LB5: the names inside a downloaded city.
//
// A slow move over central Paris at street zooms, labelled from the Paris region's own tiles:
// districts, landmarks and stations, the Seine laid along its line, and the main streets turned
// along theirs. Checked on the layers: the kinds are there, streets and the river carry a rotation
// expression whose value follows their line, names are French in the local language, and placing
// the names again after a size change keeps every city name instead of dropping it. Frames are saved
// with the region rendered under them, to look at.

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

type Layer = { labelId: string; part: string; text: string; rotation: number | null; rotationExpression: boolean };

async function labelLayers(mapId: string, time: number): Promise<Layer[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "label") continue;
        var properties = layer.property("ADBE Text Properties");
        var rotate = layer.property("ADBE Transform Group").property("ADBE Rotate Z");
        out.push({ labelId: tag.labelId, part: tag.part, text: properties ? properties.property("ADBE Text Document").value.text : "",
          rotation: rotate ? rotate.valueAtTime(${time}, false) : null, rotationExpression: !!(rotate && rotate.expressionEnabled && rotate.expression) });
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
      check(l.rotationExpression, `${l.text} does not turn with its line`);
      check(l.rotation !== null && Math.abs(l.rotation) <= 90.001, `${l.text} is turned ${l.rotation} degrees, upside down`);
    }
    check(turned.some((l) => l.rotation !== null && Math.abs(l.rotation) > 2), "no street or river name is turned at all");
    const seine = texts.find((l) => featureClassOf(l.labelId) === "cityWater" && /Seine/.test(l.text));
    check(!!seine, `the Seine is not among the water names (${(kinds.get("cityWater") ?? []).map((l) => l.text).join(", ")})`);
    check(texts.some((l) => featureClassOf(l.labelId) === "street" && /^(Rue|Boulevard|Avenue|Quai|Pont|Place)\b/.test(l.text)), `no street is named in French (${(kinds.get("street") ?? []).slice(0, 6).map((l) => l.text).join(", ")})`);
    const cityCount = texts.filter((l) => l.labelId.startsWith("city:")).length;

    // The streets and the river keep their turn at the end of the move, where the map has turned 25 degrees.
    const later = (await labelLayers(map.id, 4.6)).filter((l) => l.part === "text" && l.rotationExpression);
    const moved = later.filter((l) => {
      const first = turned.find((t) => t.labelId === l.labelId);
      return first && first.rotation !== null && l.rotation !== null && Math.abs(first.rotation - l.rotation) > 5;
    });
    check(moved.length > 0, "no street name turned with the map as it rotated");

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
  return { passed, problems, kinds, timings: result?.timings, texts: layers.filter((l) => l.part === "text").map((l) => `${featureClassOf(l.labelId) ?? "world"}: ${l.text}${l.rotation ? ` (${Math.round(l.rotation)} deg)` : ""}`), frames: saved.map((n) => path().join(spikeDir(), "LB5-frames", `${n}.png`)) };
}
