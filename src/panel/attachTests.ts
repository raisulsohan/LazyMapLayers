// AT1: the user's own layers attached to a place. These are the only layers the panel touches that it
// did not make, so this test watches what it does to them: the layer must land on the place the camera
// maths gives, keep its own comment, size and everything else, keep an expression the user wrote, and
// come back exactly as it was when it is unlinked.

import { project, type View } from "../core/camera/camera.ts";
import { callHost, evalScript } from "./cep.ts";
import { attachLayers, createMapComp, detachLayers, selectionInfo } from "./mapApi.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1920, height: 1080 };
const COMMENT = "my own note";

type LayerState = { comment: string; scale: number[]; position: number[]; rotation: number; opacity: number; effects: string[]; expressions: string[]; tagKind: string | null };

export async function runAttachTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 48.8584, lng: 2.2945 }, zoom: 11.5, bearing: 25, pitch: 40 };
  const map = await createMapComp({ name: "AT1 attach", ...SIZE, duration: 2, frameRate: 25, view, newScene: true });

  // Two layers of the user's own: an "icon" and a "photo", with their own comment, size and rotation.
  await evalScript(`(function () {
    var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp;
    var icon = scene.layers.addSolid([1, 0.4, 0.1], "My icon", 120, 120, 1);
    icon.comment = ${JSON.stringify(COMMENT)};
    icon.property("ADBE Transform Group").property("ADBE Scale").setValue([40, 40]);
    var photo = scene.layers.addSolid([0.1, 0.4, 1], "My photo", 200, 120, 1);
    // The user drives this layer's rotation himself: the panel must leave it alone.
    photo.property("ADBE Transform Group").property("ADBE Rotate Z").expression = "value + 10";
    icon.selected = true;
    photo.selected = true;
    return "1";
  })()`);

  const before = await selectionInfo(map.id);
  if (before.selected !== 2 || before.usable !== 2 || before.attached !== 0) problems.push(`before attaching: ${JSON.stringify(before)}`);

  const place = { lat: 48.8738, lng: 2.295 };
  const attached = await attachLayers(map.id, place, { scaleWithMap: false, rotateWithMap: true });
  if (attached.expressionErrors.length) problems.push(`attach expressions: ${attached.expressionErrors.slice(0, 3).join("; ")}`);
  // After Effects hands its selection back top layer first, whatever order they were selected in.
  if ([...attached.layers].sort().join(",") !== "My icon,My photo") problems.push(`attached: ${attached.layers.join(",")}`);

  const read = async (name: string, time = 0): Promise<LayerState> =>
    JSON.parse(
      await evalScript(`(function () {
        var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, layer = null;
        for (var i = 1; i <= scene.numLayers; i++) if (scene.layer(i).name === ${JSON.stringify(name)}) layer = scene.layer(i);
        if (!layer) return "null";
        var t = layer.property("ADBE Transform Group"), parade = layer.property("ADBE Effect Parade"), effects = [], expressions = [];
        for (var e = 1; e <= parade.numProperties; e++) effects.push(parade.property(e).name);
        var names = ["ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];
        for (var p = 0; p < names.length; p++) if (t.property(names[p]).expressionEnabled) expressions.push(names[p] + "=" + t.property(names[p]).expression.substring(0, 24));
        var tag = LML.tag.read(layer);
        return LML.json.stringify({
          comment: layer.comment,
          scale: t.property("ADBE Scale").valueAtTime(${time}, false),
          position: t.property("ADBE Position").valueAtTime(${time}, false),
          rotation: t.property("ADBE Rotate Z").valueAtTime(${time}, false),
          opacity: t.property("ADBE Opacity").valueAtTime(${time}, false),
          effects: effects,
          expressions: expressions,
          tagKind: tag ? tag.kind : null
        });
      })()`)
    ) as LayerState;

  const icon = await read("My icon");
  const wanted = project(view, SIZE, place);
  const off = Math.hypot(icon.position[0] - wanted.x, icon.position[1] - wanted.y);
  if (off > 0.05) problems.push(`the attached layer is ${off.toFixed(2)} px from the place (${icon.position} against ${[wanted.x, wanted.y]})`);
  if (icon.comment.indexOf(COMMENT) < 0) problems.push(`the layer's own comment is gone: "${icon.comment}"`);
  if (icon.tagKind !== "attached") problems.push(`the layer's tag says ${icon.tagKind}`);
  if (Math.abs(icon.scale[0] - 40) > 1e-6) problems.push(`the layer's size changed to ${icon.scale}`);
  if (Math.abs(icon.rotation - -view.bearing) > 1e-6) problems.push(`the layer turned by ${icon.rotation}, the map's bearing is ${view.bearing}`);
  const expected = ["Map", "Latitude", "Longitude", "Elevation (m)", "Scale with Map", "Rotate with Map", "Reference Zoom"];
  if (icon.effects.join(",") !== expected.join(",")) problems.push(`the layer's effects are ${icon.effects.join(",")}`);

  // The layer whose rotation the user drives keeps his expression; the rest is attached as usual.
  const photo = await read("My photo");
  if (!photo.expressions.some((e) => e.startsWith("ADBE Rotate Z=value + 10"))) problems.push(`the user's own rotation expression was replaced: ${photo.expressions.join(" | ")}`);
  if (photo.expressions.length !== 4 || !photo.expressions.some((e) => e.startsWith("ADBE Position="))) problems.push(`the second layer's expressions: ${photo.expressions.join(" | ")}`);

  // The camera moves: an attached layer follows the place, frame by frame.
  const moved: View = { center: { lat: 48.86, lng: 2.33 }, zoom: 12.6, bearing: -15, pitch: 55 };
  await callHost("setView", { mapId: map.id, view: moved, keyframe: false });
  const afterMove = await read("My icon");
  const wantedAfter = project(moved, SIZE, place);
  const offAfter = Math.hypot(afterMove.position[0] - wantedAfter.x, afterMove.position[1] - wantedAfter.y);
  if (offAfter > 0.05) problems.push(`after the camera moved the layer is ${offAfter.toFixed(2)} px off`);

  // Unlink: everything the panel added goes, and the layer is what it was.
  await evalScript(`(function () {
    var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp;
    for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = scene.layer(i).name === "My icon";
    return "1";
  })()`);
  const undone = await detachLayers(map.id);
  const back = await read("My icon");
  if (undone.layers.join(",") !== "My icon") problems.push(`unlinked: ${undone.layers.join(",")}`);
  if (back.effects.length || back.expressions.length) problems.push(`after unlinking the layer still has ${back.effects.join(",")} and ${back.expressions.join(" | ")}`);
  if (back.comment !== COMMENT) problems.push(`after unlinking the comment is "${back.comment}", expected "${COMMENT}"`);
  if (Math.abs(back.scale[0] - 40) > 1e-6) problems.push(`after unlinking the size is ${back.scale}`);
  const stillAttached = await read("My photo");
  if (stillAttached.tagKind !== "attached") problems.push("unlinking one layer unlinked the other as well");

  const passed = problems.length === 0;
  log(`AT1 attached layers: ${off.toFixed(3)} px off the place, ${offAfter.toFixed(3)} px after the camera moved, the user's own expression and comment kept, unlink clean, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, off, offAfter, effects: icon.effects, problems };
}
