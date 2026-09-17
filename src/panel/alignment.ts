// P1: pins in After Effects against core camera maths (and so against MapLibre, see S2a).
// Animates the camera between two views, then compares every pin's evaluated position with the
// projection of its exact coordinates for the camera values AE reports at that time, mapped
// through the map layer's transform. Repeats after moving, scaling and renaming the map.

import { project, unproject, type View } from "../core/camera/camera.ts";
import { evalScript } from "./cep.ts";
import { addPin, createMapComp, setView } from "./mapApi.ts";
import type { SpikeLog } from "./spikes.ts";

type Sample = { view: View; pins: number[][]; names: string[]; errors: string[] };

const viewA: View = { center: { lng: 2.3522, lat: 48.8566 }, zoom: 11.3, bearing: 25, pitch: 45 };
const viewB: View = { center: { lng: 2.2945, lat: 48.8584 }, zoom: 16.8, bearing: -60, pitch: 70 };

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

function sampleScript(mapId: string, time: number): string {
  return `
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(mapId)});
    var scene = mapLayer.containingComp;
    scene.time = ${time};
    var view = LML.map.readViewAtTime(mapLayer, ${time});
    var pins = [], names = [], errors = [];
    for (var i = 1; i <= scene.numLayers; i++) {
      var layer = scene.layer(i);
      var tag = LML.tag.read(layer);
      if (!tag || tag.kind !== "pin" || tag.mapId !== ${JSON.stringify(mapId)}) continue;
      var position = layer.property("ADBE Transform Group").property("ADBE Position");
      if (position.expressionError) errors.push(layer.name + ": " + position.expressionError);
      var v = position.valueAtTime(${time}, false);
      pins.push([layer.index, v[0], v[1]]);
      names.push(layer.name);
    }
    return LML.json.stringify({ view: view, pins: pins, names: names, errors: errors });`;
}

function toSceneScript(mapId: string, time: number, points: number[][]): string {
  return `
    var mapLayer = LML.pins.findMapLayer(${JSON.stringify(mapId)});
    mapLayer.containingComp.time = ${time};
    var points = ${JSON.stringify(points)}, out = [];
    for (var i = 0; i < points.length; i++) {
      var p = mapLayer.sourcePointToComp([points[i][0], points[i][1]]);
      out.push([p[0], p[1]]);
    }
    return LML.json.stringify(out);`;
}

export async function runAlignment(log: SpikeLog): Promise<Record<string, unknown>> {
  const width = 1920;
  const height = 1080;
  const map = await createMapComp({ name: "P1 alignment", width, height, duration: 4, frameRate: 25, view: viewA });

  // Animate the camera: A at 0 s, B at 3 s.
  await host(`var l = LML.pins.findMapLayer(${JSON.stringify(map.id)}); l.containingComp.time = 0; return "1";`);
  await setView(map.id, viewA, true);
  await host(`var l = LML.pins.findMapLayer(${JSON.stringify(map.id)}); l.containingComp.time = 3; return "1";`);
  await setView(map.id, viewB, true);

  // Pins spread over what the camera sees in both views.
  const pins: { lat: number; lng: number }[] = [];
  let seed = 3;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (const view of [viewA, viewB]) {
    while (pins.length < (view === viewA ? 8 : 14)) {
      const ground = unproject(view, { width, height }, { x: random() * width, y: height * (0.3 + random() * 0.7) });
      if (ground) pins.push(ground);
    }
  }
  const expressionErrors: string[] = [];
  for (const [i, pin] of pins.entries()) {
    const added = await addPin(map.id, pin, { name: `P${i + 1}` });
    expressionErrors.push(...added.expressionErrors);
  }
  // Pins are identified by name ("Pin: P<n>"), since layer indices shift as layers are added.
  const pinForName = (name: string) => {
    const match = /^Pin: P([0-9]+)$/.exec(name);
    if (!match) throw new Error(`unexpected pin layer name ${name}`);
    return pins[Number(match[1]) - 1];
  };

  let worst = 0;
  let checks = 0;
  const compare = async (label: string, times: number[]) => {
    let worstHere = 0;
    for (const time of times) {
      const sample = await host<Sample>(sampleScript(map.id, time));
      expressionErrors.push(...sample.errors);
      const inMapComp = sample.pins.map((_, i) => {
        const q = project(sample.view, { width, height }, pinForName(sample.names[i]));
        return [q.x, q.y];
      });
      const expected = await host<number[][]>(toSceneScript(map.id, time, inMapComp));
      sample.pins.forEach((p, i) => {
        const error = Math.hypot(p[1] - expected[i][0], p[2] - expected[i][1]);
        worstHere = Math.max(worstHere, error);
        checks++;
      });
    }
    worst = Math.max(worst, worstHere);
    log(`P1 ${label}: worst error ${worstHere.toFixed(6)} px`, worstHere < 0.5 ? "ok" : "fail");
    return worstHere;
  };

  const times = [0, 0.8, 1.5, 2.2, 3];
  const plain = await compare("animated camera, identity map layer", times);

  await host(`
    var l = LML.pins.findMapLayer(${JSON.stringify(map.id)});
    var t = l.property("ADBE Transform Group");
    t.property("ADBE Scale").setValue([55, 55]);
    t.property("ADBE Position").setValue([700, 480]);
    t.property("ADBE Rotate Z").setValue(-12);
    return "1";`);
  const transformed = await compare("map layer moved, scaled and rotated", [0.8, 2.2]);

  await host(`
    var l = LML.pins.findMapLayer(${JSON.stringify(map.id)});
    l.name = "Renamed map layer";
    l.source.name = "Renamed map comp";
    return "1";`);
  const renamed = await compare("after renaming the map layer and comp", [1.5]);

  const passed = worst < 0.5 && expressionErrors.length === 0;
  log(`P1 pins: ${pins.length}, comparisons ${checks}, expression errors ${expressionErrors.length}`, passed ? "ok" : "fail");
  return { pins: pins.length, checks, worstErrorPx: worst, plain, transformed, renamed, expressionErrors, passed };
}
