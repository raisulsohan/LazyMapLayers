// FL1: flows. A table of "from, to, how much" becomes arcs between the places whose widths follow
// the amounts, with an arrow riding each one, and a place the search does not know is reported
// rather than guessed.

import type { View } from "../core/camera/camera.ts";
import { readDataTable } from "../core/data/dataTable.ts";
import { flowRows, guessFlowColumns } from "../core/data/flows.ts";
import { evalScript, fs, path } from "./cep.ts";
import { placeIndex } from "./data/worldLabels.ts";
import { createMapComp } from "./mapApi.ts";
import { addFlows } from "./overlays/flows.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

export async function runFlowTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 23.6, lng: 90.3 }, zoom: 6.2, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "FL1 flows", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });

  const table = readDataTable(
    [
      ["Origin", "Destination", "Passengers"],
      ["Dhaka", "Chittagong", "1,200"],
      ["Dhaka", "Sylhet", "300"],
      ["Dhaka", "Rajshahi", "600"],
      ["Chittagong", "Atlantis", "100"],
      ["23.8, 90.4", "22.36, 91.78", "150"]
    ],
    "flights.csv"
  )!;
  const columns = guessFlowColumns(table)!;
  if (!columns || columns.from !== 0 || columns.to !== 1 || columns.value !== 2) problems.push(`the columns were guessed as ${JSON.stringify(columns)}`);
  const rows = flowRows(table, 0, 1, 2);
  const made = await addFlows(map.id, placeIndex(), rows, { startFrame: 0, endFrame: 50, theme: "midnight", maxWidth: 14, arrows: true });
  if (made.expressionErrors.length) problems.push(`flow expressions: ${made.expressionErrors.slice(0, 2).join("; ")}`);
  // Four flows have two known places (one of them written as coordinates); Atlantis is nowhere.
  if (made.drawn !== 4) problems.push(`${made.drawn} flows were drawn`);
  if (made.unknown.join() !== "Atlantis") problems.push(`unknown places: ${JSON.stringify(made.unknown)}`);
  if (made.layers !== 8) problems.push(`${made.layers} layers were made for 4 flows with arrows`);

  // Three more flows in step colours: each amount lands in its own step of a three-step ramp.
  const coloured = await addFlows(
    map.id,
    placeIndex(),
    [
      { from: "Sylhet", to: "Khulna", value: 100, row: 1 },
      { from: "Sylhet", to: "Rangpur", value: 500, row: 2 },
      { from: "Sylhet", to: "Barisal", value: 1000, row: 3 }
    ],
    { startFrame: 0, endFrame: 50, theme: "midnight", maxWidth: 8, byColour: true, ramp: "warm", steps: 3, method: "equal" }
  );
  if (coloured.expressionErrors.length) problems.push(`coloured flow expressions: ${coloured.expressionErrors.slice(0, 2).join("; ")}`);
  if (coloured.drawn !== 3 || coloured.layers !== 3) problems.push(`${coloured.drawn} coloured flows were drawn as ${coloured.layers} layers`);

  const layers = JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || (tag.kind !== "route" && tag.kind !== "traveller")) continue;
        var width = null, color = null;
        try {
          var stroke = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Graphic - Stroke");
          width = stroke.property("ADBE Vector Stroke Width").value;
          var rgb = stroke.property("ADBE Vector Stroke Color").value;
          color = [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)].join(",");
        } catch (e) { width = null; }
        out.push({ name: layer.name, kind: tag.kind, width: width, color: color });
      }
      return LML.json.stringify(out);
    })()`)
  ) as { name: string; kind: string; width: number | null; color: string | null }[];
  const routes = layers.filter((layer) => layer.kind === "route" && !layer.name.includes("Sylhet to"));
  const steps = layers.filter((layer) => layer.kind === "route" && layer.name.includes("Sylhet to"));
  const travellers = layers.filter((layer) => layer.kind === "traveller");
  if (routes.length !== 4 || steps.length !== 3 || travellers.length !== 4) problems.push(`the scene holds ${routes.length} routes, ${steps.length} coloured routes and ${travellers.length} travellers`);
  // The plain flows share the look's accent; the coloured ones each wear their own step.
  if (new Set(routes.map((layer) => layer.color)).size !== 1) problems.push(`the plain flows wear ${routes.map((layer) => layer.color).join(" / ")}`);
  if (new Set(steps.map((layer) => layer.color)).size !== 3) problems.push(`the coloured flows wear ${steps.map((layer) => layer.color).join(" / ")}`);
  if (steps.some((layer) => routes[0] && layer.color === routes[0].color)) problems.push("a coloured flow wears the accent colour");
  const widthOf = (part: string) => routes.find((layer) => layer.name.includes(part))?.width ?? null;
  const biggest = widthOf("Dhaka to Chittagong");
  const middle = widthOf("Dhaka to Rajshahi");
  const small = widthOf("Dhaka to Sylhet");
  const scale = SIZE.height / 1080;
  if (biggest === null || Math.abs(biggest - 14 * scale) > 0.05) problems.push(`the widest flow is ${biggest} px, expected ${14 * scale}`);
  if (middle === null || biggest === null || Math.abs(middle / biggest - 0.5) > 0.02) problems.push(`600 against 1,200 gives widths ${middle} and ${biggest}`);
  if (small === null || biggest === null || Math.abs(small / biggest - 0.25) > 0.02) problems.push(`300 against 1,200 gives widths ${small} and ${biggest}`);

  // A frame of the scene, for looking at afterwards.
  const shot = path().join(spikeDir(), "fl1-flows.png").split(String.fromCharCode(92)).join("/");
  fs().rmSync(shot, { force: true });
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.saveFrameToPng(1.6, new File(${JSON.stringify(shot)})); return "1"; })()`);
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
    `FL1 flows: ${made.drawn} arcs from ${rows.length} rows (${made.unknown.length} place unknown), widths ${routes.map((layer) => (layer.width ?? 0).toFixed(1)).join("/")} px, ${travellers.length} arrows, ${steps.length} in step colours, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, drawn: made.drawn, unknown: made.unknown, widths: routes.map((layer) => ({ name: layer.name, width: layer.width })), legend: made.legend.map((step) => step.label), problems };
}
