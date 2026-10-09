// Chapter 30: numbers as text, and a layer of your own copied onto every place.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Coffee values", { center: { lat: 0, lng: -55 }, zoom: 2.9, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.importFile(sample("coffee-sample.csv"));
  await s.click("data-apply");
  await s.idle();
  await s.js(`(document.querySelector('[data-id="data-values-add"]').scrollIntoView({ block: "center" }), true)`);
  await s.set("values-with-names", true);
  await s.click("data-values-add");
  await s.idle();
  await s.shot("30-values-row", { mark: ["data-values-add", "values-with-names", "data-copies-add", "copies-by-value"] });
  await s.preview();
  await s.still("30-values", { time: 2 });
  await s.click("data-values-remove");
  await s.idle();
  // A cup icon of the user's own, copied onto every place, sized by number.
  await s.ae(`(function () {
    var c = app.project.activeItem;
    var l = c.layers.addShape(); l.name = "My cup";
    var root = l.property("ADBE Root Vectors Group");
    var g = root.addProperty("ADBE Vector Group"); var v = g.property("ADBE Vectors Group");
    var r = v.addProperty("ADBE Vector Shape - Rect"); r.property("ADBE Vector Rect Size").setValue([44, 40]); r.property("ADBE Vector Rect Roundness").setValue(8);
    v.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.96, 0.9, 0.8]);
    var g2 = root.addProperty("ADBE Vector Group"); var v2 = g2.property("ADBE Vectors Group");
    var e = v2.addProperty("ADBE Vector Shape - Ellipse"); e.property("ADBE Vector Ellipse Size").setValue([34, 14]);
    v2.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([0.36, 0.2, 0.1]);
    g2.property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue([0, -14]);
    for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
    l.selected = true;
    return "ok";
  })()`);
  await s.set("copies-by-value", true);
  await s.click("data-copies-add");
  await s.idle();
  await s.ae(`(function () { var c = app.project.activeItem; for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).name === "My cup") c.layer(i).enabled = false; return "ok"; })()`);
  await s.preview();
  await s.still("30-copies", { time: 2 });
}
