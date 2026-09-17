// X1: every kind of linked layer in both of After Effects' expression engines.
//
// Many projects (old ones, and new ones made from a project template) use the Legacy ExtendScript
// expression engine instead of the JavaScript engine. The test builds a globe map with 2D pins
// (scale and rotation on), a 3D camera and a 3D pin, a route, a callout and auto labels, reads every
// expression's value at several times with the JavaScript engine, switches the project to the Legacy
// ExtendScript engine, sets every expression again (After Effects keeps expressions compiled by the
// engine they were set with), reads them again and compares. It also compares a rendered frame from each
// engine, then puts the project's engine back. A probe expression proves which engine ran: arrays have
// a map method in the JavaScript engine and none in the Legacy ExtendScript engine (ES3).

import type { View } from "../core/camera/camera.ts";
import type { SpikeLog } from "./spikes.ts";

const TIMES = [0, 0.8, 1.6, 2.2, 2.9];
const FRAME_TIME = 2.2;

type Sample = { key: string; values: number[][]; error: string; enabled: boolean };

export async function runExpressionEngineTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const { createMapComp, setView, addPin, addCameraRig } = await import("./mapApi.ts");
  const { addRoute, addCallout } = await import("./overlays/routeCallout.ts");
  const { autoLabels } = await import("./labels/autoLabels.ts");
  const { decodePng } = await import("../core/image/pngDecode.ts");
  const { evalScript, fs, path } = await import("./cep.ts");
  const { spikeDir } = await import("./spikes.ts");
  const host = async <T>(body: string): Promise<T> => JSON.parse(await evalScript(`(function () { ${body} })()`)) as T;

  const paris = { lat: 48.8566, lng: 2.3522 };
  const keys: [number, View][] = [
    [0, { center: { lng: -30, lat: 30 }, zoom: 1.8, bearing: 0, pitch: 0 }],
    [1.2, { center: { lng: 2.35, lat: 48.86 }, zoom: 7.5, bearing: 15, pitch: 30 }],
    [2.2, { center: { lng: 2.35, lat: 48.86 }, zoom: 11.5, bearing: 30, pitch: 50 }],
    [3, { center: { lng: 2.34, lat: 48.85 }, zoom: 12.5, bearing: 40, pitch: 55 }]
  ];
  const map = await createMapComp({ name: "X1 expression engines", width: 1280, height: 720, duration: 3, frameRate: 25, view: keys[0][1], newScene: true, projection: "globe" });
  const idJson = JSON.stringify(map.id);
  const originalEngine = await host<string>(`return LML.json.stringify(app.project.expressionEngine);`);
  await host(`app.project.expressionEngine = "javascript-1.0"; return "1";`);
  for (const [time, view] of keys) {
    await host(`LML.pins.findMapLayer(${idJson}).containingComp.time = ${time}; return "1";`);
    await setView(map.id, view, true);
  }

  const errors: string[] = [];
  const pinStyle = { radius: 10, color: [1, 0.5, 0.2] as [number, number, number], strokeColor: [1, 1, 1] as [number, number, number], strokeWidth: 3 };
  errors.push(...(await addPin(map.id, paris, { name: "X1 Paris", scaleWithMap: true, rotateWithMap: true, style: pinStyle })).expressionErrors);
  errors.push(...(await addPin(map.id, { lat: 40.7128, lng: -74.006 }, { name: "X1 New York", style: pinStyle })).expressionErrors);
  await host(`LML.pins.findMapLayer(${idJson}).containingComp.time = 2.2; return "1";`);
  errors.push(...(await addCameraRig(map.id, keys[2][1])).expressionErrors);
  errors.push(...(await addPin(map.id, { lat: 48.8584, lng: 2.2945 }, { name: "X1 3D pin", threeD: true, altitude: 120, style: pinStyle })).expressionErrors);
  errors.push(...(await addRoute(map.id, paris, { lat: 35.6762, lng: 139.6503 }, { name: "X1 route", startFrame: 0, endFrame: 40 })).expressionErrors);
  errors.push(...(await addCallout(map.id, paris, "Paris", "X1 callout", { inFrame: 30, outFrame: 74 })).expressionErrors);
  const labels = await autoLabels(map.id, { maxLabels: 12 });
  errors.push(...labels.expressionErrors);
  log(`X1 built: ${labels.labels} labels, ${errors.length} expression errors while building`, errors.length ? "fail" : "muted");
  await host(`
    var scene = LML.pins.findMapLayer(${idJson}).containingComp;
    var probe = scene.layers.addNull();
    probe.name = "X1 engine probe";
    var slider = probe.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
    slider.property(1).expression = "typeof [].map === 'function' ? 2 : 1;";
    return "1";`);

  const sample = (engine: string, frameFile: string) =>
    host<Sample[]>(`
      app.project.expressionEngine = ${JSON.stringify(engine)};
      if (app.project.expressionEngine !== ${JSON.stringify(engine)}) return LML.json.stringify("engine is " + app.project.expressionEngine);
      var scene = LML.pins.findMapLayer(${idJson}).containingComp;
      var times = ${JSON.stringify(TIMES)};
      var out = [];
      function flat(v) {
        if (typeof v === "number") return [v];
        if (v && v.vertices) {
          var list = [];
          for (var k = 0; k < v.vertices.length; k++) list.push(v.vertices[k][0], v.vertices[k][1]);
          return list;
        }
        var copy = [];
        for (var n = 0; n < v.length; n++) copy.push(v[n]);
        return copy;
      }
      function walk(group, layer, trail) {
        for (var i = 1; i <= group.numProperties; i++) {
          var p = group.property(i);
          if (p.propertyType === PropertyType.PROPERTY) {
            if (!p.canSetExpression || p.expression === "") continue;
            var code = p.expression;
            p.expression = "";
            p.expression = code;
            var values = [];
            for (var t = 0; t < times.length; t++) values.push(flat(p.valueAtTime(times[t], false)));
            out.push({ key: layer.name + " " + trail + "/" + p.matchName, values: values, error: p.expressionError, enabled: p.expressionEnabled });
          } else {
            walk(p, layer, trail + "/" + p.matchName);
          }
        }
      }
      for (var i = 1; i <= scene.numLayers; i++) walk(scene.layer(i), scene.layer(i), "");
      scene.saveFrameToPng(${FRAME_TIME}, new File(${JSON.stringify(frameFile)}));
      return LML.json.stringify(out);`);

  const frame = async (engine: string) => {
    const file = path().join(spikeDir(), `X1-${engine}.png`).split(String.fromCharCode(92)).join("/");
    fs().rmSync(file, { force: true });
    const samples = await sample(engine, file);
    if (!Array.isArray(samples)) throw new Error(`switching to ${engine} failed: ${samples}`);
    let size = -1;
    for (let wait = 0; wait < 200; wait++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!fs().existsSync(file)) continue;
      const now = fs().statSync(file).size;
      if (now > 0 && now === size) break;
      size = now;
    }
    return { samples, image: decodePng(new Uint8Array(fs().readFileSync(file))) };
  };

  let javascript: Awaited<ReturnType<typeof frame>>;
  let legacy: Awaited<ReturnType<typeof frame>>;
  try {
    javascript = await frame("javascript-1.0");
    legacy = await frame("extendscript");
  } finally {
    await host(`app.project.expressionEngine = ${JSON.stringify(originalEngine)}; return "1";`);
  }

  const byKey = new Map(javascript.samples.map((s) => [s.key, s]));
  let worst = 0;
  const problems: string[] = [];
  let expressions = 0;
  const probeValues = (samples: Sample[]) => samples.filter((s) => s.key.startsWith("X1 engine probe")).flatMap((s) => s.values.flat());
  const jsProbe = probeValues(javascript.samples);
  const legacyProbe = probeValues(legacy.samples);
  const enginesProven = jsProbe.length === TIMES.length && jsProbe.every((v) => v === 2) && legacyProbe.length === TIMES.length && legacyProbe.every((v) => v === 1);
  if (!enginesProven) problems.push(`engine probe: JavaScript pass ${jsProbe}, Legacy pass ${legacyProbe} (expected 2s and 1s)`);
  for (const s of legacy.samples) {
    if (s.key.startsWith("X1 engine probe")) continue;
    const js = byKey.get(s.key);
    if (!js) {
      problems.push(`${s.key}: missing in the JavaScript engine pass`);
      continue;
    }
    if (js.error || !js.enabled) problems.push(`${s.key}: JavaScript engine error "${js.error}"`);
    if (s.error || !s.enabled) problems.push(`${s.key}: Legacy ExtendScript engine error "${s.error}"`);
    expressions++;
    s.values.forEach((row, t) => {
      if (row.length !== js.values[t].length) {
        problems.push(`${s.key}: ${row.length} vs ${js.values[t].length} numbers at ${TIMES[t]} s`);
        return;
      }
      row.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - js.values[t][k]))));
    });
  }
  let pixelDiff = 0;
  const a = javascript.image.rgba;
  const b = legacy.image.rgba;
  for (let i = 0; i < a.length; i++) pixelDiff += Math.abs(a[i] - b[i]);
  const meanPixelDiff = pixelDiff / a.length;

  const kinds = ["Pin: X1 Paris", "Pin: X1 New York", "3D Pin: X1 3D pin", "X1 route", "Callout leader: Paris", "Callout box: Paris", "Label:", "Map Camera Target"].map((prefix) => legacy.samples.some((s) => s.key.startsWith(prefix)));
  const camera = legacy.samples.some((s) => s.key.includes("ADBE Camera Zoom"));
  const passed = errors.length === 0 && problems.length === 0 && worst < 1e-3 && meanPixelDiff < 0.05 && expressions >= 18 && enginesProven && kinds.every(Boolean) && camera;
  log(
    `X1 expression engines: ${expressions} expressions at ${TIMES.length} times, worst difference ${worst.toExponential(2)}, frame difference ${meanPixelDiff.toFixed(4)}, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems.slice(0, 8)) log(`  ${problem}`, "fail");
  return { passed, expressions, enginesProven, worst, meanPixelDiff, problems: problems.slice(0, 20), buildErrors: errors, kinds, camera, originalEngine };
}
