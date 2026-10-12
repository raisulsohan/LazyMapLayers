// AR1: the arrow rig in After Effects. A route is added as an arrow together with a traveller on the
// same keys; After Effects' own results must put the arrow's head where the traveller is (RT1 checks the
// traveller against core maths), turned the same way, with the line stopping just behind it. Then the
// controls are changed on the layer - both ends, no head, dashes that flow - and the layer follows.

import { fitPoints } from "../core/camera/fit.ts";
import { ARROW_EFFECTS, HEAD_STYLES } from "../core/ae/arrowRig.ts";
import { evalScript, fs, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { addRoute } from "./overlays/routeCallout.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

type Sample = { head: number[]; headR: number; headO: number; tailO: number; traveller: number[]; travellerR: number; start: number; end: number; progress: number };

export async function runArrowTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const size = { width: 1920, height: 1080 };
  const from = { lat: 23.81, lng: 90.41 };
  const to = { lat: 22.36, lng: 91.83 };
  const view = fitPoints([from, to], size, { bearing: 20, pitch: 30, padding: 0.2 });
  const map = await createMapComp({ name: "AR1 arrow", ...size, duration: 8, frameRate: 25, view, newScene: true });
  const made = await addRoute(map.id, from, to, { name: "AR1 Dhaka to Chattogram", startFrame: 25, endFrame: 175, rig: true, traveller: true });
  if (made.expressionErrors.length) problems.push(`expression errors: ${made.expressionErrors.slice(0, 3).join("; ")}`);
  if (made.warnings?.length) problems.push(`warnings: ${made.warnings.join("; ")}`);

  // Reads the arrow and the traveller at some times, after optional changes to the arrow's controls.
  const read = (times: number[], set: Record<string, number> = {}) =>
    host<{ effects: string[]; groups: string[]; menu: string; taper: number[]; dash: number[]; errors: string[]; samples: Sample[]; offset: number }>(`
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
    var scene = mapLayer.containingComp, arrow = null, traveller = null;
    for (var i = 1; i <= scene.numLayers; i++) {
      var t = LML.tag.read(scene.layer(i));
      if (!t) continue;
      if (t.kind === "route") arrow = scene.layer(i);
      if (t.kind === "traveller") traveller = scene.layer(i);
    }
    var fx = arrow.property("ADBE Effect Parade");
    var set = ${JSON.stringify(set)};
    for (var name in set) fx.property(name).property(1).setValue(set[name]);
    var out = { effects: [], groups: [], menu: "", taper: [], dash: [], errors: [], samples: [], offset: 0 };
    for (var e = 1; e <= fx.numProperties; e++) out.effects.push(fx.property(e).name);
    var root = arrow.property("ADBE Root Vectors Group");
    for (var g = 1; g <= root.numProperties; g++) out.groups.push(root.property(g).name);
    var line = root.property("Line").property("ADBE Vectors Group");
    var stroke = line.property("Line");
    var taper = LML.overlays.childOf(stroke, "ADBE Vector Stroke Taper", /taper/i);
    if (taper) out.taper = [LML.overlays.childOf(taper, "ADBE Vector Taper Start Width", /start ?width/i).value, LML.overlays.childOf(taper, "ADBE Vector Taper Start Length", /start ?length/i).value];
    var dashes = stroke.property("ADBE Vector Stroke Dashes");
    out.dash = [dashes.property("ADBE Vector Stroke Dash 1").value, dashes.property("ADBE Vector Stroke Gap 1").value];
    out.offset = LML.overlays.childOf(dashes, "ADBE Vector Stroke Offset", /offset/i).valueAtTime(2, false);
    var trim = line.property("ADBE Vector Filter - Trim");
    var head = root.property("Head").property("ADBE Vector Transform Group");
    var tail = root.property("Tail Head").property("ADBE Vector Transform Group");
    var props = [trim.property("ADBE Vector Trim Start"), trim.property("ADBE Vector Trim End"), head.property("ADBE Vector Position"), head.property("ADBE Vector Rotation"), head.property("ADBE Vector Group Opacity"), tail.property("ADBE Vector Group Opacity"), line.property("ADBE Vector Shape - Group").property("ADBE Vector Shape")];
    for (var k = 0; k < props.length; k++) if (props[k].expressionError) out.errors.push(props[k].name + ": " + props[k].expressionError);
    var times = ${JSON.stringify(times)};
    for (var s = 0; s < times.length; s++) {
      var at = times[s];
      var hp = head.property("ADBE Vector Position").valueAtTime(at, false);
      var lp = arrow.property("ADBE Transform Group").property("ADBE Position").valueAtTime(at, false);
      var lap = arrow.property("ADBE Transform Group").property("ADBE Anchor Point").valueAtTime(at, false);
      var tr = traveller.property("ADBE Transform Group");
      out.samples.push({
        head: [lp[0] - lap[0] + hp[0], lp[1] - lap[1] + hp[1]],
        headR: head.property("ADBE Vector Rotation").valueAtTime(at, false),
        headO: head.property("ADBE Vector Group Opacity").valueAtTime(at, false),
        tailO: tail.property("ADBE Vector Group Opacity").valueAtTime(at, false),
        traveller: tr.property("ADBE Position").valueAtTime(at, false),
        travellerR: tr.property("ADBE Rotate Z").valueAtTime(at, false),
        start: trim.property("ADBE Vector Trim Start").valueAtTime(at, false),
        end: trim.property("ADBE Vector Trim End").valueAtTime(at, false),
        progress: fx.property("Progress").property(1).valueAtTime(at, false)
      });
    }
    var menu = fx.property("Head Style").property(1);
    try { out.menu = menu.value + ""; } catch (err) { out.menu = "?"; }
    return LML.json.stringify(out);`);

  const first = await read([0.5, 2, 4, 7]);
  if (first.errors.length) problems.push(`After Effects reports: ${first.errors.join("; ")}`);
  const wantEffects = ["Map", ...Object.values(ARROW_EFFECTS).filter((n) => n !== "Map")];
  // A look with a glow adds the Glow effect after the controls.
  if (first.effects.filter((n) => n !== "Glow").join("|") !== wantEffects.join("|")) problems.push(`controls: ${first.effects.join(", ")}`);
  if (first.groups.join("|") !== "Head|Tail Head|Line") problems.push(`groups: ${first.groups.join(", ")}`);
  if (first.menu !== "1") problems.push(`Head Style is ${first.menu}, not ${HEAD_STYLES[0]}`);
  if (first.taper.length !== 2 || first.taper[0] !== 35 || first.taper[1] !== 100) problems.push(`taper ${JSON.stringify(first.taper)}`);
  if (first.dash[1] !== 0 || first.dash[0] < 1000) problems.push(`a solid line has dash ${first.dash[0]} and gap ${first.dash[1]}`);
  let worst = 0;
  for (const s of first.samples.slice(1)) {
    const off = Math.hypot(s.head[0] - s.traveller[0], s.head[1] - s.traveller[1]);
    worst = Math.max(worst, off);
    if (off > 0.05) problems.push(`at progress ${s.progress.toFixed(1)} the head is ${off.toFixed(3)} px from the traveller`);
    const turn = Math.abs(((((s.headR - s.travellerR) % 360) + 540) % 360) - 180);
    if (turn > 0.05) problems.push(`at progress ${s.progress.toFixed(1)} the head turns ${s.headR.toFixed(2)}, the traveller ${s.travellerR.toFixed(2)}`);
    if (s.start !== 0) problems.push(`trim start ${s.start}`);
  }
  const [before, , middle, done] = first.samples;
  if (before.progress !== 0 || before.headO !== 0 || before.end !== 0) problems.push(`before it starts: progress ${before.progress}, head ${before.headO}, line to ${before.end}`);
  if (middle.headO !== 100 || middle.tailO !== 0) problems.push(`halfway: head ${middle.headO}, tail head ${middle.tailO}`);
  if (!(done.end > 97 && done.end < 100)) problems.push(`at the end the line runs to ${done.end} %, not just behind the head`);

  // The controls on the layer: both ends, no head, and dashes that flow.
  const both = (await read([7], { [ARROW_EFFECTS.bothEnds]: 1 })).samples[0];
  if (both.tailO !== 100 || !(both.start > 0 && both.start < 3)) problems.push(`both ends: tail head ${both.tailO}, line from ${both.start} %`);
  const none = (await read([7], { [ARROW_EFFECTS.headStyle]: 3, [ARROW_EFFECTS.bothEnds]: 0 })).samples[0];
  if (none.headO !== 0 || none.end !== 100) problems.push(`no head: head ${none.headO}, line to ${none.end} %`);
  const dashed = await read([7], { [ARROW_EFFECTS.headStyle]: 1, [ARROW_EFFECTS.dash]: 12, [ARROW_EFFECTS.gap]: 8, [ARROW_EFFECTS.dashSpeed]: 30 });
  if (dashed.dash[0] !== 12 || dashed.dash[1] !== 8 || dashed.offset !== -60) problems.push(`dashes ${JSON.stringify(dashed.dash)}, offset at 2 s ${dashed.offset}`);

  // Two frames to look at: the arrow halfway with its dashes flowing, and at the end with both heads.
  const frames: string[] = [];
  const dir = path().join(spikeDir(), "frames");
  fs().mkdirSync(dir, { recursive: true });
  for (const [at, name] of [
    [4, "ar1-halfway.png"],
    [7, "ar1-end.png"]
  ] as [number, string][]) {
    const file = path().join(dir, name);
    try {
      fs().rmSync(file, { force: true });
      await host(`
        var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
        mapLayer.containingComp.saveFrameToPng(${at}, new File(${JSON.stringify(file)}));
        return "{}";`);
      for (let wait = 0; wait < 50 && !fs().existsSync(file); wait++) await new Promise((r) => setTimeout(r, 100));
      if (fs().existsSync(file)) frames.push(file);
    } catch {
      // A frame to look at is a convenience, not a check.
    }
  }

  const passed = problems.length === 0;
  log(`AR1 arrow rig: head ${worst.toFixed(4)} px from the traveller, ${first.effects.length - 1} controls, taper ${first.taper.join("/")}, ${frames.length} frames saved, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`AR1: ${problem}`, "fail");
  return { passed, worst, problems, frames, samples: first.samples };
}
