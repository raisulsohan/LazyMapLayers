// LB2: the label template. Names take their size, colour, halo, capitals, dots and font from the
// template the map carries, and a template can be picked up from a text layer the user styled.

import type { View } from "../core/camera/camera.ts";
import { resolveLabelTemplate } from "../core/labels/labelTemplate.ts";
import { hexToRgb, themeById } from "../core/style/themes.ts";
import { callHost, evalScript } from "./cep.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { createMapComp } from "./mapApi.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1920, height: 1080 };

type TextLayerState = { name: string; text: string; font: string; size: number; fill: number[]; stroke: boolean; strokeWidth: number };

/** What the text layers of a map's labels really hold, and how many dots were made. */
async function labelLayers(mapId: string): Promise<{ texts: TextLayerState[]; dots: number }> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, texts = [], dots = 0;
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "label") continue;
        var properties = layer.property("ADBE Text Properties");
        if (!properties) {
          dots++;
          continue;
        }
        var doc = properties.property("ADBE Text Document").value;
        texts.push({
          name: layer.name,
          text: doc.text,
          font: doc.font,
          size: doc.fontSize,
          fill: doc.applyFill ? doc.fillColor : [0, 0, 0],
          stroke: doc.applyStroke === true,
          strokeWidth: doc.applyStroke ? doc.strokeWidth : 0
        });
      }
      return LML.json.stringify({ texts: texts, dots: dots });
    })()`)
  ) as { texts: TextLayerState[]; dots: number };
}

const near = (got: number[], want: number[], tolerance = 1 / 255) => want.every((v, i) => Math.abs(got[i] - v) <= tolerance);
/** A name written in capitals (only scripts that have them are turned). */
const isCaps = (text: string) => /[A-Z]/.test(text) && text === text.toLocaleUpperCase() && !/[a-z]/.test(text);
const mainNames = (texts: TextLayerState[]) => texts.filter((t) => !t.name.includes("(subtitle)"));

export async function runLabelTemplateTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const paper = themeById("paper");
  const view: View = { center: { lat: 48, lng: 12 }, zoom: 3.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "LB2 template", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });

  // The look decides by itself: a light look gives dark country names in capitals, with a halo.
  const fromLook = resolveLabelTemplate(paper);
  await autoLabels(map.id, { maxLabels: 20, theme: "paper", countries: true, places: false, template: fromLook });
  const plain = await labelLayers(map.id);
  const plainNames = mainNames(plain.texts);
  if (plainNames.length < 3) problems.push(`the look gave ${plainNames.length} country names`);
  for (const text of plainNames.slice(0, 4)) {
    if (!near(text.fill, hexToRgb(fromLook.countryColor))) problems.push(`"${text.text}" is ${JSON.stringify(text.fill)}, the look gives ${fromLook.countryColor}`);
    if (!text.stroke) problems.push(`"${text.text}" has no halo`);
    if (Math.abs(text.size - fromLook.countrySize) > 1.5) problems.push(`"${text.text}" is ${text.size} px, the look gives ${fromLook.countrySize}`);
  }
  const capsNames = plainNames.filter((t) => isCaps(t.text));
  if (capsNames.length < 2) problems.push(`only ${capsNames.length} of ${plainNames.length} country names are in capitals`);

  // A template of the user's own: bigger, pink, no halo, no capitals, no dots.
  const custom = resolveLabelTemplate(paper, { color: "#ff3399", countryColor: "#ff3399", haloColor: null, halo: 0, size: 40, caps: false, dots: false, font: null });
  await autoLabels(map.id, { maxLabels: 20, theme: "paper", countries: true, places: true, template: custom });
  const styled = await labelLayers(map.id);
  const styledNames = mainNames(styled.texts);
  if (!styledNames.length) problems.push("the template gave no names at all");
  const pink = hexToRgb("#ff3399");
  for (const text of styledNames.slice(0, 6)) {
    if (!near(text.fill, pink)) problems.push(`"${text.text}" is ${JSON.stringify(text.fill)}, expected the template's pink`);
    if (text.stroke) problems.push(`"${text.text}" still has a halo`);
    if (isCaps(text.text) && capsNames.some((c) => c.text === text.text)) problems.push(`"${text.text}" is still in capitals`);
  }
  const sizes = styledNames.map((t) => Math.round(t.size));
  if (!sizes.includes(40) && !sizes.includes(custom.countrySize)) problems.push(`the sizes are ${sizes.slice(0, 6).join(", ")}, expected 40 or ${custom.countrySize}`);
  if (styled.dots) problems.push(`${styled.dots} dots were made although the template has none`);
  // The English line under a name follows the template's colour, not the look's.
  const subtitle = styled.texts.find((t) => t.name.includes("(subtitle)"));
  if (subtitle && near(subtitle.fill, hexToRgb(fromLook.subtitleColor))) problems.push(`a subtitle kept the look's colour: ${JSON.stringify(subtitle.fill)}`);

  // The style of a text layer the user made: colour, size, halo and font.
  await evalScript(`(function () {
    var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp;
    var layer = scene.layers.addText("My title");
    layer.name = "My styled title";
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.fontSize = 64;
    doc.applyFill = true;
    doc.fillColor = [0.1, 0.6, 1];
    doc.applyStroke = true;
    doc.strokeColor = [1, 1, 1];
    doc.strokeWidth = 5;
    prop.setValue(doc);
    for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = scene.layer(i).name === "My styled title";
    return "1";
  })()`);
  const picked = await callHost<{ from: string; color: string | null; size: number; haloColor: string | null; halo: number; font: string | null }>("readLabelStyle", { mapId: map.id });
  if (picked.from !== "My styled title" || picked.color !== "#1a99ff" || picked.size !== 64 || picked.halo !== 5 || picked.haloColor !== "#ffffff" || !picked.font) {
    problems.push(`picked up ${JSON.stringify(picked)}`);
  }

  const passed = problems.length === 0;
  log(
    `LB2 label template: ${plainNames.length} names from the look (${capsNames.length} in capitals), ${styledNames.length} from a template (${styled.dots} dots), picked up ${picked.size} px ${picked.color} from a text layer, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, fromLook: plainNames.length, caps: capsNames.length, fromTemplate: styledNames.length, picked, problems };
}
