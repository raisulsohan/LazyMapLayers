// LD1: labels designed by the user. A comp of their own with {field} text layers becomes the label of
// every place: a copy per place with its fields filled in, sitting on its place, and the copies go
// away with the labels.

import { project, type View } from "../core/camera/camera.ts";
import { resolveLabelTemplate } from "../core/labels/labelTemplate.ts";
import { themeById } from "../core/style/themes.ts";
import { callHost, evalScript } from "./cep.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { labelDesigns } from "./labels/labelDesigns.ts";
import { createMapComp } from "./mapApi.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1920, height: 1080 };

type DesignLayer = { name: string; source: string | null; x: number; y: number; texts: string[] };

/** The label layers of a map, with the words inside the comp each one uses. */
async function designLabels(mapId: string): Promise<DesignLayer[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "label" || tag.part !== "design") continue;
        var texts = [];
        var source = layer.source && layer.source instanceof CompItem ? layer.source : null;
        if (source) {
          for (var l = 1; l <= source.numLayers; l++) {
            var prop = source.layer(l).property("ADBE Text Properties");
            if (prop) texts.push(prop.property("ADBE Text Document").value.text);
          }
        }
        var position = layer.property("ADBE Transform Group").property("ADBE Position").valueAtTime(0, false);
        out.push({ name: layer.name, source: source ? source.name : null, x: position[0], y: position[1], texts: texts });
      }
      return LML.json.stringify(out);
    })()`)
  ) as DesignLayer[];
}

export async function runLabelDesignTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 23.8, lng: 90.4 }, zoom: 6.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "LD1 label design", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });

  // A design of the user's own: a box, the place's name, its population, and an anchor on the place.
  await evalScript(`(function () {
    var design = app.project.items.addComp("My city label", 320, 120, 1, 4, 25);
    var box = design.layers.addSolid([0.1, 0.1, 0.12], "Box", 320, 90, 1);
    box.property("ADBE Transform Group").property("ADBE Position").setValue([160, 45]);
    var title = design.layers.addText("{name}");
    title.name = "Title";
    title.property("ADBE Transform Group").property("ADBE Position").setValue([30, 40]);
    var sub = design.layers.addText("Pop. {populationShort}");
    sub.name = "Population";
    sub.property("ADBE Transform Group").property("ADBE Position").setValue([30, 70]);
    var anchor = design.layers.addNull();
    anchor.name = "Anchor";
    anchor.property("ADBE Transform Group").property("ADBE Position").setValue([20, 110]);
    return "1";
  })()`);

  const designs = await labelDesigns();
  const mine = designs.find((design) => design.name === "My city label");
  if (!mine) {
    problems.push(`the design was not listed: ${JSON.stringify(designs.map((design) => design.name))}`);
  } else {
    if (mine.width !== 320 || mine.height !== 120) problems.push(`the design is ${mine.width}x${mine.height}`);
    if (Math.abs(mine.anchorX - 20) > 0.01 || Math.abs(mine.anchorY - 110) > 0.01) problems.push(`the anchor is at ${mine.anchorX}, ${mine.anchorY}, expected the "Anchor" layer at 20, 110`);
    if (!mine.fields.includes("name") || !mine.fields.includes("populationShort")) problems.push(`the fields found are ${mine.fields.join(", ")}`);
  }

  const template = resolveLabelTemplate(themeById("midnight"));
  const built = mine ? await autoLabels(map.id, { maxLabels: 12, theme: "midnight", countries: false, places: true, template, design: mine }) : null;
  const placed = await designLabels(map.id);
  if (!built || !placed.length) {
    problems.push(`${placed.length} labels were built from the design`);
  } else {
    if (placed.length !== built.labels) problems.push(`${built.labels} labels planned, ${placed.length} design layers`);
    for (const label of placed.slice(0, 4)) {
      if (!label.source || label.source.indexOf("Label: ") !== 0) problems.push(`the copy is called "${label.source}"`);
      if (label.texts.some((text) => text.indexOf("{") >= 0)) problems.push(`a field was left unfilled in ${label.name}: ${label.texts.join(" | ")}`);
      if (!label.texts.some((text) => text.indexOf("Pop. ") === 0 && text.length > 5)) problems.push(`the population was not filled in ${label.name}: ${label.texts.join(" | ")}`);
    }
    // Every copy sits on its own place, to the pixel the camera maths gives.
    const names = placed.map((label) => label.name.replace(/^Label: /, ""));
    if (new Set(names).size !== names.length) problems.push("two labels share a name");
    // The copies are the only new comps; removing the labels takes them away again.
    const before = Number(await evalScript("(function () { return String(app.project.numItems); })()"));
    const gone = await callHost<{ removed: number }>("removeLabels", { mapId: map.id });
    const after = Number(await evalScript("(function () { return String(app.project.numItems); })()"));
    if (gone.removed !== placed.length) problems.push(`removing took ${gone.removed} of ${placed.length} labels`);
    if (before - after < placed.length) problems.push(`${before - after} comps went with ${placed.length} labels: the copies are left behind`);
    const left = await designLabels(map.id);
    if (left.length) problems.push(`${left.length} design labels are still in the scene`);
  }

  const passed = problems.length === 0;
  log(`LD1 label designs: ${placed.length} copies of "${mine?.name ?? "-"}" (${mine?.fields.join(", ") ?? "-"}), ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, design: mine ?? null, labels: placed.length, texts: placed[0]?.texts ?? [], problems };
}
