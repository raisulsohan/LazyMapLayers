// HT1: heat. Points with weights become a rendered layer of their own: warm where the points are,
// nothing away from them, and the heaviest point the warmest.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { DEFAULT_HEAT, heatPoints, type HeatSetting } from "../core/style/heat.ts";
import { evalScript, fs, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { addLegend } from "./overlays/legend.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

export async function runHeatTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 28, lng: 95 }, zoom: 2.6, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "HT1 heat", ...SIZE, duration: 1, frameRate: 25, view, newScene: true });
  const heat: HeatSetting = {
    ...DEFAULT_HEAT,
    column: "Incidents",
    radius: 40,
    points: heatPoints([
      { lat: 23.8, lng: 90.4, value: 100 },
      { lat: 28.6, lng: 77.2, value: 60 },
      { lat: 35.7, lng: 139.7, value: 12 }
    ])
  };
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
  const rendered = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "midnight", heat });
  if (rendered.passes.join(",") !== "base,highlight-HEAT") problems.push(`passes rendered: ${rendered.passes.join(",")}`);

  const sequence = rendered.sequences.find((s) => s.pass === "highlight-HEAT");
  const samples: Record<string, number[]> = {};
  if (!sequence) {
    problems.push("no heat pass was rendered");
  } else {
    const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;
    const at = (place: { lat: number; lng: number }) => {
      const p = project(view, SIZE, place);
      const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    };
    samples.dhaka = at({ lat: 23.8, lng: 90.4 });
    samples.tokyo = at({ lat: 35.7, lng: 139.7 });
    samples.mongolia = at({ lat: 46.9, lng: 103.8 });
    samples.arabianSea = at({ lat: 15, lng: 65 });
    // Warm at the heaviest point, warmer there than at the lightest, and nothing far from any point.
    if (samples.dhaka[3] < 120) problems.push(`Dhaka is barely warm: ${samples.dhaka}`);
    if (samples.tokyo[3] < 10) problems.push(`Tokyo is not warm at all: ${samples.tokyo}`);
    if (samples.tokyo[3] >= samples.dhaka[3]) problems.push(`the lightest point is as warm as the heaviest: Tokyo ${samples.tokyo}, Dhaka ${samples.dhaka}`);
    if (samples.mongolia[3] !== 0 || samples.arabianSea[3] !== 0) problems.push(`heat far from any point: Mongolia ${samples.mongolia}, Arabian Sea ${samples.arabianSea}`);
  }

  // The layer in After Effects carries the pass's name, so the layer list says what it is.
  const layers = JSON.parse(
    await evalScript(`(function () {
      var comp = LML.pins.findMapLayer(${JSON.stringify(map.id)}).source, out = [];
      for (var i = 1; i <= comp.numLayers; i++) {
        var tag = LML.tag.read(comp.layer(i));
        out.push({ pass: tag ? tag.pass : "?", name: comp.layer(i).name });
      }
      return LML.json.stringify(out);
    })()`)
  ) as { pass: string; name: string }[];
  const heatLayer = layers.find((layer) => layer.pass === "highlight-HEAT");
  if (!heatLayer) problems.push(`the map comp holds ${JSON.stringify(layers)}`);
  else if (heatLayer.name !== "Heat: Incidents") problems.push(`the layer is called "${heatLayer.name}"`);

  // The legend of the heat alone: three steps, low to high, named after the column.
  const legend = await addLegend(map.id, null, { theme: "midnight", heat, corner: "topLeft" });
  if (legend.rows !== 3 || legend.name !== "Legend: Incidents") problems.push(`the heat legend has ${legend.rows} rows and is called "${legend.name}"`);

  // A frame of the scene, for looking at afterwards.
  const shot = path().join(spikeDir(), "ht1-heat.png").split(String.fromCharCode(92)).join("/");
  fs().rmSync(shot, { force: true });
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.saveFrameToPng(0, new File(${JSON.stringify(shot)})); return "1"; })()`);
  let size = -1;
  for (let i = 0; i < 80; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!fs().existsSync(shot)) continue;
    const now = fs().statSync(shot).size;
    if (now > 0 && now === size) break;
    size = now;
  }
  if (size <= 0) problems.push("After Effects did not save the frame of the scene");

  const passed = problems.length === 0;
  log(
    `HT1 heat: ${heat.points.length} points rendered as "${heatLayer?.name ?? "-"}", Dhaka alpha ${samples.dhaka?.[3] ?? "-"}, Tokyo ${samples.tokyo?.[3] ?? "-"}, Mongolia ${samples.mongolia?.[3] ?? "-"}, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, layer: heatLayer?.name ?? null, legendRows: legend.rows, samples, problems };
}
