// RT1: imported routes in After Effects. A GPX file is parsed in the panel, its track is drawn as a
// route layer with a traveller, and After Effects' own expression results are compared with core maths:
// the traveller must sit on the track's start, middle and end, face the direction of travel, and the
// route's path must hold the thinned points.

import { project, type View } from "../core/camera/camera.ts";
import { fitPoints } from "../core/camera/fit.ts";
import { simplifyLine } from "../core/geo/simplify.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings } from "../core/render/plan.ts";
import { evalScript, fs, path } from "./cep.ts";
import { hasImagery } from "./imagery/packs.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { importFile } from "./data/importFile.ts";
import { createMapComp } from "./mapApi.ts";
import { addRouteLine, ROUTE_MAX_POINTS } from "./overlays/routeCallout.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

export async function runRouteTests(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const size = { width: 1920, height: 1080 };
  const fps = 25;

  // A track from Dhaka towards Chattogram with 2400 wiggling points and times, as a GPX file.
  const count = 2400;
  const track = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return { lat: 23.81 - 1.45 * t + Math.sin(t * 40) * 0.02, lng: 90.41 + 1.42 * t + Math.cos(t * 31) * 0.02, time: new Date(Date.UTC(2026, 0, 1, 6, 0, i * 5)).toISOString() };
  });
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="RT1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="23.81" lon="90.41"><name>Dhaka</name></wpt><trk><name>Dhaka to Chattogram</name><trkseg>${track
    .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${p.time}</time></trkpt>`)
    .join("")}</trkseg></trk></gpx>`;
  const imported = await importFile(new File([gpx], "rt1-track.gpx"));
  const line = imported.lines[0];
  if (imported.lines.length !== 1 || line?.name !== "Dhaka to Chattogram" || line.points.length !== count) problems.push(`GPX import: ${imported.lines.length} lines, first "${line?.name}" with ${line?.points.length} points`);
  if (!line?.times || Math.abs(line.times[count - 1] - (count - 1) * 5) > 1e-6) problems.push(`GPX times: ${line?.times ? line.times[count - 1] : "none"}`);
  if (imported.places.length !== 1 || imported.places[0].name !== "Dhaka") problems.push(`GPX places: ${JSON.stringify(imported.places)}`);

  const view: View = fitPoints(line.points, size, { bearing: 15, pitch: 35, padding: 0.12 });
  const map = await createMapComp({ name: "RT1 routes", ...size, duration: 8, frameRate: fps, view, newScene: true });
  const made = await addRouteLine(map.id, line.points, { name: "Route: RT1", startFrame: 25, endFrame: 175, traveller: true });
  if (made.expressionErrors.length) problems.push(`expression errors: ${made.expressionErrors.slice(0, 3).join("; ")}`);
  if (made.points > ROUTE_MAX_POINTS || made.points < 50) problems.push(`the route keeps ${made.points} points`);

  const times = [1, 4, 7];
  const state = await host<{ layers: string[]; vertices: number; trim: number[]; samples: { x: number; y: number; r: number; o: number; progress: number }[]; view: number[]; errors: string[] }>(`
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
    var scene = mapLayer.containingComp, route = null, traveller = null, names = [];
    for (var i = 1; i <= scene.numLayers; i++) {
      var t = LML.tag.read(scene.layer(i));
      if (!t) continue;
      names.push(t.kind + ":" + scene.layer(i).name);
      if (t.kind === "route") route = scene.layer(i);
      if (t.kind === "traveller") traveller = scene.layer(i);
    }
    var out = { layers: names, vertices: 0, trim: [], samples: [], view: [], errors: [] };
    var v = LML.map.readViewAtTime(mapLayer, 1);
    out.view = [v.center.lat, v.center.lng, v.zoom, v.bearing, v.pitch];
    if (route) {
      var shape = route.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Shape - Group").property("ADBE Vector Shape");
      out.vertices = shape.valueAtTime(4, false).vertices.length;
      if (shape.expressionError) out.errors.push("route: " + shape.expressionError);
      var end = route.property("ADBE Root Vectors Group").property("ADBE Vector Filter - Trim").property("ADBE Vector Trim End");
      out.trim = [end.valueAtTime(1, false), end.valueAtTime(7, false)];
    }
    if (traveller) {
      var tr = traveller.property("ADBE Transform Group");
      var times = ${JSON.stringify(times)};
      for (var k = 0; k < times.length; k++) {
        var p = tr.property("ADBE Position").valueAtTime(times[k], false);
        out.samples.push({ x: p[0], y: p[1], r: tr.property("ADBE Rotate Z").valueAtTime(times[k], false), o: tr.property("ADBE Opacity").valueAtTime(times[k], false), progress: traveller.property("ADBE Effect Parade").property("Progress").property(1).valueAtTime(times[k], false) });
      }
      var props = ["ADBE Position", "ADBE Rotate Z", "ADBE Opacity"];
      for (var e = 0; e < props.length; e++) if (tr.property(props[e]).expressionError) out.errors.push(props[e] + ": " + tr.property(props[e]).expressionError);
    }
    return LML.json.stringify(out);`);

  if (state.errors.length) problems.push(`After Effects reports: ${state.errors.join("; ")}`);
  // The traveller sits above the route, both above the map.
  if (state.layers.join("|") !== "traveller:Traveller: Route: RT1|route:Route: RT1|mapLayer:RT1 routes") problems.push(`layers: ${state.layers.join(" | ")}`);
  if (state.vertices !== made.points) problems.push(`the path has ${state.vertices} vertices, the route ${made.points} points`);
  if (state.trim[0] !== 0 || state.trim[1] !== 100) problems.push(`trim end ${state.trim}`);

  // Where core maths puts the track's start, middle (by length on the map) and end, in the view After Effects holds.
  const held: View = { center: { lat: state.view[0], lng: state.view[1] }, zoom: state.view[2], bearing: state.view[3], pitch: state.view[4] };
  const light = simplifyLine(line.points, ROUTE_MAX_POINTS);
  const first = project(held, size, light[0]);
  const last = project(held, size, light[light.length - 1]);
  const [atStart, middle, atEnd] = state.samples;
  let worst = 0;
  if (atStart && atEnd && middle) {
    worst = Math.max(Math.hypot(atStart.x - first.x, atStart.y - first.y), Math.hypot(atEnd.x - last.x, atEnd.y - last.y));
    if (worst > 0.5) problems.push(`the traveller is ${worst.toFixed(2)} px off the track's ends`);
    if (atStart.progress !== 0 || atEnd.progress !== 100 || Math.abs(middle.progress - 50) > 1e-3) problems.push(`progress ${atStart.progress}, ${middle.progress}, ${atEnd.progress}`);
    // The middle lies between the ends, and the arrow points along the track (towards the end, within 45 degrees).
    const heading = (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI;
    const turn = Math.abs((((middle.r - heading) % 360) + 540) % 360 - 180);
    if (turn > 45) problems.push(`the arrow points ${middle.r.toFixed(1)} degrees, the track runs ${heading.toFixed(1)}`);
    // Progress counts along the route as drawn on screen (like Trim Paths), so at 50 % the traveller
    // sits at half the projected line's length.
    const screen = light.map((p) => project(held, size, p));
    const run = [0];
    for (let i = 1; i < screen.length; i++) run.push(run[i - 1] + Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y));
    const half = run[run.length - 1] / 2;
    const hi = run.findIndex((r) => r >= half);
    const t = (half - run[hi - 1]) / (run[hi] - run[hi - 1]);
    const want = { x: screen[hi - 1].x + (screen[hi].x - screen[hi - 1].x) * t, y: screen[hi - 1].y + (screen[hi].y - screen[hi - 1].y) * t };
    const off = Math.hypot(middle.x - want.x, middle.y - want.y);
    worst = Math.max(worst, off);
    if (off > 0.5) problems.push(`at 50 % the traveller is ${off.toFixed(2)} px from the middle of the drawn line`);
    if (middle.o !== 100) problems.push(`opacity ${middle.o}`);
  } else problems.push("no traveller samples");

  // A picture of the result for people: the basemap rendered under the half-drawn route and its arrow.
  try {
    const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
    await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: hasImagery("blue-marble") ? "satellite" : "midnight", relief: false });
    const file = path().join(spikeDir(), "route-sample.png").split(String.fromCharCode(92)).join("/");
    fs().rmSync(file, { force: true });
    await evalScript(`(function () { var c = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp; c.saveFrameToPng(4.6, new File(${JSON.stringify(file)})); return "1"; })()`);
    for (let i = 0; i < 80 && !fs().existsSync(file); i++) await new Promise((r) => setTimeout(r, 250));
  } catch (error) {
    problems.push(`the sample picture failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = problems.length === 0;
  log(`RT1 routes: GPX with ${count} points thinned to ${made.points}, traveller ${worst.toFixed(3)} px off the track's ends, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, points: made.points, worst, samples: state.samples, problems };
}
