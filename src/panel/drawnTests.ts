// DR1: a path drawn with the Pen tool becomes a route that follows the map.
//
// A shape layer (a curved path inside a moved, scaled and turned group, on a moved and turned layer)
// and a solid with a mask are drawn over a map while its camera moves. Read at 1 s, the path's ends
// come back as Dhaka and Chittagong and its curve is kept; the mask comes back as an area around
// Dhaka. The line drawn as a route lies on the drawing at 1 s and on the map at 0 s, where the
// camera is elsewhere and the drawing is not. On a globe, a line from Dhaka to Tokyo comes back too.

import { project, type View } from "../core/camera/camera.ts";
import { projectPoint } from "../core/camera/globe.ts";
import { importGeoJson } from "../core/data/importLines.ts";
import { drawnPathsToGeoJson, intoTransform, type DrawnPaths, type Transform2D } from "../core/geo/drawnPaths.ts";
import { callHost, evalScript } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { addRouteLine } from "./overlays/routeCallout.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

export async function runDrawnPathTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const dhaka = { lat: 23.81, lng: 90.41 };
  const chittagong = { lat: 22.34, lng: 91.83 };
  const start: View = { center: { lat: 23.2, lng: 90.9 }, zoom: 7.2, bearing: 0, pitch: 0 };
  const drawnAt: View = { center: { lat: 23.1, lng: 91.1 }, zoom: 7.6, bearing: 20, pitch: 35 };
  const out: Record<string, unknown> = {};
  try {
    const map = await createMapComp({ name: "DR1 drawing", ...SIZE, duration: 4, frameRate: 25, view: start, newScene: true });
    for (const [name, a, b] of [["Latitude", start.center.lat, drawnAt.center.lat], ["Longitude", start.center.lng, drawnAt.center.lng], ["Zoom", start.zoom, drawnAt.zoom], ["Bearing", start.bearing, drawnAt.bearing], ["Pitch", start.pitch, drawnAt.pitch]] as const) {
      await callHost("setControlKeys", { mapId: map.id, name, times: [0, 1], values: [a, b] });
    }
    // Where the ends lie at 1 s, carried back through the transforms the drawing will have.
    const layerT: Transform2D = { anchor: [40, 25], position: [660, 350], scale: [110, 110], rotation: -12 };
    const groupT: Transform2D = { anchor: [0, 0], position: [30, -20], scale: [80, 80], rotation: 10 };
    const inPath = (p: { x: number; y: number }) => intoTransform(groupT, intoTransform(layerT, [p.x, p.y]));
    const a = project(drawnAt, SIZE, dhaka);
    const b = project(drawnAt, SIZE, chittagong);
    const va = inPath(a);
    const vb = inPath(b);
    const bend = [-(vb[1] - va[1]) * 0.3, (vb[0] - va[0]) * 0.3];
    const box0 = intoTransform(layerT, [a.x - 40, a.y - 30]);
    const box1 = intoTransform(layerT, [a.x + 40, a.y + 30]);
    await host(`
      var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
      var scene = mapLayer.containingComp;
      app.beginUndoGroup("DR1 drawing");
      try {
        var layer = scene.layers.addShape();
        layer.name = "My road";
        var t = layer.property("ADBE Transform Group");
        t.property("ADBE Anchor Point").setValue(${JSON.stringify(layerT.anchor)});
        t.property("ADBE Position").setValue(${JSON.stringify(layerT.position)});
        t.property("ADBE Scale").setValue(${JSON.stringify(layerT.scale)});
        t.property("ADBE Rotate Z").setValue(${layerT.rotation});
        var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var gt = group.property("ADBE Vector Transform Group");
        gt.property("ADBE Vector Position").setValue(${JSON.stringify(groupT.position)});
        gt.property("ADBE Vector Scale").setValue(${JSON.stringify(groupT.scale)});
        gt.property("ADBE Vector Rotation").setValue(${groupT.rotation});
        var pathGroup = group.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
        var shape = new Shape();
        shape.vertices = [${JSON.stringify(va)}, ${JSON.stringify(vb)}];
        shape.inTangents = [[0, 0], ${JSON.stringify(bend)}];
        shape.outTangents = [${JSON.stringify(bend)}, [0, 0]];
        shape.closed = false;
        pathGroup.property("ADBE Vector Shape").setValue(shape);
        group.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
        var solid = scene.layers.addSolid([1, 0.5, 0], "My area", scene.width, scene.height, 1, scene.duration);
        var st = solid.property("ADBE Transform Group");
        st.property("ADBE Anchor Point").setValue(${JSON.stringify(layerT.anchor)});
        st.property("ADBE Position").setValue(${JSON.stringify(layerT.position)});
        st.property("ADBE Scale").setValue(${JSON.stringify(layerT.scale)});
        st.property("ADBE Rotate Z").setValue(${layerT.rotation});
        var mask = solid.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        var ring = new Shape();
        ring.vertices = [${JSON.stringify(box0)}, [${box1[0]}, ${box0[1]}], ${JSON.stringify(box1)}, [${box0[0]}, ${box1[1]}]];
        ring.closed = true;
        mask.property("ADBE Mask Shape").setValue(ring);
        for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = false;
        layer.selected = true;
        solid.selected = true;
        scene.openInViewer();
        scene.time = 1;
      } finally {
        app.endUndoGroup();
      }
      return "1";`);
    const found = await callHost<DrawnPaths>("readDrawnPaths", { mapId: map.id });
    out.time = found.time;
    out.skipped = found.skipped;
    check(Math.abs(found.time - 1) < 1e-6, `the drawing was read at ${found.time} s, not 1 s`);
    check(Math.abs(found.view.bearing - drawnAt.bearing) < 1e-6 && Math.abs(found.view.zoom - drawnAt.zoom) < 1e-6, `the camera of the moment is ${JSON.stringify(found.view)}`);
    const { collection, offGround } = drawnPathsToGeoJson(found, "mercator");
    check(offGround.length === 0, `${offGround.join(", ")} came out off the ground`);
    const road = collection.features.find((f) => f.properties.name === "My road");
    const area = collection.features.find((f) => f.properties.name === "My area");
    check(!!road && road.geometry.type === "LineString", "the road did not come back as a line");
    check(!!area && area.geometry.type === "Polygon", "the mask did not come back as an area");
    const near = (p: number[], q: { lat: number; lng: number }, slack = 0.01) => Math.abs(p[0] - q.lng) < slack && Math.abs(p[1] - q.lat) < slack;
    if (road && road.geometry.type === "LineString") {
      const coords = road.geometry.coordinates;
      out.road = [coords[0], coords[coords.length - 1], coords.length];
      check(near(coords[0], dhaka), `the road starts at ${coords[0]}, not in Dhaka`);
      check(near(coords[coords.length - 1], chittagong), `the road ends at ${coords[coords.length - 1]}, not in Chittagong`);
      // The curve is kept: its middle lies well off the straight line between the ends.
      const mid = coords[Math.floor(coords.length / 2)];
      const midPx = project(drawnAt, SIZE, { lng: mid[0], lat: mid[1] });
      const off = Math.abs((b.x - a.x) * (a.y - midPx.y) - (a.x - midPx.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
      out.bend = off;
      check(off > 20, `the middle of the road is only ${off.toFixed(1)} px off the straight line`);
    }
    if (area && area.geometry.type === "Polygon") {
      const ring = area.geometry.coordinates[0];
      const lngs = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      check(Math.min(...lngs) < dhaka.lng && Math.max(...lngs) > dhaka.lng && Math.min(...lats) < dhaka.lat && Math.max(...lats) > dhaka.lat, "the area is not around Dhaka");
    }
    // The road drawn as a route: on the drawing at 1 s, on the map at 0 s.
    const data = importGeoJson(collection, "Drawn: My road");
    const line = data.lines.find((l) => l.name === "My road");
    check(!!line, "the importer did not read the road");
    if (line) {
      const made = await addRouteLine(map.id, line.points, { name: "Route: My road", startFrame: 25, endFrame: 50 });
      check(made.expressionErrors.length === 0, `route expression errors: ${made.expressionErrors.join("; ")}`);
      const ends = await host<{ at1: number[][]; at0: number[][] }>(`
        var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, route = null;
        for (var i = 1; i <= scene.numLayers; i++) {
          var t = LML.tag.read(scene.layer(i));
          if (t && t.kind === "route" && scene.layer(i).name === "Route: My road") route = scene.layer(i);
        }
        var shape = route.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Shape - Group").property("ADBE Vector Shape");
        // The path lies in the route layer's own space: into the comp through its position and anchor.
        var tr = route.property("ADBE Transform Group");
        var at = function (v, time) {
          var pos = tr.property("ADBE Position").valueAtTime(time, false), anchor = tr.property("ADBE Anchor Point").valueAtTime(time, false);
          return [v[0] + pos[0] - anchor[0], v[1] + pos[1] - anchor[1]];
        };
        var one = shape.valueAtTime(1, false).vertices, zero = shape.valueAtTime(0, false).vertices;
        return LML.json.stringify({ at1: [at(one[0], 1), at(one[one.length - 1], 1)], at0: [at(zero[0], 0), at(zero[zero.length - 1], 0)] });`);
      const d1 = Math.max(Math.hypot(ends.at1[0][0] - a.x, ends.at1[0][1] - a.y), Math.hypot(ends.at1[1][0] - b.x, ends.at1[1][1] - b.y));
      const p0 = project(start, SIZE, dhaka);
      const d0 = Math.hypot(ends.at0[0][0] - p0.x, ends.at0[0][1] - p0.y);
      out.route = { onDrawingAt1: d1, onMapAt0: d0, movedBy: Math.hypot(ends.at0[0][0] - a.x, ends.at0[0][1] - a.y) };
      check(d1 < 2, `at 1 s the route is ${d1.toFixed(2)} px off the drawing`);
      check(d0 < 2, `at 0 s the route is ${d0.toFixed(2)} px off Dhaka on the map`);
      check(Math.hypot(ends.at0[0][0] - a.x, ends.at0[0][1] - a.y) > 20, "the camera move did not move the route");
    }

    // On the globe.
    const globeView: View = { center: { lat: 30, lng: 112 }, zoom: 2.4, bearing: 0, pitch: 20 };
    const globe = await createMapComp({ name: "DR1 drawing globe", ...SIZE, duration: 1, frameRate: 25, view: globeView, newScene: true, projection: "globe" });
    const tokyo = { lat: 35.68, lng: 139.69 };
    const ga = projectPoint(globeView, SIZE, dhaka, { projection: "globe" });
    const gb = projectPoint(globeView, SIZE, tokyo, { projection: "globe" });
    await host(`
      var scene = LML.pins.findMapLayer(${JSON.stringify(globe.id)}).containingComp;
      var layer = scene.layers.addShape();
      layer.name = "Flight";
      layer.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
      var pathGroup = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
      var shape = new Shape();
      shape.vertices = [[${ga.x}, ${ga.y}], [${gb.x}, ${gb.y}]];
      shape.closed = false;
      pathGroup.property("ADBE Vector Shape").setValue(shape);
      for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = false;
      layer.selected = true;
      scene.openInViewer();
      scene.time = 0;
      return "1";`);
    const onGlobe = drawnPathsToGeoJson(await callHost<DrawnPaths>("readDrawnPaths", { mapId: globe.id }), "globe").collection.features[0];
    check(!!onGlobe && onGlobe.geometry.type === "LineString", "the flight did not come back from the globe");
    if (onGlobe && onGlobe.geometry.type === "LineString") {
      const coords = onGlobe.geometry.coordinates;
      out.globe = [coords[0], coords[coords.length - 1]];
      check(near(coords[0], dhaka, 0.05) && near(coords[coords.length - 1], tokyo, 0.05), `the flight runs ${JSON.stringify(out.globe)}`);
    }
    // Nothing selected: a clear message, not a crash.
    let message = "";
    try {
      await host(`var scene = LML.pins.findMapLayer(${JSON.stringify(globe.id)}).containingComp; for (var i = 1; i <= scene.numLayers; i++) scene.layer(i).selected = false; return "1";`);
      await callHost("readDrawnPaths", { mapId: globe.id });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    check(message.indexOf("Pen tool") >= 0, `with nothing selected: "${message}"`);
  } catch (error) {
    problems.push(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  const passed = problems.length === 0;
  log(`DR1 drawn paths: ${JSON.stringify(out)}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, ...out };
}
