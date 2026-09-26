// FO1: one map's camera following another's.
//
// Two maps in one comp: the second, an overview in the corner, follows the first two zoom steps out
// and keeps its own tilt, so over a move from Dhaka to Delhi it reads the leader's centre, zoom and
// turn at every moment, renders as animated, and refuses to be followed back. Stopping gives it its
// own camera again. A map in another comp gets the leader's camera copied, easing and all, and a
// copy of the follower (whose camera is an expression) lands a key per frame. A frame of the comp
// with both maps rendered is saved to look at.

import { followExpressions } from "../core/ae/followExpressions.ts";
import { PREVIEW_SETTINGS } from "../core/render/plan.ts";
import { callHost, evalScript, fs, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

type V = { lat: number; lng: number; zoom: number; bearing: number; pitch: number };

async function viewsOf(mapId: string, times: number[]): Promise<V[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(mapId)}), out = [], times = ${JSON.stringify(times)};
      for (var i = 0; i < times.length; i++) {
        var v = LML.map.readViewAtTime(layer, times[i]);
        out.push({ lat: v.center.lat, lng: v.center.lng, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });
      }
      return LML.json.stringify(out);
    })()`)
  ) as V[];
}

const same = (a: number, b: number, slack = 1e-4) => Math.abs(a - b) <= slack;

export async function runFollowTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const out: Record<string, unknown> = {};
  const times = [0, 0.7, 1.5, 2.3, 3];
  const roots: string[] = [];
  try {
    const size = { width: 1280, height: 720 };
    const leader = await createMapComp({ name: "FO1 leader", ...size, duration: 3.2, frameRate: 25, view: { center: { lat: 23.8, lng: 90.4 }, zoom: 5, bearing: 0, pitch: 0 }, newScene: true });
    for (const [name, a, b] of [["Latitude", 23.8, 28.6], ["Longitude", 90.4, 77.2], ["Zoom", 5, 6], ["Bearing", 0, 30], ["Pitch", 0, 40]] as const) {
      await callHost("setControlKeys", { mapId: leader.id, name, times: [0, 3], values: [a, b] });
    }
    // Eased keys, so a copy that dropped the easing would show between them.
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(leader.id)});
      var p = LML.map.controlValueProperty(layer, "Longitude");
      var ease = [new KeyframeEase(0, 75)];
      p.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      p.setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      p.setTemporalEaseAtKey(1, ease, ease);
      p.setTemporalEaseAtKey(2, ease, ease);
      return "1";
    })()`);
    // The overview goes into the same comp, in its top right corner.
    const overview = await createMapComp({ name: "FO1 overview", width: 640, height: 360, duration: 3.2, frameRate: 25, view: { center: { lat: 0, lng: 0 }, zoom: 2, bearing: 0, pitch: 0 }, newScene: false });
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(overview.id)});
      layer.property("ADBE Transform Group").property("ADBE Position").setValue([1280 - 180, 110]);
      layer.property("ADBE Transform Group").property("ADBE Scale").setValue([50, 50]);
      return "1";
    })()`);
    const options = { zoomOffset: -2, bearing: true, pitch: false };
    const made = await callHost<{ following: string | null; expressionErrors: string[] }>("followMap", { mapId: overview.id, leaderId: leader.id, ...options, expressions: followExpressions(options) });
    check(made.following === leader.id, "the overview does not follow the leader");
    check(made.expressionErrors.length === 0, `follow expression errors: ${made.expressionErrors.join("; ")}`);
    const led = await viewsOf(leader.id, times);
    const followed = await viewsOf(overview.id, times);
    let worst = 0;
    for (let i = 0; i < times.length; i++) {
      const a = led[i];
      const b = followed[i];
      worst = Math.max(worst, Math.abs(a.lat - b.lat), Math.abs(a.lng - b.lng), Math.abs(a.zoom - 2 - b.zoom), Math.abs(a.bearing - b.bearing));
      check(same(b.pitch, 0), `at ${times[i]} s the overview tilts ${b.pitch}, not its own 0`);
    }
    out.worst = worst;
    check(worst < 1e-4, `the overview is ${worst} off the leader's camera`);
    const info = await callHost<{ animated: boolean }>("renderInfo", { mapId: overview.id });
    check(info.animated, "a map that follows a moving camera does not render as animated");
    let loop = "";
    try {
      await callHost("followMap", { mapId: leader.id, leaderId: overview.id, ...options, expressions: followExpressions(options) });
    } catch (error) {
      loop = error instanceof Error ? error.message : String(error);
    }
    check(loop.indexOf("already follows") >= 0, `following back: "${loop}"`);

    // Both rendered, and a frame of the comp to look at.
    for (const id of [leader.id, overview.id]) {
      const result = await runRenderJob({ mapId: id, quality: "preview", settings: PREVIEW_SETTINGS, basemap: { kind: "world" } });
      roots.push(result.storeRoot);
    }
    const file = path().join(spikeDir(), "FO1-frame.png").split(String.fromCharCode(92)).join("/");
    fs().rmSync(file, { force: true });
    await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(leader.id)}).containingComp.saveFrameToPng(2, new File(${JSON.stringify(file)})); return "1"; })()`);
    for (let i = 0; i < 60 && !fs().existsSync(file); i++) await new Promise((resolve) => setTimeout(resolve, 250));

    // A map in another comp: the leader's camera copied, easing and all.
    const other = await createMapComp({ name: "FO1 copy", ...size, duration: 3.2, frameRate: 25, view: { center: { lat: 0, lng: 0 }, zoom: 2, bearing: 0, pitch: 0 }, newScene: true });
    const copied = await callHost<{ keys: number }>("copyCamera", { mapId: other.id, fromId: leader.id });
    check(copied.keys === 10, `${copied.keys} keys were copied, not 10`);
    const copy = await viewsOf(other.id, times);
    const copyOff = Math.max(...times.map((_, i) => Math.max(Math.abs(copy[i].lng - led[i].lng), Math.abs(copy[i].lat - led[i].lat), Math.abs(copy[i].zoom - led[i].zoom))));
    out.copyOff = copyOff;
    check(copyOff < 1e-4, `the copied camera is ${copyOff} off the leader's`);
    // And the overview's camera, which is an expression: a key per frame.
    const fromFollower = await callHost<{ keys: number }>("copyCamera", { mapId: other.id, fromId: overview.id });
    check(fromFollower.keys >= 4 * 80, `only ${fromFollower.keys} keys were copied from the follower`);
    const copy2 = await viewsOf(other.id, [1.5]);
    check(same(copy2[0].zoom, followed[2].zoom) && same(copy2[0].lng, followed[2].lng), `the copy of the follower is at ${JSON.stringify(copy2[0])}, not ${JSON.stringify(followed[2])}`);

    // Stopping: its own camera again, and nothing of the link left.
    await callHost("followMap", { mapId: overview.id, leaderId: null });
    const own = await viewsOf(overview.id, [1.5]);
    check(same(own[0].lat, 0) && same(own[0].zoom, 2), `after stopping, the overview is at ${JSON.stringify(own[0])}`);
    const left = await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(overview.id)}), fx = layer.property("ADBE Effect Parade");
      return String(!!fx.property("Follows")) + "," + String(!!fx.property("Follow Zoom Offset")) + "," + String(!!LML.tag.read(layer).follows);
    })()`);
    check(left === "false,false,false", `after stopping, left behind: ${left}`);
  } catch (error) {
    problems.push(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const root of roots) {
    try {
      fs().rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Left for the next run.
    }
  }
  const passed = problems.length === 0;
  log(`FO1 follow: ${JSON.stringify(out)}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, ...out };
}
