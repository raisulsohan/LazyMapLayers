// LD2: a picture per place in a label design of the user's own.
//
// A design comp with the place's name and a solid named {flag}. A folder holds flags made for the
// test, named three different ways (by the three-letter code, by the two-letter code, by the name).
// Auto labels puts the right flag in every country's copy, fitted into the placeholder's box and
// keeping its shape; a country with no flag in the folder has the layer switched off; the pictures
// are imported once however many labels show them.

import type { View } from "../core/camera/camera.ts";
import { encodePng } from "../core/image/png.ts";
import { evalScript, fs, path } from "./cep.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { labelDesigns } from "./labels/labelDesigns.ts";
import { createMapComp } from "./mapApi.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

/** A 300 x 200 flag of one colour. */
function flag(r: number, g: number, b: number): Uint8Array {
  const rgba = new Uint8Array(300 * 200 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return encodePng(rgba, 300, 200);
}

export async function runLabelImageTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const folder = path().join(spikeDir(), "LD2 flags");
  fs().rmSync(folder, { recursive: true, force: true });
  fs().mkdirSync(folder, { recursive: true });
  fs().writeFileSync(path().join(folder, "BGD.png"), flag(0, 106, 78));
  fs().writeFileSync(path().join(folder, "in.png"), flag(255, 153, 51));
  fs().writeFileSync(path().join(folder, "Nepal flag.png"), flag(220, 20, 60));

  const view: View = { center: { lat: 25.5, lng: 86 }, zoom: 4.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "LD2 label pictures", ...SIZE, duration: 2, frameRate: 25, view, newScene: true });
  await evalScript(`(function () {
    var design = app.project.items.addComp("Flag label", 200, 120, 1, 2, 25);
    var placeholder = design.layers.addSolid([0.5, 0.5, 0.5], "{flag}", 100, 60, 1);
    placeholder.property("ADBE Transform Group").property("ADBE Position").setValue([100, 40]);
    var title = design.layers.addText("{name}");
    title.property("ADBE Transform Group").property("ADBE Position").setValue([100, 100]);
    return "1";
  })()`);
  const designs = await labelDesigns();
  const mine = designs.find((design) => design.name === "Flag label");
  check(!!mine, `the design was not listed: ${designs.map((d) => d.name).join(", ")}`);
  check(!!mine && (mine.images ?? []).join() === "flag", `the design's picture fields are ${JSON.stringify(mine?.images)}`);

  let copies: { place: string; enabled: boolean; file: string; scale: number[] }[] = [];
  let footage = 0;
  let built: Awaited<ReturnType<typeof autoLabels>> | null = null;
  if (mine) {
    built = await autoLabels(map.id, { theme: "paper", maxLabels: 12, countries: true, places: false, water: false, land: false, design: mine, designImages: { flag: folder } });
    const read = JSON.parse(
      await evalScript(`(function () {
        var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, out = [], files = 0;
        for (var i = 1; i <= scene.numLayers; i++) {
          var layer = scene.layer(i), tag = LML.tag.read(layer);
          if (!tag || tag.kind !== "label" || tag.part !== "design") continue;
          var comp = layer.source;
          for (var l = 1; l <= comp.numLayers; l++) {
            var inner = comp.layer(l);
            if (inner.name !== "{flag}") continue;
            var file = inner.source && inner.source.mainSource && inner.source.mainSource.file ? inner.source.mainSource.file.name : "";
            out.push({ place: tag.labelId, enabled: inner.enabled, file: file, scale: inner.property("ADBE Transform Group").property("ADBE Scale").value });
          }
        }
        for (var j = 1; j <= app.project.numItems; j++) {
          var item = app.project.item(j);
          if (item instanceof FootageItem && item.mainSource && item.mainSource.file && item.mainSource.file.fsName.indexOf("LD2 flags") >= 0) files++;
        }
        return LML.json.stringify({ out: out, files: files });
      })()`)
    ) as { out: typeof copies; files: number };
    copies = read.out;
    footage = read.files;
    const of = (code: string) => copies.find((c) => c.place.startsWith(`country:${code}:`));
    const bd = of("BGD");
    const ind = of("IND");
    const npl = of("NPL");
    check(!!bd && bd.enabled && bd.file === "BGD.png", `Bangladesh wears ${bd ? bd.file || "nothing" : "no label"}`);
    check(!!ind && ind.enabled && ind.file.toLowerCase() === "in.png", `India wears ${ind ? ind.file || "nothing" : "no label"}`);
    check(!!npl && npl.enabled && decodeURIComponent(npl.file) === "Nepal flag.png", `Nepal wears ${npl ? npl.file || "nothing" : "no label"}`);
    // 300 x 200 in a 100 x 60 box: 60 / 200 = 30 %.
    check(!!bd && Math.abs(bd.scale[0] - 30) < 0.01 && Math.abs(bd.scale[1] - 30) < 0.01, `the flag is scaled ${bd ? bd.scale.join(" x ") : "?"}, not 30 %`);
    const without = copies.filter((c) => !["BGD", "IND", "NPL"].some((code) => c.place.startsWith(`country:${code}:`)));
    check(without.length > 0 && without.every((c) => !c.enabled), `countries without a flag keep the placeholder on: ${without.filter((c) => c.enabled).map((c) => c.place).join(", ")}`);
    check(footage === 3, `${footage} footage items for three flags`);
  }
  // The flags stay: the project still shows them, and deleting them would leave it missing files.
  const passed = problems.length === 0;
  log(`LD2 label pictures: ${copies.length} labels, ${copies.filter((c) => c.enabled).length} with a flag, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, copies, built: built ? { planned: built.planned, labels: built.labels, layers: built.layers, errors: built.expressionErrors } : null };
}
