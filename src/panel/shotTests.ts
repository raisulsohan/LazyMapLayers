// SH1: the shot list in After Effects. Bakes a list with every kind of move, applies it through the
// host and checks the timeline against core maths: every frame's view, key counts (still holds keep
// two keys), the Hold key before a cut, shot markers next to a marker of the user's, the comp growing
// to fit, a shorter list leaving no old keys, a hand edit being noticed, and a long list surviving
// the round trip through the project.

import type { View } from "../core/camera/camera.ts";
import { bakeShots, buildTimeline, normaliseShotList, viewAtFrame, type Shot, type ShotList } from "../core/camera/shots.ts";
import { keyOf } from "../core/render/frameKey.ts";
import { callHost, callHostWithJobFile, evalScript } from "./cep.ts";
import { addPin, createMapComp } from "./mapApi.ts";
import type { SpikeLog } from "./spikes.ts";

const globe: View = { center: { lat: 24, lng: -32 }, zoom: 1.6, bearing: 0, pitch: 0 };
const paris: View = { center: { lat: 48.8566, lng: 2.2986 }, zoom: 15.1, bearing: 32, pitch: 58 };
const louvre: View = { center: { lat: 48.8606, lng: 2.3376 }, zoom: 16, bearing: -10, pitch: 45 };
const tokyo: View = { center: { lat: 35.6605, lng: 139.7482 }, zoom: 14.6, bearing: -25, pitch: 55 };

const shot = (id: string, name: string, view: View, extra: Partial<Shot>): Shot => ({ id, name, view, hold: 2, move: { kind: "fly", seconds: 6, easing: { id: "smooth" }, height: "normal", pitchDip: true }, ...extra });

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

type Applied = { keys: number; removed: number; slowRemovals: number; markers: number; ms: number };

async function apply(mapId: string, list: ShotList, size: { width: number; height: number }, fps: number): Promise<{ result: Applied; baked: ReturnType<typeof bakeShots> }> {
  const baked = bakeShots(list, size, fps);
  // One frame more than the end time, so the landing frame itself is inside the comp.
  await callHost("extendDuration", { mapId, duration: baked.endTime + 1 / fps });
  const result = await callHostWithJobFile<Applied>("applyShots", {
    mapId,
    list,
    hash: keyOf(list),
    baked: { startTime: baked.startTime, endTime: baked.endTime, controls: baked.controls, holdTimes: baked.holdTimes, markers: baked.markers }
  });
  return { result, baked };
}

export async function runShotTests(log: SpikeLog): Promise<Record<string, unknown>> {
  const size = { width: 1920, height: 1080 };
  const fps = 25;
  const problems: string[] = [];
  const map = await createMapComp({ name: "SH1 shots", ...size, duration: 20, frameRate: fps, view: globe, newScene: true, projection: "globe" });
  const id = JSON.stringify(map.id);

  // A pin on Paris's centre: its expressions read the map controls by name and must keep working when
  // Apply replaces the controls.
  const pin = await addPin(map.id, paris.center, { name: "SH1 Paris" });
  if (pin.expressionErrors.length) problems.push(`pin expressions: ${pin.expressionErrors.join("; ")}`);

  // A marker of the user's own, which must survive every Apply.
  await host(`var l = LML.pins.findMapLayer(${id}); l.property("ADBE Marker").setValueAtTime(0.5, new MarkerValue("my own marker")); return "1";`);

  const list = normaliseShotList({
    v: 1,
    start: 1,
    shots: [
      shot("s1", "Globe", globe, { hold: 2, spin: 20, holdEasing: { id: "linear" } }),
      shot("s2", "Paris", paris, { hold: 3, orbit: 40, move: { kind: "fly", seconds: 6, easing: { id: "cinematic" }, height: "normal", pitchDip: true } }),
      shot("s3", "Louvre", louvre, { hold: 2, move: { kind: "cut", seconds: 0, easing: { id: "linear" } } }),
      shot("s4", "Tokyo", tokyo, { hold: 2, move: { kind: "route", seconds: 8, easing: { id: "smooth" }, height: "high", pitchDip: true, route: { followBearing: false } } })
    ]
  });
  const first = await apply(map.id, list, size, fps);
  const baked = first.baked;
  const timeline = buildTimeline(list, size, fps);

  // 1. Every frame of the timeline against core maths.
  const lastFrame = Math.round(baked.endTime * fps);
  const sampled = await callHost<{ views: number[][][] }>("sampleViews", { mapId: map.id, firstFrame: 0, lastFrame, offsets: [0], compact: true });
  let worst = 0;
  let worstAt = "";
  sampled.views.forEach((samples, frame) => {
    const expected = viewAtFrame(timeline, frame)!;
    const got = samples[0];
    const pairs: [string, number, number][] = [
      ["lat", got[0], expected.center.lat],
      ["lng", got[1], expected.center.lng],
      ["zoom", got[2], expected.zoom],
      ["bearing", got[3], expected.bearing],
      ["pitch", got[4], expected.pitch]
    ];
    for (const [name, a, b] of pairs) {
      const error = Math.abs(a - b) / Math.max(1, Math.abs(b));
      if (error > worst) {
        worst = error;
        worstAt = `${name} at frame ${frame}: ${a} vs ${b}`;
      }
    }
  });
  if (sampled.views.length !== lastFrame + 1) problems.push(`sampled ${sampled.views.length} frames, expected ${lastFrame + 1}`);
  if (worst > 2e-6) problems.push(`views differ from core maths: ${worstAt} (relative ${worst.toExponential(2)})`);

  // 2. Timeline state: durations, key counts, the Hold key at the cut, markers.
  const cutTime = baked.holdTimes[0];
  const state = await host<{
    sceneDuration: number;
    mapDuration: number;
    outPoint: number;
    keys: number[];
    holdOut: boolean;
    beforeCut: number;
    markers: { time: number; name: string; ours: boolean }[];
  }>(`
    var l = LML.pins.findMapLayer(${id});
    var keys = [];
    for (var c = 0; c < LML.map.CONTROLS.length; c++) keys.push(LML.map.controlValueProperty(l, LML.map.CONTROLS[c].name).numKeys);
    var zoom = LML.map.controlValueProperty(l, "Zoom");
    var k = zoom.nearestKeyIndex(${cutTime});
    var markers = [];
    var m = l.property("ADBE Marker");
    for (var i = 1; i <= m.numKeys; i++) {
      var p = m.keyValue(i).getParameters();
      markers.push({ time: m.keyTime(i), name: m.keyValue(i).comment, ours: !!(p && p[LML.shots.MARKER_PARAMETER]) });
    }
    return LML.json.stringify({
      sceneDuration: l.containingComp.duration, mapDuration: l.source.duration, outPoint: l.outPoint, keys: keys,
      holdOut: zoom.keyOutInterpolationType(k) === KeyframeInterpolationType.HOLD,
      beforeCut: zoom.valueAtTime(${cutTime} + 0.5 / ${fps}, false), markers: markers
    });`);
  if (state.sceneDuration < baked.endTime - 1e-6 || state.mapDuration < baked.endTime - 1e-6 || state.outPoint < baked.endTime - 1e-6) {
    problems.push(`the comps did not grow to ${baked.endTime} s: scene ${state.sceneDuration}, map ${state.mapDuration}, layer out ${state.outPoint}`);
  }
  const expectedKeys = baked.controls.map((c) => c.times.length);
  if (JSON.stringify(state.keys) !== JSON.stringify(expectedKeys)) problems.push(`key counts ${state.keys} differ from the bake ${expectedKeys}`);
  if (!state.holdOut) problems.push("the key before the cut is not a Hold key");
  // Half a frame after the last frame of the Paris orbit the zoom is still Paris's (no blend into the cut).
  if (Math.abs(state.beforeCut - paris.zoom) > 1e-4) problems.push(`the cut blends: zoom ${state.beforeCut} half a frame before it`);
  const ours = state.markers.filter((m) => m.ours);
  if (ours.map((m) => m.name).join("|") !== "Globe|Paris|Louvre|Tokyo") problems.push(`shot markers: ${JSON.stringify(state.markers)}`);
  if (!state.markers.some((m) => !m.ours && m.name === "my own marker")) problems.push("the user's own marker is gone");

  let stored = await callHost<{ list: ShotList; state: string; appliedHash: string }>("getShots", { mapId: map.id });
  if (stored.state !== "applied" || stored.appliedHash !== keyOf(list)) problems.push(`after Apply the state is ${stored.state}`);
  if (keyOf(normaliseShotList(stored.list)) !== keyOf(list)) problems.push("the stored list differs from the applied one");

  // 3. A shorter list leaves no keys or markers of the longer one behind.
  const shorter: ShotList = { ...list, shots: list.shots.slice(0, 3) };
  const second = await apply(map.id, shorter, size, fps);
  const after = await host<{ keys: number[]; ours: number; lastKey: number }>(`
    var l = LML.pins.findMapLayer(${id});
    var keys = [];
    for (var c = 0; c < LML.map.CONTROLS.length; c++) keys.push(LML.map.controlValueProperty(l, LML.map.CONTROLS[c].name).numKeys);
    var m = l.property("ADBE Marker");
    var ours = 0;
    for (var i = 1; i <= m.numKeys; i++) { var p = m.keyValue(i).getParameters(); if (p && p[LML.shots.MARKER_PARAMETER]) ours++; }
    var zoom = LML.map.controlValueProperty(l, "Zoom");
    return LML.json.stringify({ keys: keys, ours: ours, lastKey: zoom.keyTime(zoom.numKeys) });`);
  const shorterKeys = second.baked.controls.map((c) => c.times.length);
  if (JSON.stringify(after.keys) !== JSON.stringify(shorterKeys)) problems.push(`after a shorter list the key counts are ${after.keys}, expected ${shorterKeys}`);
  if (after.ours !== 3) problems.push(`after a shorter list there are ${after.ours} shot markers`);
  if (Math.abs(after.lastKey - second.baked.endTime) > 1e-6) problems.push(`old keys remain after ${second.baked.endTime} s (last key at ${after.lastKey})`);

  // Re-applying must be fast (the controls are replaced instead of removing keys one by one), the
  // camera must still match, and the pin must still follow it: on Paris's hold it sits in the centre.
  if (second.result.ms > 800) problems.push(`applying again took ${second.result.ms} ms`);
  if (second.result.slowRemovals) problems.push(`${second.result.slowRemovals} keys were removed one by one`);
  const shortTimeline = buildTimeline(shorter, size, fps);
  const again = await callHost<{ views: number[][][] }>("sampleViews", { mapId: map.id, firstFrame: 0, lastFrame: Math.round(second.baked.endTime * fps), offsets: [0], compact: true });
  let worstAgain = 0;
  again.views.forEach((samples, frame) => {
    const expected = viewAtFrame(shortTimeline, frame)!;
    const got = samples[0];
    [expected.center.lat, expected.center.lng, expected.zoom, expected.bearing, expected.pitch].forEach((b, i) => (worstAgain = Math.max(worstAgain, Math.abs(got[i] - b) / Math.max(1, Math.abs(b)))));
  });
  if (worstAgain > 2e-6) problems.push(`after applying again the views differ from core maths (relative ${worstAgain.toExponential(2)})`);
  const parisTime = shortTimeline.shots[1].arriveFrame / fps;
  const pinState = await host<{ x: number; y: number; error: string; order: string[] }>(`
    var l = LML.pins.findMapLayer(${id});
    var scene = l.containingComp;
    var out = { x: 0, y: 0, error: "no pin", order: [] };
    for (var i = 1; i <= scene.numLayers; i++) {
      var layer = scene.layer(i);
      var tag = LML.tag.read(layer);
      if (!tag || tag.kind !== "pin") continue;
      var position = layer.property("ADBE Transform Group").property("ADBE Position");
      var p = position.valueAtTime(${parisTime}, false);
      out = { x: p[0], y: p[1], error: position.expressionError || "", order: [] };
    }
    var effects = l.property("ADBE Effect Parade");
    for (var e = 1; e <= effects.numProperties; e++) out.order.push(effects.property(e).name);
    return LML.json.stringify(out);`);
  if (pinState.error) problems.push(`the pin's expression fails after Apply: ${pinState.error}`);
  if (Math.hypot(pinState.x - size.width / 2, pinState.y - size.height / 2) > 0.5) problems.push(`the pin is at ${pinState.x}, ${pinState.y} on Paris's shot, not in the centre`);
  if (pinState.order.slice(0, 5).join("|") !== "Latitude|Longitude|Zoom|Bearing|Pitch") problems.push(`the map controls changed order: ${pinState.order.join(", ")}`);

  // 4. A key changed by hand is noticed.
  await host(`var z = LML.map.controlValueProperty(LML.pins.findMapLayer(${id}), "Zoom"); z.setValueAtKey(2, z.keyValue(2) + 0.37); return "1";`);
  stored = await callHost("getShots", { mapId: map.id });
  if (stored.state !== "edited") problems.push(`a hand edit was not noticed (state ${stored.state})`);

  // 5. A long list survives the project round trip.
  const long = normaliseShotList({ v: 1, start: 0, shots: Array.from({ length: 40 }, (_, i) => shot(`s${i + 1}`, `Shot number ${i + 1} · 東京 ঢাকা`, { ...paris, bearing: i * 7 }, { orbit: i })) });
  await callHost("saveShots", { mapId: map.id, list: long });
  const back = await callHost<{ list: ShotList }>("getShots", { mapId: map.id });
  if (keyOf(normaliseShotList(back.list)) !== keyOf(long)) problems.push("a 40-shot list did not survive being stored in the project");
  const tagStillReads = await host<{ ok: boolean }>(`return LML.json.stringify({ ok: !!LML.tag.read(LML.pins.findMapLayer(${id})) });`);
  if (!tagStillReads.ok) problems.push("the map layer's tag no longer reads next to the stored list");
  await callHost("clearShots", { mapId: map.id, keys: true });
  const cleared = await callHost<{ state: string }>("getShots", { mapId: map.id });
  if (cleared.state !== "none") problems.push(`clearing left the state ${cleared.state}`);

  // How long removing keys takes, under different conditions (diagnostic for Apply's speed).
  const removal = await host<Record<string, number>>(`
    var l = LML.pins.findMapLayer(${id});
    var fx = l.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
    fx.name = "SH1 perf";
    function prop() { return l.property("ADBE Effect Parade").property("SH1 perf").property(1); }
    function fill(n) { var t = [], v = []; for (var i = 0; i < n; i++) { t.push(i / 25); v.push(i); } prop().setValuesAtTimes(t, v); }
    function clear() { var p = prop(); var s = new Date().getTime(); for (var k = p.numKeys; k >= 1; k--) p.removeKey(k); return new Date().getTime() - s; }
    var out = {};
    fill(400); out.sceneInViewer = clear();
    app.beginUndoGroup("SH1 perf"); fill(400); out.inUndoGroup = clear(); app.endUndoGroup();
    try { l.source.openInViewer(); } catch (e) {}
    app.beginUndoGroup("SH1 perf 2"); fill(400); out.mapCompInViewer = clear(); app.endUndoGroup();
    var wasSelected = l.selected; l.selected = false;
    app.beginUndoGroup("SH1 perf 3"); fill(400); out.layerDeselected = clear(); app.endUndoGroup();
    l.selected = wasSelected;
    try { l.containingComp.openInViewer(); } catch (e) {}
    l.property("ADBE Effect Parade").property("SH1 perf").remove();
    return LML.json.stringify(out);`);
  log(`SH1 removing 400 keys: ${JSON.stringify(removal)} ms`, "muted");

  const passed = problems.length === 0;
  log(
    `SH1 shot list: ${lastFrame + 1} frames match core maths (worst ${worst.toExponential(2)}), ${first.result.keys} keys instead of ${baked.denseKeyCount} written in ${first.result.ms} ms, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems.slice(0, 10)) log(`  ${problem}`, "fail");
  return { passed, removal, frames: lastFrame + 1, worst, keys: first.result.keys, denseKeys: baked.denseKeyCount, applyMs: first.result.ms, secondApplyMs: second.result.ms, problems };
}
