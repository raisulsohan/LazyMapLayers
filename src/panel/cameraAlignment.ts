// C1: the 3D camera rig in After Effects against core camera maths (and so against MapLibre).
// Animates the map between two views, adds the rig and 3D pins, and reads where AE's own camera
// projects each pin (toComp in an expression) at several times. Ground pins must land where the
// renderer draws them; pins above the ground must match the rig maths. Runs at 1080p and 4K, and
// again with the map layer scaled about the comp centre.

import { groundFrameFor, groundPoint, projectThroughRig, rigPose } from "../core/ae/cameraRig.ts";
import { project, unproject, type View, type Viewport } from "../core/camera/camera.ts";
import { evalScript } from "./cep.ts";
import { addCameraRig, addPin, createMapComp, setView } from "./mapApi.ts";
import type { SpikeLog } from "./spikes.ts";

type PinSpec = { lat: number; lng: number; altitude: number };
type Sample = { view: View; mapScale: number; probes: { name: string; x: number; y: number; error: string }[] };

const viewA: View = { center: { lng: -73.9857, lat: 40.7484 }, zoom: 13.4, bearing: -29, pitch: 40 };
const viewB: View = { center: { lng: -74.0445, lat: 40.6892 }, zoom: 16.9, bearing: 70, pitch: 72 };

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

const PROBE_EXPRESSION = "const p = toComp([0, 0, 0]); [p[0], p[1]];";

function addProbesScript(mapId: string): string {
  return `
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(mapId)});
    var scene = mapLayer.containingComp;
    for (var i = 1; i <= scene.numLayers; i++) {
      var layer = scene.layer(i);
      var tag = LML.tag.read(layer);
      if (!tag || tag.kind !== "pin" || !tag.threeD) continue;
      var probe = layer.property("ADBE Effect Parade").addProperty("ADBE Point Control");
      probe.name = "C1 Probe";
      probe.property(1).expression = ${JSON.stringify(PROBE_EXPRESSION)};
    }
    return "1";`;
}

function sampleScript(mapId: string, time: number): string {
  return `
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(mapId)});
    var scene = mapLayer.containingComp;
    scene.time = ${time};
    var view = LML.map.readViewAtTime(mapLayer, ${time});
    var scale = mapLayer.property("ADBE Transform Group").property("ADBE Scale").valueAtTime(${time}, false);
    var probes = [];
    for (var i = 1; i <= scene.numLayers; i++) {
      var layer = scene.layer(i);
      var tag = LML.tag.read(layer);
      if (!tag || tag.kind !== "pin" || !tag.threeD) continue;
      var value = layer.property("ADBE Effect Parade").property("C1 Probe").property(1);
      var p = value.valueAtTime(${time}, false);
      var error = value.expressionError || layer.property("ADBE Transform Group").property("ADBE Position").expressionError || "";
      probes.push({ name: layer.name, x: p[0], y: p[1], error: error });
    }
    return LML.json.stringify({ view: view, mapScale: scale[0] / 100, probes: probes });`;
}

async function runAtSize(log: SpikeLog, size: Viewport) {
  const { width, height } = size;
  const map = await createMapComp({ name: `C1 camera ${width}`, width, height, duration: 4, frameRate: 25, view: viewA, newScene: true });
  const at = (time: number) => host(`var l = LML.pins.findMapLayer(${JSON.stringify(map.id)}); l.containingComp.time = ${time}; return "1";`);
  await at(0);
  await setView(map.id, viewA, true);
  await at(3);
  await setView(map.id, viewB, true);
  await at(0);

  const rig = await addCameraRig(map.id, viewA);
  const again = await addCameraRig(map.id, viewA);
  const expressionErrors = [...rig.expressionErrors];
  const frame = groundFrameFor(viewA, size);

  let seed = 17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pins: PinSpec[] = [];
  for (const view of [viewA, viewB]) {
    while (pins.length < (view === viewA ? 10 : 18)) {
      const ground = unproject(view, size, { x: random() * width, y: height * (0.35 + random() * 0.65) });
      // Every third pin floats: 30 m to 400 m above the ground.
      if (ground) pins.push({ ...ground, altitude: pins.length % 3 === 2 ? 30 + random() * 370 : 0 });
    }
  }
  for (const [i, pin] of pins.entries()) {
    const added = await addPin(map.id, pin, { name: `C${i + 1}`, threeD: true, altitude: pin.altitude });
    expressionErrors.push(...added.expressionErrors);
  }
  await host(addProbesScript(map.id));
  const pinForName = (name: string) => {
    const match = /^3D Pin: C([0-9]+)$/.exec(name);
    if (!match) throw new Error(`unexpected 3D pin layer name ${name}`);
    return pins[Number(match[1]) - 1];
  };

  let worst = 0;
  let checks = 0;
  const compare = async (label: string, times: number[]) => {
    let worstHere = 0;
    for (const time of times) {
      const sample = await host<Sample>(sampleScript(map.id, time));
      const pose = rigPose(sample.view, size, frame, sample.mapScale);
      for (const probe of sample.probes) {
        if (probe.error) expressionErrors.push(`${probe.name}: ${probe.error}`);
        const pin = pinForName(probe.name);
        const flat = project(sample.view, size, pin);
        // Skip pins behind the camera or squeezed against the horizon.
        if (!flat.visible || flat.scale > 20) continue;
        let expected: { x: number; y: number };
        if (pin.altitude === 0) {
          // Where the renderer draws it, through the map layer's scale about the comp centre.
          expected = { x: width / 2 + (flat.x - width / 2) * sample.mapScale, y: height / 2 + (flat.y - height / 2) * sample.mapScale };
        } else {
          const lifted = projectThroughRig(pose, size, groundPoint(frame, pin, pin.altitude));
          if (!lifted.visible) continue;
          expected = lifted;
        }
        const error = Math.hypot(probe.x - expected.x, probe.y - expected.y);
        worstHere = Math.max(worstHere, error);
        checks++;
      }
    }
    worst = Math.max(worst, worstHere);
    log(`C1 ${width}x${height} ${label}: worst error ${worstHere.toFixed(6)} px`, worstHere < 0.5 ? "ok" : "fail");
    return worstHere;
  };

  const animated = await compare("animated camera", [0, 0.7, 1.4, 2.1, 3]);
  await host(`var l = LML.pins.findMapLayer(${JSON.stringify(map.id)}); l.property("ADBE Transform Group").property("ADBE Scale").setValue([62, 62]); return "1";`);
  const scaled = await compare("map layer scaled to 62 %", [0.9, 2.6]);
  const warnings = await addCameraRig(map.id, viewA).then((r) => r.warnings);
  return { size: `${width}x${height}`, pins: pins.length, checks, worst, animated, scaled, created: rig.created, reusedOnSecondCall: !again.created, rigWarnings: rig.warnings, warnings, expressionErrors };
}

export async function runCameraAlignment(log: SpikeLog): Promise<Record<string, unknown>> {
  const hd = await runAtSize(log, { width: 1920, height: 1080 });
  const uhd = await runAtSize(log, { width: 3840, height: 2160 });
  const expressionErrors = [...hd.expressionErrors, ...uhd.expressionErrors];
  const passed = hd.worst < 0.5 && uhd.worst < 0.5 && expressionErrors.length === 0 && hd.reusedOnSecondCall && hd.checks > 50 && uhd.checks > 50;
  log(`C1 3D camera: ${hd.checks + uhd.checks} comparisons, expression errors ${expressionErrors.length}`, passed ? "ok" : "fail");
  if (expressionErrors.length) log(expressionErrors.slice(0, 5).join(" | "), "fail");
  return { hd, uhd, passed };
}
