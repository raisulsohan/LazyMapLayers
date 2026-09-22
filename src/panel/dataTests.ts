// DT1: numbers on the map. A table of countries and values is joined to the map's own codes, drawn
// as one layer above the basemap, and each country carries the colour of its step.

import { project, type View } from "../core/camera/camera.ts";
import { columnValues, readDataTable } from "../core/data/dataTable.ts";
import { buildLookup, joinValues } from "../core/data/join.ts";
import { dataFillColors, DEFAULT_DATA_FILL, type DataFill } from "../core/style/dataFill.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { evalScript, fs, path } from "./cep.ts";
import { spikeDir } from "./spikes.ts";
import { provinceJoinTargets } from "./data/admin1.ts";
import { countryJoinTargets } from "./data/countries.ts";
import { createMapComp } from "./mapApi.ts";
import { addBubbles, removeBubbles } from "./overlays/bubbles.ts";
import { addLegend, removeLegend } from "./overlays/legend.ts";
import { runRenderJob } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

/** Saves a frame of the map's scene, for looking at afterwards. */
async function saveSceneFrame(mapId: string, name: string): Promise<boolean> {
  const file = path().join(spikeDir(), `${name}.png`).split(String.fromCharCode(92)).join("/");
  fs().rmSync(file, { force: true });
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp.saveFrameToPng(0, new File(${JSON.stringify(file)})); return "1"; })()`);
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

export async function runDataTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  let bubbleOffset = 0;
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
    opacity: 1,
    // The map's own look is dark, so the deep end of the ramp is the small numbers.
    reverse: true
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

  // Bubbles: one layer with a circle per country, each following its own place.
  const places = [
    { id: "BGD", name: "Bangladesh", lat: 23.8, lng: 90.4, value: fill.values.BGD },
    { id: "IND", name: "India", lat: 22.3, lng: 78.7, value: fill.values.IND },
    { id: "JPN", name: "Japan", lat: 36.5, lng: 139.2, value: fill.values.JPN },
    { id: "CHN", name: "China", lat: 35.5, lng: 103.2, value: fill.values.CHN }
  ];
  const bubbles = await addBubbles(map.id, fill, places, { theme: "midnight", maxRadius: 50 });
  if (bubbles.expressionErrors.length) problems.push(`bubble expressions: ${bubbles.expressionErrors.slice(0, 2).join("; ")}`);
  if (bubbles.bubbles !== 4) problems.push(`${bubbles.bubbles} bubbles were built`);
  // The largest value gets the largest circle, and a quarter of it is half as wide.
  const biggest = bubbles.set.bubbles[0];
  const smallest = bubbles.set.bubbles[bubbles.set.bubbles.length - 1];
  if (biggest.id !== "IND" || Math.abs(biggest.radius - 50 * (SIZE.height / 1080)) > 0.5) problems.push(`the largest bubble is ${biggest.id} at ${biggest.radius} px`);
  if (smallest.radius >= biggest.radius) problems.push(`the smallest bubble is ${smallest.radius} px`);
  const drawn = JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, out = null;
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "bubbles") continue;
        var root = layer.property("ADBE Root Vectors Group"), groups = [];
        for (var g = 1; g <= root.numProperties; g++) {
          var group = root.property(g);
          var position = group.property("ADBE Vector Transform Group").property("ADBE Vector Position").valueAtTime(0, false);
          var size = group.property("ADBE Vectors Group").property(1).property("ADBE Vector Ellipse Size").value;
          groups.push({ name: group.name, x: position[0], y: position[1], size: size[0] });
        }
        out = { name: layer.name, groups: groups };
      }
      return LML.json.stringify(out);
    })()`)
  ) as { name: string; groups: { name: string; x: number; y: number; size: number }[] } | null;
  if (!drawn) problems.push("no bubble layer is in the scene");
  else {
    if (drawn.groups.length !== 4) problems.push(`the bubble layer holds ${drawn.groups.length} circles`);
    // Every circle sits on its place, to the pixel the camera maths gives.
    let worst = 0;
    for (const place of places) {
      const group = drawn.groups.find((entry) => entry.name.indexOf(place.name) === 0);
      if (!group) {
        problems.push(`no circle for ${place.name}`);
        continue;
      }
      const want = project(view, SIZE, place);
      worst = Math.max(worst, Math.hypot(group.x - want.x, group.y - want.y));
    }
    if (worst > 0.05) problems.push(`a bubble is ${worst.toFixed(2)} px off its place`);
    bubbleOffset = worst;
  }
  const rebuilt = await addBubbles(map.id, fill, places, { theme: "midnight", maxRadius: 50 });
  if (rebuilt.removed !== 1) problems.push(`building the bubbles again removed ${rebuilt.removed} of the old layer`);

  // The legend: a precomp of its own in the scene, which building it again replaces.
  const legend = await addLegend(map.id, fill, { theme: "midnight", corner: "bottomRight", sizes: bubbles.set.legend.map((step) => ({ radius: step.radius, label: step.label })) });
  if (legend.rows !== colours.legend.length + bubbles.set.legend.length) problems.push(`the legend has ${legend.rows} rows`);
  const built = JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, out = null;
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "legend") continue;
        var inside = [], comp = layer.source;
        for (var j = 1; j <= comp.numLayers; j++) inside.push(comp.layer(j).name);
        var position = layer.property("ADBE Transform Group").property("ADBE Position").value;
        out = { name: layer.name, width: comp.width, height: comp.height, x: position[0], y: position[1], layers: inside, scene: scene.width + "x" + scene.height };
      }
      return LML.json.stringify(out);
    })()`)
  ) as { name: string; width: number; height: number; x: number; y: number; layers: string[]; scene: string } | null;
  if (!built) problems.push("no legend layer is in the scene");
  else {
    if (built.name !== `Legend: ${fill.column}`) problems.push(`the legend layer is called "${built.name}"`);
    if (built.layers[0] !== "Title" || built.layers[built.layers.length - 1] !== "Background") problems.push(`the legend holds ${JSON.stringify(built.layers)}`);
    if (built.layers.length !== colours.legend.length + bubbles.set.legend.length + 3) problems.push(`the legend comp has ${built.layers.length} layers`);
    // Bottom right, inside the frame.
    if (built.x + built.width > SIZE.width || built.y + built.height > SIZE.height || built.x < SIZE.width / 2) problems.push(`the legend sits at ${built.x}, ${built.y} (${built.width} x ${built.height}) in ${built.scene}`);
  }
  // What the scene itself looks like with the numbers and the legend on it.
  if (!(await saveSceneFrame(map.id, "dt1-legend"))) problems.push("After Effects did not save the frame of the scene");

  const gonebubbles = await removeBubbles(map.id);
  if (gonebubbles.removed !== 1) problems.push(`removing the bubbles removed ${gonebubbles.removed}`);

  const again = await addLegend(map.id, fill, { theme: "midnight", corner: "topLeft" });
  if (again.removed !== 1) problems.push(`building the legend again removed ${again.removed} of the old one`);
  const gone = await removeLegend(map.id);
  if (gone.removed !== 1) problems.push(`removing the legend removed ${gone.removed}`);

  // The states of one country: names and postal codes, joined against that country's provinces.
  const states = [
    { key: "California", value: 39 },
    { key: "TX", value: 30 },
    { key: "US-NY", value: 19 },
    { key: "Atlantis", value: 1 }
  ];
  const byState = joinValues(states, buildLookup(provinceJoinTargets("USA")));
  if (byState.matched.length !== 3) problems.push(`${byState.matched.length} of 3 states joined: ${JSON.stringify(byState)}`);
  const stateFill: DataFill = {
    ...DEFAULT_DATA_FILL,
    column: "People (millions)",
    level: "province",
    country: "USA",
    values: Object.fromEntries(byState.matched.map((row) => [row.code, row.value])),
    steps: 3,
    opacity: 1
  };
  const usa: View = { center: { lat: 39, lng: -96 }, zoom: 3, bearing: 0, pitch: 0 };
  const stateMap = await createMapComp({ name: "DT1 states", ...SIZE, duration: 1, frameRate: 25, view: usa, newScene: true });
  const stateRender = await runRenderJob({ mapId: stateMap.id, quality: "final", settings, basemap: { kind: "world" }, dataFill: stateFill });
  const stateSequence = stateRender.sequences.find((s) => s.pass === "highlight-DATA");
  if (!stateSequence) {
    problems.push("the states did not render");
  } else {
    const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(stateSequence.folder, sequenceFileName(0))))).rgba;
    const at = (place: { lat: number; lng: number }) => {
      const p = project(usa, SIZE, place);
      const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    };
    const sacramento = at({ lat: 38.6, lng: -121.5 });
    const austin = at({ lat: 30.3, lng: -97.7 });
    const denver = at({ lat: 39.7, lng: -105 });
    if (sacramento[3] < 200 || austin[3] < 200) problems.push(`a state with a number is not filled: California ${sacramento}, Texas ${austin}`);
    if (denver[3] !== 0) problems.push(`Colorado has no number but is filled: ${denver}`);
    if (sacramento.join() === austin.join()) problems.push(`39 and 30 million got the same colour ${sacramento}`);
  }
  await addLegend(stateMap.id, stateFill, { theme: "midnight", corner: "bottomLeft" });
  await saveSceneFrame(stateMap.id, "dt1-states");

  const passed = problems.length === 0;
  log(
    `DT1 data on the map: ${joined.matched.length} of ${values.length} rows joined (${codes.join(", ")}), ${colours.legend.length} steps, rendered as "${dataLayer?.name ?? "-"}", ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, bubbleOffset: Math.round(bubbleOffset * 1000) / 1000, states: byState.matched.length, joined: joined.matched.length, unmatched: joined.unmatched.length, codes, legend: colours.legend.map((step) => step.label), layer: dataLayer?.name ?? null, legendComp: built ? `${built.width}x${built.height} at ${built.x}, ${built.y}` : null, problems };
}
