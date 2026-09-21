// ST1: the layers the panel generates take their colours from the map's look, a map can override
// them, and a style can be picked up from a layer the user styled themselves.

import type { View } from "../core/camera/camera.ts";
import { resolveLayerStyle, styleRgb } from "../core/style/layerStyle.ts";
import { themeById } from "../core/style/themes.ts";
import { callHost, evalScript } from "./cep.ts";
import { addPin, createMapComp } from "./mapApi.ts";
import { addCallout, addRouteLine } from "./overlays/routeCallout.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

type LayerColours = { name: string; fill: number[] | null; stroke: number[] | null; width: number; glow: boolean };

/** The colours and stroke widths of the tagged layers of one kind, read from After Effects. */
async function layerColours(mapId: string, kind: string): Promise<LayerColours[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || tag.kind !== ${JSON.stringify(kind)}) continue;
        var found = { name: layer.name, fill: null, stroke: null, width: 0, glow: false };
        var vectors = layer.property("ADBE Root Vectors Group");
        if (vectors) {
          for (var g = 1; g <= vectors.numProperties; g++) {
            var group = vectors.property(g);
            if (group.matchName !== "ADBE Vector Group") continue;
            var contents = group.property("ADBE Vectors Group");
            for (var c = 1; c <= contents.numProperties; c++) {
              var item = contents.property(c);
              if (item.matchName === "ADBE Vector Graphic - Fill" && !found.fill) found.fill = item.property("ADBE Vector Fill Color").value;
              if (item.matchName === "ADBE Vector Graphic - Stroke" && !found.stroke) {
                found.stroke = item.property("ADBE Vector Stroke Color").value;
                found.width = item.property("ADBE Vector Stroke Width").value;
              }
            }
          }
        }
        var parade = layer.property("ADBE Effect Parade");
        for (var e = 1; e <= parade.numProperties; e++) if (parade.property(e).matchName === "ADBE Glo2") found.glow = true;
        out.push(found);
      }
      return LML.json.stringify(out);
    })()`)
  ) as LayerColours[];
}

const near = (got: number[] | null, want: number[], tolerance = 1 / 255) => !!got && want.every((v, i) => Math.abs(got[i] - v) <= tolerance);

export async function runStyleTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 48.86, lng: 2.33 }, zoom: 9, bearing: 0, pitch: 0 };

  // A light look: its accent is ink, and its layers do not glow.
  const paperStyle = resolveLayerStyle(themeById("paper"));
  const map = await createMapComp({ name: "ST1 style", ...SIZE, duration: 2, frameRate: 25, view, newScene: true });
  await callHost("setMapSettings", { mapId: map.id, theme: "paper" });
  const scale = SIZE.height / 1080;

  await addPin(map.id, { lat: 48.87, lng: 2.3 }, { name: "Styled", style: { color: styleRgb(paperStyle.accent) } });
  await addRouteLine(
    map.id,
    [
      { lat: 48.8, lng: 2.2 },
      { lat: 48.9, lng: 2.5 }
    ],
    { name: "Styled route", startFrame: 0, endFrame: 25, style: paperStyle }
  );
  await addCallout(map.id, { lat: 48.85, lng: 2.4 }, "Paris", "France", { inFrame: 0, outFrame: 40, style: paperStyle });

  const accent = styleRgb(paperStyle.accent);
  const pins = await layerColours(map.id, "pin");
  if (!pins.length || !near(pins[0].fill, accent)) problems.push(`the pin is ${JSON.stringify(pins[0]?.fill)}, the accent is ${accent}`);
  const routes = await layerColours(map.id, "route");
  if (!routes.length || !near(routes[0].stroke, accent)) problems.push(`the route is ${JSON.stringify(routes[0]?.stroke)}`);
  if (routes.length && Math.abs(routes[0].width - paperStyle.stroke * scale) > 0.01) problems.push(`the route is ${routes[0].width} px wide, expected ${paperStyle.stroke * scale}`);
  if (routes.length && routes[0].glow) problems.push("a light look should not glow");
  const callout = await layerColours(map.id, "callout");
  const leader = callout.find((l) => l.name.includes("leader"));
  const box = callout.find((l) => l.name.includes("box"));
  if (!leader || !near(leader.stroke, accent)) problems.push(`the callout leader is ${JSON.stringify(leader?.stroke)}`);
  if (!box || !near(box.fill, styleRgb(paperStyle.panel))) problems.push(`the callout box is ${JSON.stringify(box?.fill)}, expected ${styleRgb(paperStyle.panel)}`);

  // A dark look glows, and its accent differs.
  const midnight = resolveLayerStyle(themeById("midnight"));
  if (!midnight.glow || midnight.accent === paperStyle.accent) problems.push(`the looks share a style: ${midnight.accent} ${paperStyle.accent}`);
  await addRouteLine(
    map.id,
    [
      { lat: 48.7, lng: 2.1 },
      { lat: 48.95, lng: 2.6 }
    ],
    { name: "Midnight route", startFrame: 0, endFrame: 25, style: midnight }
  );
  const glowing = (await layerColours(map.id, "route")).find((l) => l.name.includes("Midnight"));
  if (!glowing?.glow || !near(glowing.stroke, styleRgb(midnight.accent))) problems.push(`the dark route is ${JSON.stringify(glowing?.stroke)}, glow ${glowing?.glow}`);

  // A style picked up from a layer the user styled: a green shape with a 6 px stroke.
  await evalScript(`(function () {
    var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp;
    var layer = scene.layers.addShape();
    layer.name = "My styled layer";
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    contents.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([100, 100]);
    contents.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.2, 0.8, 0.4]);
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
    stroke.property("ADBE Vector Stroke Width").setValue(6);
    for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = scene.layer(i).name === "My styled layer";
    return "1";
  })()`);
  const picked = await callHost<{ accent: string; stroke: number | null; from: string }>("readLayerStyle", { mapId: map.id });
  // Six pixels in a 720-line comp are nine in the 1080 lines the panel stores.
  if (picked.accent !== "#33cc66" || picked.stroke !== 9 || picked.from !== "My styled layer") problems.push(`picked up ${JSON.stringify(picked)}`);

  const passed = problems.length === 0;
  log(`ST1 layer styles: paper ${paperStyle.accent} without glow, midnight ${midnight.accent} with glow, picked up ${picked.accent} at ${picked.stroke} px, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, paper: paperStyle, midnight, picked, problems };
}
