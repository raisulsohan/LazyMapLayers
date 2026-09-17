// RT1: imported routes in After Effects. A GPX file is parsed in the panel, its track is drawn as a
// route layer with a traveller, and After Effects' own expression results are compared with core maths:
// the traveller must sit on the track's start, middle and end, face the direction of travel, and the
// route's path must hold the thinned points.

import { project, type View } from "../core/camera/camera.ts";
import { fitPoints } from "../core/camera/fit.ts";
import { zipSync } from "fflate";
import { prepareRouteLine } from "../core/geo/routeLine.ts";
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

/** A shapefile (.shp) with one polyline, written by hand: a 100-byte header and one record. */
function polylineShp(points: number[][]): Uint8Array {
  const content = 4 + 32 + 4 + 4 + 4 + 16 * points.length;
  const bytes = new Uint8Array(100 + 8 + content);
  const view = new DataView(bytes.buffer);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  view.setInt32(0, 9994, false);
  view.setInt32(24, bytes.length / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 3, true);
  box.forEach((v, i) => view.setFloat64(36 + i * 8, v, true));
  view.setInt32(100, 1, false);
  view.setInt32(104, content / 2, false);
  view.setInt32(108, 3, true);
  box.forEach((v, i) => view.setFloat64(112 + i * 8, v, true));
  view.setInt32(144, 1, true);
  view.setInt32(148, points.length, true);
  view.setInt32(152, 0, true);
  points.forEach((p, i) => {
    view.setFloat64(156 + i * 16, p[0], true);
    view.setFloat64(164 + i * 16, p[1], true);
  });
  return bytes;
}

const WEB_MERCATOR_PRJ =
  'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]';

const fileOf = (bytes: Uint8Array, name: string) => new File([bytes.slice().buffer as ArrayBuffer], name);

/** KMZ, CSV and zipped shapefiles through the same door as every other import. */
async function otherFormats(problems: string[]): Promise<string> {
  const text = new TextEncoder();
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Sylhet</name><Point><coordinates>91.87,24.9,0</coordinates></Point></Placemark>
<Placemark><name>River</name><LineString><coordinates>90.4,23.8,0 90.9,24.2,0 91.87,24.9,0</coordinates></LineString></Placemark>
<Placemark><name>Haor</name><Polygon><outerBoundaryIs><LinearRing><coordinates>91,24.5 91.5,24.5 91.5,24.9 91,24.9 91,24.5</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
  const kmz = await importFile(fileOf(zipSync({ "files/note.txt": text.encode("not a map"), "doc.kml": text.encode(kml) }), "rt1.kmz"));
  if (kmz.places.map((p) => p.name).join() !== "Sylhet" || kmz.areas.map((a) => a.name).join() !== "Haor" || !kmz.lines.some((l) => l.name === "River" && l.points.length === 3)) {
    problems.push(`KMZ import: places ${JSON.stringify(kmz.places)}, areas ${kmz.areas.map((a) => a.name)}, lines ${kmz.lines.map((l) => l.name)}`);
  }

  const csv = await importFile(new File(['Stadt;Breite;L\u00e4nge\n"Berlin";52,52;13,40\n"Wien";48,21;16,37\n"Rom";41,90;12,50\n'], "reise.csv"));
  if (csv.places.map((p) => p.name).join() !== "Berlin,Wien,Rom" || Math.abs(csv.places[1].lng - 16.37) > 1e-9 || csv.lines[0]?.name !== "reise (rows in order)" || csv.lines[0].points.length !== 3) {
    problems.push(`CSV import: places ${JSON.stringify(csv.places)}, lines ${JSON.stringify(csv.lines.map((l) => [l.name, l.points.length]))}`);
  }

  // A shapefile in Web Mercator metres with its .prj: the line must come back in degrees.
  const degrees = [
    [90.41, 23.81],
    [91.0, 23.2],
    [91.83, 22.36]
  ];
  const R = 6378137;
  const metres = degrees.map(([lng, lat]) => [(R * lng * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))]);
  const shape = await importFile(fileOf(zipSync({ "roads/road.shp": polylineShp(metres), "roads/road.prj": text.encode(WEB_MERCATOR_PRJ) }), "roads.zip"));
  const road = shape.lines[0];
  const shapeError = road ? Math.max(...road.points.map((p, i) => Math.hypot(p.lng - degrees[i][0], p.lat - degrees[i][1]))) : Infinity;
  if (!road || road.points.length !== 3 || shapeError > 1e-6) problems.push(`shapefile import: ${shape.lines.length} lines, ${shapeError} degrees off`);
  const lone = await importFile(fileOf(polylineShp(degrees), "lone.shp"));
  if (lone.lines[0]?.points.length !== 3 || Math.abs(lone.lines[0].points[2].lat - 22.36) > 1e-9) problems.push(`a lone .shp gives ${JSON.stringify(lone.lines[0]?.points)}`);

  let refused = "";
  try {
    await importFile(new File(["a,b\n1,x\n"], "nothing.csv"));
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  if (!refused.includes("latitude")) problems.push(`a table without coordinates is answered with "${refused}"`);
  return `KMZ ${kmz.lines.length} lines, CSV ${csv.places.length} places, shapefile ${shapeError.toExponential(1)} degrees off`;
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
  const light = prepareRouteLine(line.points, { maxPoints: ROUTE_MAX_POINTS, geodesic: true }).points;
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

  // Recorded pace: a track whose first half took nine times as long as its second, with a long rest
  // in the middle (a repeated position). Trim Paths and the traveller get the same linear keys.
  const slow = Array.from({ length: 400 }, (_, i) => ({ lat: 23.81 - (1.45 * i) / 399, lng: 90.41 + (1.42 * i) / 399 }));
  let clock = Date.UTC(2026, 0, 1, 6, 0, 0);
  const stamped: { lat: number; lng: number; time: string }[] = [];
  slow.forEach((p, i) => {
    stamped.push({ ...p, time: new Date(clock).toISOString() });
    if (i === 200) {
      clock += 4 * 3600e3;
      stamped.push({ ...p, time: new Date(clock).toISOString() });
    }
    clock += i < 200 ? 90e3 : 10e3;
  });
  const pacedGpx = `<?xml version="1.0"?><gpx version="1.1" creator="RT1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Paced</name><trkseg>${stamped
    .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${p.time}</time></trkpt>`)
    .join("")}</trkseg></trk></gpx>`;
  const paced = (await importFile(new File([pacedGpx], "rt1-paced.gpx"))).lines[0];
  if (!paced?.times || !paced.leaves || paced.points.length !== 400 || paced.leaves[200] - paced.times[200] !== 4 * 3600) problems.push(`the paced GPX: ${paced?.points.length} points, rest ${paced?.leaves ? paced.leaves[200] - paced.times![200] : "none"}`);
  let pacedKeys = 0;
  if (paced?.times) {
    const pacedMade = await addRouteLine(map.id, paced.points, { name: "Route: RT1 paced", startFrame: 0, endFrame: 150, traveller: true, pace: { points: paced.points, times: paced.times, leaves: paced.leaves } });
    pacedKeys = pacedMade.keys;
    if (pacedMade.expressionErrors.length) problems.push(`paced route expression errors: ${pacedMade.expressionErrors.slice(0, 2).join("; ")}`);
    const pacedState = await host<{ trimKeys: number; progressKeys: number; linear: boolean; pairs: number[][] }>(`
      var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
      var scene = mapLayer.containingComp, route = null, traveller = null;
      for (var i = 1; i <= scene.numLayers; i++) {
        var t = LML.tag.read(scene.layer(i));
        if (!t) continue;
        if (t.kind === "route" && scene.layer(i).name === "Route: RT1 paced") route = scene.layer(i);
        if (t.kind === "traveller" && scene.layer(i).name === "Traveller: Route: RT1 paced") traveller = scene.layer(i);
      }
      var end = route.property("ADBE Root Vectors Group").property("ADBE Vector Filter - Trim").property("ADBE Vector Trim End");
      var progress = traveller.property("ADBE Effect Parade").property("Progress").property(1);
      var linear = true;
      for (var k = 1; k <= end.numKeys; k++) if (end.keyInInterpolationType(k) !== KeyframeInterpolationType.LINEAR || end.keyOutInterpolationType(k) !== KeyframeInterpolationType.LINEAR) linear = false;
      for (var q = 1; q <= progress.numKeys; q++) if (progress.keyInInterpolationType(q) !== KeyframeInterpolationType.LINEAR) linear = false;
      var pairs = [], times = [0, 1, 2.6, 3, 4.5, 5.5, 5.9, 6];
      for (var n = 0; n < times.length; n++) pairs.push([end.valueAtTime(times[n], false), progress.valueAtTime(times[n], false)]);
      return LML.json.stringify({ trimKeys: end.numKeys, progressKeys: progress.numKeys, linear: linear, pairs: pairs });`);
    if (pacedState.trimKeys !== pacedMade.keys || pacedState.progressKeys !== pacedMade.keys || pacedMade.keys < 4 || pacedMade.keys > 80) problems.push(`paced keys: ${pacedMade.keys} made, ${pacedState.trimKeys} on Trim Paths, ${pacedState.progressKeys} on Progress`);
    if (!pacedState.linear) problems.push("the paced keys are not linear");
    if (pacedState.pairs.some(([trim, progress]) => Math.abs(trim - progress) > 1e-6)) problems.push(`Trim Paths and Progress differ: ${JSON.stringify(pacedState.pairs)}`);
    // 5 hours moving slowly, then 33 minutes fast; the 4 hour rest shrinks to 2 % of the time moving.
    // Half of the way is reached after about 88 % of the 6 seconds, and the rest holds the line still.
    const [, early, , , late] = pacedState.pairs.map((pair) => pair[0]);
    if (!(early > 5 && early < 12) || !(late > 40 && late < 50)) problems.push(`the paced route is at ${early.toFixed(1)} % after 1 s and ${late.toFixed(1)} % after 4.5 s`);
    for (let i = 1; i < pacedState.pairs.length; i++) if (pacedState.pairs[i][0] < pacedState.pairs[i - 1][0] - 1e-9) problems.push("the paced route runs backwards");
  }

  let formats = "";
  try {
    formats = await otherFormats(problems);
  } catch (error) {
    problems.push(`other formats: ${error instanceof Error ? error.message : String(error)}`);
  }

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
  log(`RT1 routes: GPX with ${count} points thinned to ${made.points}, traveller ${worst.toFixed(3)} px off the track's ends, recorded pace in ${pacedKeys} keys, ${formats}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, points: made.points, worst, pacedKeys, formats, samples: state.samples, problems };
}
