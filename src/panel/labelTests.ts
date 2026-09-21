// LB2: the label template. Names take their size, colour, halo, capitals, dots and font from the
// template the map carries, and a template can be picked up from a text layer the user styled.

import type { View } from "../core/camera/camera.ts";
import { KEEP_OUT_PRESETS, normaliseKeepOut, zoneBoxes, type KeepOutZone } from "../core/labels/keepOut.ts";
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

// LB3: keep-out zones. Names stay out of the parts of the frame the user blocked, for as long as
// they are blocked, and the bounds of a layer the user made become a zone of their own.

type LabelBox = { name: string; left: number; top: number; right: number; bottom: number };

/** The bounds of every label that is actually visible at `time`, in comp pixels. */
async function visibleLabels(mapId: string, time: number): Promise<LabelBox[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [], t = ${time};
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "label" || !layer.sourceRectAtTime) continue;
        if (layer.property("ADBE Transform Group").property("ADBE Opacity").valueAtTime(t, false) < 1) continue;
        var rect = layer.sourceRectAtTime(t, false);
        if (!rect || rect.width <= 0) continue;
        var corners = [[rect.left, rect.top], [rect.left + rect.width, rect.top], [rect.left, rect.top + rect.height], [rect.left + rect.width, rect.top + rect.height]];
        var left = null, top = null, right = null, bottom = null;
        for (var c = 0; c < corners.length; c++) {
          var p = LML.style.throughTransform(corners[c], layer, t);
          if (left === null || p[0] < left) left = p[0];
          if (right === null || p[0] > right) right = p[0];
          if (top === null || p[1] < top) top = p[1];
          if (bottom === null || p[1] > bottom) bottom = p[1];
        }
        out.push({ name: layer.name, left: left, top: top, right: right, bottom: bottom });
      }
      return LML.json.stringify(out);
    })()`)
  ) as LabelBox[];
}

const inBox = (labels: LabelBox[], box: { x: number; y: number; width: number; height: number }) =>
  labels.filter((label) => label.left < box.x + box.width && box.x < label.right && label.top < box.y + box.height && box.y < label.bottom);

export async function runKeepOutTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 46, lng: 10 }, zoom: 4.2, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "LB3 zones", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });
  const lowerThird = KEEP_OUT_PRESETS.find((preset) => preset.id === "lower-third")!;
  const topBar = KEEP_OUT_PRESETS.find((preset) => preset.id === "top-bar")!;
  const zones: KeepOutZone[] = [
    { ...lowerThird, from: null, to: null },
    // The top bar is only blocked while a title would be on screen.
    { ...topBar, from: 1, to: 2 }
  ];
  const boxes = zoneBoxes(zones, SIZE, 25, 100);
  const lowerBox = boxes[0].box;
  const topBox = boxes[1].box;
  const middle = 1.48;
  const early = 0.2;

  // Without zones the names use the whole frame.
  await autoLabels(map.id, { maxLabels: 40, theme: "paper", countries: true, places: true });
  const free = await visibleLabels(map.id, middle);
  const freeLower = inBox(free, lowerBox).length;
  const freeTop = inBox(free, topBox).length;
  if (!free.length) problems.push("no labels were placed at all");
  if (!freeLower) problems.push("nothing was in the lower third to begin with, so the zone proves nothing");

  // With zones they keep away, and only while the zone holds.
  await autoLabels(map.id, { maxLabels: 40, theme: "paper", countries: true, places: true, zones });
  const kept = await visibleLabels(map.id, middle);
  const keptLower = inBox(kept, lowerBox);
  const keptTop = inBox(kept, topBox);
  if (!kept.length) problems.push("the zones left no labels at all");
  for (const label of keptLower.slice(0, 3)) problems.push(`"${label.name}" is in the lower third (top ${Math.round(label.top)})`);
  for (const label of keptTop.slice(0, 3)) problems.push(`"${label.name}" is in the top bar at ${middle} s (bottom ${Math.round(label.bottom)})`);
  const earlyTop = inBox(await visibleLabels(map.id, early), topBox).length;
  if (freeTop && !earlyTop) problems.push(`the top bar is blocked at ${early} s too, where the zone does not hold`);

  // A layer of the user's own becomes a zone: half the width, near the bottom, on screen 1 s to 2 s.
  await evalScript(`(function () {
    var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp;
    var layer = scene.layers.addSolid([0.9, 0.2, 0.2], "LB3 title bar", 960, 200, 1, scene.duration);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([960, 900]);
    layer.inPoint = 1;
    layer.outPoint = 2;
    for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = scene.layer(i).name === "LB3 title bar";
    return "1";
  })()`);
  const found = normaliseKeepOut(await callHost<KeepOutZone[]>("readLayerBounds", { mapId: map.id }));
  const zone = found[0];
  if (found.length !== 1 || !zone) {
    problems.push(`the selected layer gave ${found.length} zones`);
  } else {
    const want = { x: 0.25, y: 800 / 1080, width: 0.5, height: 200 / 1080 };
    for (const key of ["x", "y", "width", "height"] as const) {
      if (Math.abs(zone[key] - want[key]) > 0.002) problems.push(`the layer zone's ${key} is ${zone[key].toFixed(4)}, expected ${want[key].toFixed(4)}`);
    }
    if (zone.name !== "LB3 title bar") problems.push(`the layer zone is called "${zone.name}"`);
    if (zone.from !== 1 || zone.to !== 2) problems.push(`the layer zone holds ${zone.from} s to ${zone.to} s, expected 1 to 2`);
  }

  const passed = problems.length === 0;
  log(
    `LB3 keep-out: ${free.length} labels without zones (${freeLower} in the lower third, ${freeTop} in the top bar), ${kept.length} with them (${keptLower.length} and ${keptTop.length}), ${earlyTop} in the top bar where the zone does not hold, the selected layer gave ${found.length} zone, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, free: free.length, freeLower, freeTop, kept: kept.length, keptLower: keptLower.length, keptTop: keptTop.length, earlyTop, layerZone: zone ?? null, problems };
}
