// MF1: the map's furniture. A scale bar that measures itself against the map on every frame, and a
// north arrow that turns with the bearing. Both are checked by reading what After Effects itself
// works out from the expressions, not by trusting the numbers the panel sent.

import type { View } from "../core/camera/camera.ts";
import { metersPerPixel } from "../core/geo/mercator.ts";
import { evalScript } from "./cep.ts";
import { createMapComp, setView } from "./mapApi.ts";
import { addMinimap, addNorthArrow, addScaleBar, removeFurniture, removeMinimap } from "./overlays/furniture.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1920, height: 1080 };

type Inset = { box: { x: number; y: number }[] | null; errors: string[]; layers: string[]; insetWidth: number; insetHeight: number; at: { x: number; y: number } | null };

/** The inset map's layers, and the box After Effects works out on it. */
async function readInset(mapId: string): Promise<Inset> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp;
      var out = { box: null, errors: [], layers: [], insetWidth: 0, insetHeight: 0, at: null };
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag) continue;
        if (tag.kind === "mapLayer" && tag.inset === ${JSON.stringify(mapId)}) {
          out.layers.push("inset");
          out.insetWidth = layer.source.width;
          out.insetHeight = layer.source.height;
          var at = layer.property("ADBE Transform Group").property("ADBE Position").valueAtTime(scene.time, false);
          out.at = { x: at[0], y: at[1] };
        } else if (tag.kind === "minimapFrame" && tag.mapId === ${JSON.stringify(mapId)}) {
          out.layers.push("frame");
        } else if (tag.kind === "minimapBox" && tag.mapId === ${JSON.stringify(mapId)}) {
          out.layers.push("box");
          var path = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Shape");
          if (path.expressionError) out.errors.push("box: " + path.expressionError);
          var shape = path.valueAtTime(scene.time, false), points = [];
          for (var v = 0; v < shape.vertices.length; v++) points.push({ x: shape.vertices[v][0], y: shape.vertices[v][1] });
          out.box = points;
        }
      }
      return LML.json.stringify(out);
    })()`)
  ) as Inset;
}

type Furniture = {
  bar: { x: number; y: number }[] | null;
  distance: string | null;
  north: number | null;
  letter: number | null;
  errors: string[];
  layers: string[];
};

/** What After Effects makes of the furniture's expressions, at the comp's current time. */
async function readFurniture(mapId: string): Promise<Furniture> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp;
      var out = { bar: null, distance: null, north: null, letter: null, errors: [], layers: [] };
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i), tag = LML.tag.read(layer);
        if (!tag || (tag.kind !== "scaleBar" && tag.kind !== "scaleBarText" && tag.kind !== "northArrow" && tag.kind !== "northArrowText")) continue;
        out.layers.push(tag.kind);
        if (tag.kind === "scaleBar") {
          var path = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Shape");
          if (path.expressionError) out.errors.push("bar: " + path.expressionError);
          var shape = path.valueAtTime(scene.time, false), points = [];
          for (var v = 0; v < shape.vertices.length; v++) points.push({ x: shape.vertices[v][0], y: shape.vertices[v][1] });
          out.bar = points;
        } else if (tag.kind === "scaleBarText") {
          var source = layer.property("ADBE Text Properties").property("ADBE Text Document");
          if (source.expressionError) out.errors.push("distance: " + source.expressionError);
          out.distance = source.valueAtTime(scene.time, false).text;
        } else if (tag.kind === "northArrow") {
          var turn = layer.property("ADBE Transform Group").property("ADBE Rotate Z");
          if (turn.expressionError) out.errors.push("north: " + turn.expressionError);
          out.north = turn.valueAtTime(scene.time, false);
        } else {
          var own = layer.property("ADBE Transform Group").property("ADBE Rotate Z");
          if (own.expressionError) out.errors.push("letter: " + own.expressionError);
          out.letter = own.valueAtTime(scene.time, false);
        }
      }
      return LML.json.stringify(out);
    })()`)
  ) as Furniture;
}

/** The metres the bar says it covers. */
function metresOf(text: string | null): number {
  if (!text) return NaN;
  const [shown, unit] = text.split(" ");
  const per: Record<string, number> = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };
  return Number(shown) * (per[unit] ?? NaN);
}

export async function runFurnitureTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 23.8, lng: 90.4 }, zoom: 6.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "MF1 map furniture", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });

  const bar = await addScaleBar(map.id, { theme: "midnight", corner: "bottomLeft" });
  const arrow = await addNorthArrow(map.id, { theme: "midnight", corner: "topRight" });
  for (const problem of [...bar.expressionErrors, ...arrow.expressionErrors]) problems.push(`the host reported ${problem}`);

  const first = await readFurniture(map.id);
  for (const kind of ["scaleBar", "scaleBarText", "northArrow", "northArrowText"]) {
    if (!first.layers.includes(kind)) problems.push(`no ${kind} layer in the scene`);
  }
  for (const problem of first.errors) problems.push(problem);

  // The bar is a bracket, and its length is exactly the ground distance it claims.
  if (!first.bar || first.bar.length !== 4) {
    problems.push(`the bar has ${first.bar ? first.bar.length : 0} points`);
  } else {
    const width = first.bar[2].x;
    if (first.bar[1].x !== 0 || first.bar[1].y !== 0) problems.push(`the bar starts at ${first.bar[1].x}, ${first.bar[1].y}`);
    if (first.bar[0].y >= 0 || first.bar[3].y >= 0) problems.push("the ticks do not point up");
    if (Math.abs(first.bar[3].x - width) > 0.001) problems.push("the far tick is not at the end of the bar");
    const claimed = metresOf(first.distance);
    const real = width * metersPerPixel(view.center.lat, view.zoom);
    if (!(Math.abs(real - claimed) < 0.001 * claimed)) problems.push(`the bar says ${first.distance} and covers ${Math.round(real)} m over ${Math.round(width)} px`);
    if (!(width > 40 && width <= 240)) problems.push(`the bar is ${Math.round(width)} px long`);
  }
  if (Math.abs(first.north ?? 99) > 0.01) problems.push(`north points ${first.north}° on a map with no bearing`);
  if (Math.abs((first.letter ?? 99) + (first.north ?? 0)) > 0.01) problems.push(`the letter is turned ${first.letter}° against an arrow at ${first.north}°`);

  // Turn and zoom the map: the arrow follows the bearing, and the bar re-measures itself.
  const moved: View = { center: { lat: 55.7, lng: 37.6 }, zoom: 11.2, bearing: 37, pitch: 0 };
  await setView(map.id, moved, false);
  const second = await readFurniture(map.id);
  for (const problem of second.errors) problems.push(`after moving, ${problem}`);
  if (Math.abs((second.north ?? 99) + 37) > 0.05) problems.push(`north points ${second.north}° on a map turned 37°`);
  if (second.bar && second.distance) {
    const real = second.bar[2].x * metersPerPixel(moved.center.lat, moved.zoom);
    const claimed = metresOf(second.distance);
    if (!(Math.abs(real - claimed) < 0.001 * claimed)) problems.push(`after zooming the bar says ${second.distance} and covers ${Math.round(real)} m`);
    if (second.distance === first.distance) problems.push(`the bar still says ${second.distance} five zoom levels in`);
  }

  // On the globe the arrow keeps working, and near the pole north is no longer straight up.
  await setView(map.id, { center: { lat: 78, lng: 20 }, zoom: 2.4, bearing: 0, pitch: 0 }, false);
  await evalScript(`(function () {
    var control = LML.pins.findMapLayer(${JSON.stringify(map.id)}).property("ADBE Effect Parade").property("Globe");
    if (control) control.property(1).setValue(1);
    return "1";
  })()`);
  const polar = await readFurniture(map.id);
  for (const problem of polar.errors) problems.push(`near the pole, ${problem}`);
  // At 78° north on the globe the pole is close, and north on screen is no longer straight up.
  if (polar.north === null || !Number.isFinite(polar.north)) problems.push(`north reads ${polar.north} on the globe`);
  else if (Math.abs(polar.north) > 30) problems.push(`north points ${polar.north}° at 78° north`);

  // An inset map in the corner, with a box on it that says where the big map is looking.
  await setView(map.id, view, false);
  const inset = await addMinimap(map.id, { theme: "midnight", corner: "topLeft", zoomOut: 4 });
  for (const problem of inset.expressionErrors) problems.push(`the inset reported ${problem}`);
  const shown = await readInset(map.id);
  for (const kind of ["inset", "frame", "box"]) {
    if (!shown.layers.includes(kind)) problems.push(`no ${kind} layer for the inset`);
  }
  for (const problem of shown.errors) problems.push(problem);
  if (Math.abs(inset.zoom - (view.zoom - 4)) > 0.001) problems.push(`the inset is at zoom ${inset.zoom}`);
  if (!shown.box || shown.box.length < 8) {
    problems.push(`the box has ${shown.box ? shown.box.length : 0} points`);
  } else {
    const xs = shown.box.map((point) => point.x);
    const ys = shown.box.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // Four zooms out, the big map's frame covers a sixteenth of its own size on the inset.
    if (Math.abs(width - SIZE.width / 16) > 1) problems.push(`the box is ${Math.round(width)} px wide, expected ${SIZE.width / 16}`);
    if (Math.abs(height - SIZE.height / 16) > 1) problems.push(`the box is ${Math.round(height)} px tall`);
    // Both maps look at the same place, so the box sits in the middle of the inset.
    if (Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - shown.insetWidth / 2) > 1) problems.push("the box is not on the inset's centre");
  }
  const goneInset = await removeMinimap(map.id);
  if (goneInset.removed !== 3) problems.push(`removing the inset took ${goneInset.removed} layers, expected the map, its frame and its box`);
  if ((await readInset(map.id)).layers.length) problems.push("the inset is still in the scene");

  const goneBar = await removeFurniture(map.id, "scaleBar");
  const goneArrow = await removeFurniture(map.id, "northArrow");
  const left = await readFurniture(map.id);
  if (goneBar.removed !== 2) problems.push(`removing the scale bar took ${goneBar.removed} layers, expected the bar and its text`);
  if (goneArrow.removed !== 2) problems.push(`removing the north arrow took ${goneArrow.removed} layers, expected the arrow and its letter`);
  if (left.layers.length) problems.push(`${left.layers.length} furniture layers are still in the scene`);

  const passed = problems.length === 0;
  log(`MF1 map furniture: bar "${first.distance}" then "${second.distance}", north ${first.north}° then ${second.north}°, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, first, second, polarNorth: polar.north, inset: { zoom: inset.zoom, points: shown.box ? shown.box.length : 0 }, problems };
}
