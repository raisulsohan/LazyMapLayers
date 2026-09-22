// DT1: numbers on the map. A table of countries and values is joined to the map's own codes, drawn
// as one layer above the basemap, and each country carries the colour of its step.

import { project, type View } from "../core/camera/camera.ts";
import { columnValues, readDataTable } from "../core/data/dataTable.ts";
import { buildLookup, joinValues } from "../core/data/join.ts";
import { dataFillColors, DEFAULT_DATA_FILL, type DataFill } from "../core/style/dataFill.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { evalScript, fs, path } from "./cep.ts";
import { countryJoinTargets } from "./data/countries.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

export async function runDataTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 28, lng: 95 }, zoom: 2.2, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "DT1 data", ...SIZE, duration: 1, frameRate: 25, view, newScene: true });

  // A table as a CSV parser would hand it over: names in three languages, a code, and a row for
  // somewhere that does not exist.
  const rows = [
    ["Country", "People (millions)", "Note"],
    ["Bangladesh", "171", "estimate"],
    ["India", "1,428", ""],
    ["日本", "124", "local name"],
    ["CHN", "1,411", "by code"],
    ["Atlantis", "9", "nowhere"]
  ];
  const table = readDataTable(rows, "people.csv");
  if (!table) {
    log("DT1 data on the map: the table was not read at all", "fail");
    return { passed: false, problems: ["readDataTable returned nothing"] };
  }
  if (table.keyColumn !== 0 || table.valueColumn !== 1) problems.push(`the sheet would start on columns ${table.keyColumn} and ${table.valueColumn}`);
  const values = columnValues(table, table.keyColumn, table.valueColumn);
  const joined = joinValues(values, buildLookup(countryJoinTargets()));
  const codes = joined.matched.map((row) => row.code).sort();
  if (codes.join(",") !== "BGD,CHN,IND,JPN") problems.push(`joined ${codes.join(",")}`);
  if (joined.unmatched.length !== 1 || joined.unmatched[0].key !== "Atlantis") problems.push(`unmatched: ${JSON.stringify(joined.unmatched)}`);

  const fill: DataFill = {
    ...DEFAULT_DATA_FILL,
    column: table.headings[table.valueColumn],
    values: Object.fromEntries(joined.matched.map((row) => [row.code, row.value])),
    steps: 4,
    opacity: 1
  };
  const colours = dataFillColors(fill);
  if (colours.legend.length !== 4) problems.push(`the legend has ${colours.legend.length} steps`);
  if (colours.colors.BGD === colours.colors.IND) problems.push(`171 and 1428 million got the same colour ${colours.colors.BGD}`);

  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
  const rendered = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: fill });
  if (rendered.passes.join(",") !== "base,highlight-DATA") problems.push(`passes rendered: ${rendered.passes.join(",")}`);

  const sequence = rendered.sequences.find((s) => s.pass === "highlight-DATA");
  if (!sequence) {
    problems.push("no data pass was rendered");
  } else {
    const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;
    const at = (place: { lat: number; lng: number }) => {
      const p = project(view, SIZE, place);
      const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    };
    const dhaka = at({ lat: 23.8, lng: 90.4 });
    const delhi = at({ lat: 28.6, lng: 77.2 });
    const tokyo = at({ lat: 35.7, lng: 139.7 });
    const mongolia = at({ lat: 46.9, lng: 103.8 });
    if (dhaka[3] < 200 || delhi[3] < 200 || tokyo[3] < 200) problems.push(`a country with a number is not filled: Dhaka ${dhaka}, Delhi ${delhi}, Tokyo ${tokyo}`);
    if (mongolia[3] !== 0) problems.push(`Mongolia has no number but is filled: ${mongolia}`);
    // Bangladesh is the smallest number and India the largest: the first and last step of the ramp.
    if (Math.abs(dhaka[0] - delhi[0]) < 20 && Math.abs(dhaka[2] - delhi[2]) < 20) problems.push(`the steps look alike: ${dhaka} and ${delhi}`);
    if (delhi.join() !== tokyo.join() && joined.matched.find((row) => row.code === "IND")!.value === joined.matched.find((row) => row.code === "JPN")!.value) problems.push("equal numbers got different colours");
  }

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
  const dataLayer = layers.find((layer) => layer.pass === "highlight-DATA");
  if (!dataLayer) problems.push(`the map comp holds ${JSON.stringify(layers)}`);
  else if (dataLayer.name !== `Data: ${fill.column}`) problems.push(`the layer is called "${dataLayer.name}"`);

  const passed = problems.length === 0;
  log(
    `DT1 data on the map: ${joined.matched.length} of ${values.length} rows joined (${codes.join(", ")}), ${colours.legend.length} steps, rendered as "${dataLayer?.name ?? "-"}", ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, joined: joined.matched.length, unmatched: joined.unmatched.length, codes, legend: colours.legend.map((step) => step.label), layer: dataLayer?.name ?? null, problems };
}
