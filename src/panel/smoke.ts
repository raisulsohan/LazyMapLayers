// H1: host smoke test through the real panel ↔ ExtendScript bridge.
// Creates a map comp with a Unicode name, checks tags and controls, keyframes a view, then verifies
// that each action is exactly one undo step.

import { callHost, evalScript } from "./cep.ts";
import type { SpikeLog } from "./spikes.ts";

type Inspection = {
  mapComps: { id: number; name: string; tag: string }[];
  scenes: { name: string; layers: number }[];
  mapLayers: { name: string; tag: string; effects: string[]; keys: number[]; values: number[] }[];
};

const INSPECT = `(function () {
  var out = { mapComps: [], scenes: [], mapLayers: [] };
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (LML.tag.is(item, "mapComp")) out.mapComps.push({ id: item.id, name: item.name, tag: item.comment });
    if (LML.tag.is(item, "scene")) out.scenes.push({ name: item.name, layers: item.numLayers });
  }
  var layers = LML.map.findMapLayers();
  for (var l = 0; l < layers.length; l++) {
    var fx = layers[l].property("ADBE Effect Parade");
    var names = [], keys = [], values = [];
    for (var e = 1; e <= fx.numProperties; e++) {
      names.push(fx.property(e).name);
      keys.push(fx.property(e).property(1).numKeys);
      values.push(fx.property(e).property(1).value);
    }
    out.mapLayers.push({ name: layers[l].name, tag: layers[l].comment, effects: names, keys: keys, values: values });
  }
  return LML.json.stringify(out);
})()`;

async function inspect(): Promise<Inspection> {
  return JSON.parse(await evalScript(INSPECT)) as Inspection;
}

export async function runHostSmoke(log: SpikeLog): Promise<{ passed: number; failed: number; details: string[] }> {
  const details: string[] = [];
  let passed = 0;
  let failed = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) passed++;
    else failed++;
    const line = `${ok ? "PASS" : "FAIL"} H1 ${name}${detail ? `  [${detail}]` : ""}`;
    details.push(line);
    log(line, ok ? "ok" : "fail");
  };

  const ping = await callHost<{ appVersion: string; lml: string }>("ping");
  check("ping through the bridge", !!ping.appVersion, `AE ${ping.appVersion}, host ${ping.lml}`);

  const before = await inspect();
  const name = "Map Tōkyō · ঢাকা · القاهرة";
  const created = await callHost<{ id: string; mapCompName: string; sceneCompName: string }>("createMapComp", {
    name,
    width: 1280,
    height: 720,
    duration: 6,
    frameRate: 30,
    view: { center: { lng: 139.6917, lat: 35.6895 }, zoom: 9.25, bearing: 12.5, pitch: 30 }
  });
  check("createMapComp returns names", created.mapCompName === name, created.mapCompName);

  const afterCreate = await inspect();
  check("one tagged map comp added", afterCreate.mapComps.length === before.mapComps.length + 1);
  const layer = afterCreate.mapLayers[afterCreate.mapLayers.length - 1];
  check("map layer carries its tag", !!layer && layer.tag.indexOf(`"mapId":"${created.id}"`) > 0, layer?.tag);
  check("camera controls exist in order", !!layer && layer.effects.join(",") === "Latitude,Longitude,Zoom,Bearing,Pitch", layer?.effects.join(","));
  const expected = [35.6895, 139.6917, 9.25, 12.5, 30];
  check(
    "control values match the view",
    !!layer && layer.values.every((v, i) => Math.abs(v - expected[i]) < 1e-3),
    layer?.values.join(", ")
  );

  await evalScript(`(function(){ var c = app.project.activeItem; if (c) c.time = 2; return "ok"; })()`);
  await callHost("setView", {
    mapId: created.id,
    keyframe: true,
    view: { center: { lng: 2.2945, lat: 48.8584 }, zoom: 15, bearing: -20, pitch: 60 }
  });
  const afterKey = await inspect();
  const keyed = afterKey.mapLayers[afterKey.mapLayers.length - 1];
  check("keyframe view sets one key per control", !!keyed && keyed.keys.every((k) => k === 1), keyed?.keys.join(","));

  // Edit > Undo is command 16. One undo removes the keyframes, a second removes the map comp.
  await evalScript("app.executeCommand(16)");
  const undoKey = await inspect();
  const unkeyed = undoKey.mapLayers[undoKey.mapLayers.length - 1];
  check("one undo removes the view keyframes", !!unkeyed && unkeyed.keys.every((k) => k === 0), unkeyed?.keys.join(","));
  await evalScript("app.executeCommand(16)");
  const undoCreate = await inspect();
  check("a second undo removes the whole map comp", undoCreate.mapComps.length === before.mapComps.length, `${undoCreate.mapComps.length} map comps`);

  return { passed, failed, details };
}
