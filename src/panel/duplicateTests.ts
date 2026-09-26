// DU1: a scene duplicated in After Effects gets a map of its own.
//
// Ctrl+D on a scene comp copies the map layer with its tag, so both scenes would carry one map id and
// show one map comp: the panel would move and render only the first, and a render of either would
// change both. The panel separates such copies when it reads the map list (31-duplicates.jsx).
//
// Checked here on a real render of every pass: the copy gets a new id, its own map comp and its own
// footage items showing the same frames; the scene's pin moves to the new id with it; the two render
// apart; the original's clean-up keeps the frames an unrendered copy still shows; a map layer copied
// inside its own scene leaves the scene's other layers with the original; and one Undo brings a copy
// back without the panel separating it again.

import type { View } from "../core/camera/camera.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings } from "../core/render/plan.ts";
import { PASS_IDS } from "../core/render/passes.ts";
import { evalScript, fs } from "./cep.ts";
import { addPin, createMapComp, setView } from "./mapApi.ts";
import { runRenderJob, type RenderJobResult } from "./render/renderJob.ts";
import { readMaps } from "./store.ts";
import type { SpikeLog } from "./spikes.ts";

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

type MapState = {
  mapId: string;
  scene: string;
  mapCompId: number;
  footageIds: number[];
  paths: string[];
  pinIds: string[];
};

/** Every map layer in the project with its map comp, footage and the pins in its scene. */
const readState = () =>
  host<MapState[]>(`
    var layers = LML.map.findMapLayers(), out = [];
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i], tag = LML.tag.read(layer), comp = layer.source, scene = layer.containingComp;
      var footageIds = [], paths = [], pins = [];
      for (var l = 1; l <= comp.numLayers; l++) {
        var t = LML.tag.read(comp.layer(l));
        if (!t || t.kind !== "basemap") continue;
        var src = comp.layer(l).source;
        footageIds.push(src.id);
        paths.push(src.mainSource.file ? src.mainSource.file.fsName : "");
      }
      for (var p = 1; p <= scene.numLayers; p++) {
        var pt = LML.tag.read(scene.layer(p));
        if (pt && pt.kind === "pin") pins.push(pt.mapId);
      }
      out.push({ mapId: tag.mapId, scene: scene.name, mapCompId: comp.id, footageIds: footageIds, paths: paths, pinIds: pins });
    }
    return LML.json.stringify(out);`);

const sceneOf = (states: MapState[], scene: string) => states.filter((s) => s.scene === scene);

export async function runDuplicateTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const a: View = { center: { lng: 13.4, lat: 52.5 }, zoom: 4.2, bearing: 0, pitch: 0 };
  const b: View = { center: { lng: 2.35, lat: 48.86 }, zoom: 5.1, bearing: 20, pitch: 20 };
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: [...PASS_IDS] });
  const made: string[] = [];
  const renders: RenderJobResult[] = [];
  const render = async (mapId: string) => {
    const result = await runRenderJob({ mapId, quality: "final", settings, basemap: { kind: "world" } });
    renders.push(result);
    return result;
  };

  try {
    const map = await createMapComp({ name: "DU1 original", width: 640, height: 360, duration: 1, frameRate: 25, view: a, newScene: true });
    made.push(map.sceneCompName);
    await setView(map.id, a, true);
    await addPin(map.id, { lat: 52.52, lng: 13.405 }, { name: "Berlin" });
    await render(map.id);
    const passes = renders[0].sequences.length;
    const before = (await readState()).find((s) => s.mapId === map.id);
    check(!!before && passes > 1 && before.footageIds.length === passes, `the original has ${before ? before.footageIds.length : 0} footage items, not ${passes}`);

    // 1. Ctrl+D on the scene comp.
    const copyName = await host<string>(`var c = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.duplicate(); c.name = "DU1 copy"; return LML.json.stringify(c.name);`);
    made.push(copyName);
    await readMaps();
    let states = await readState();
    const original = sceneOf(states, map.sceneCompName)[0];
    const copy = sceneOf(states, copyName)[0];
    check(!!original && original.mapId === map.id, "the original lost its map id");
    check(!!copy && copy.mapId !== map.id, "the copied scene still carries the original's map id");
    if (original && copy) {
      check(copy.mapCompId !== original.mapCompId, "the copy still shows the original's map comp");
      check(copy.footageIds.length === original.footageIds.length && copy.footageIds.every((id) => original.footageIds.indexOf(id) < 0), "the copy shares footage items with the original");
      check(copy.paths.join("|") === original.paths.join("|"), "the copy's footage does not show the original's frames");
      check(copy.pinIds.length === 1 && copy.pinIds[0] === copy.mapId, `the copy's pin says ${copy.pinIds.join(",")} instead of the copy's id`);
      check(original.pinIds.length === 1 && original.pinIds[0] === map.id, "the original's pin moved away from it");
    }

    // 2. The two render apart.
    if (copy) {
      await host(`var s = LML.pins.findMapLayer(${JSON.stringify(copy.mapId)}).containingComp; s.time = 0; return "1";`);
      await setView(copy.mapId, b, true);
      const copyRender = await render(copy.mapId);
      check(copyRender.rendered > 0, "the copy's own camera drew nothing");
      states = await readState();
      const copyAfter = states.find((s) => s.mapId === copy.mapId);
      const originalAfter = states.find((s) => s.mapId === map.id);
      check(!!copyAfter && !!original && copyAfter.paths.every((p) => original.paths.indexOf(p) < 0), "the copy's render did not get frames of its own");
      check(!!originalAfter && !!original && originalAfter.paths.join("|") === original.paths.join("|"), "rendering the copy changed the original's footage");
    }

    // 3. A second copy, not rendered: the original renders twice more, and its clean-up must leave the
    //    frames this copy still shows.
    const secondName = await host<string>(`var c = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.duplicate(); c.name = "DU1 second copy"; return LML.json.stringify(c.name);`);
    made.push(secondName);
    await readMaps();
    const second = sceneOf(await readState(), secondName)[0];
    check(!!second && second.mapId !== map.id, "the second copy was not separated");
    for (const zoom of [4.6, 5.0]) {
      await host(`var s = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp; s.time = 0; return "1";`);
      await setView(map.id, { ...a, zoom }, true);
      await render(map.id);
    }
    if (second) {
      const missing = second.paths.filter((p) => !fs().existsSync(p));
      check(missing.length === 0, `the original's clean-up deleted ${missing.length} sequences the second copy still shows`);
    }

    // 4. One Undo brings the copy back, and the panel leaves it that way.
    const thirdName = await host<string>(`var c = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.duplicate(); c.name = "DU1 third copy"; return LML.json.stringify(c.name);`);
    made.push(thirdName);
    await readMaps();
    const separatedId = sceneOf(await readState(), thirdName)[0]?.mapId;
    check(!!separatedId && separatedId !== map.id, "the third copy was not separated");
    // Edit > Undo is command 16, as H1 uses it.
    await host(`app.executeCommand(16); return "1";`);
    const undone = sceneOf(await readState(), thirdName)[0];
    check(!!undone && undone.mapId === map.id, "one Undo did not bring the copy back as it was");
    await readMaps();
    const third = sceneOf(await readState(), thirdName)[0];
    check(!!third && third.mapId === map.id, "the panel separated the copy again after the user undid it");
    // 5. A map layer copied inside its own scene: the scene's pin stays with the original.
    // The layer in the original scene: the third copy shares the id again and may be found first.
    await host(`var ls = LML.map.findMapLayers(); for (var i = 0; i < ls.length; i++) { if (ls[i].containingComp.name === ${JSON.stringify(map.sceneCompName)}) { ls[i].duplicate(); break; } } return "1";`);
    await readMaps();
    states = await readState();
    const inScene = sceneOf(states, map.sceneCompName);
    check(inScene.length === 2 && inScene[0].mapId !== inScene[1].mapId, "the map layer copied inside its scene still shares the id");
    check(inScene.every((s) => s.pinIds.length === 1 && s.pinIds[0] === map.id), "the scene's pin left the original map when its layer was copied");

  } finally {
    // Every scene, map comp and footage item of the test, and the frames on disk.
    const ids = new Set<string>();
    try {
      for (const state of await readState()) if (made.indexOf(state.scene) >= 0) ids.add(state.mapId);
    } catch {
      // Clean up what can be found.
    }
    try {
      await host(`
        app.beginUndoGroup("LazyMapLayers: remove the DU1 maps");
        try {
          var ids = ${JSON.stringify([...ids])}, names = ${JSON.stringify(made)}, doomed = [], i;
          var mine = function (id) { for (var k = 0; k < ids.length; k++) if (ids[k] === id) return true; return false; };
          for (i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i), tag = LML.tag.read(item), name = item.name, byName = false;
            for (var n = 0; n < names.length; n++) if (names[n] === name) byName = true;
            if (byName || (tag && ((tag.kind === "mapComp" && mine(tag.id)) || (tag.kind === "basemapFootage" && mine(tag.mapId))))) doomed.push(item);
          }
          for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
        } finally {
          app.endUndoGroup();
        }
        return "1";`);
    } catch {
      // Left in the project; the next run starts a new one.
    }
    for (const result of renders) {
      try {
        fs().rmSync(result.storeRoot, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // Left for the next run.
      }
    }
  }

  const passed = problems.length === 0;
  log(`DU1 copied maps: ${passed ? "each copy gets its own map, renders apart, and keeps its frames" : `${problems.length} problems`}`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, renders: renders.map((r) => ({ rendered: r.rendered, frames: r.frames })) };
}
