// Chapter 13: attaching your own layers: a star shape and a text layer on Rio de Janeiro.

export async function run(s) {
  await s.newMap("Brazil", { center: { lat: -16, lng: -48 }, zoom: 3.9, bearing: 0, pitch: 0 }, { duration: 6 });
  // Two layers of the user's own: a star and a label, selected in the scene comp.
  await s.ae(`(function () {
    var c = app.project.activeItem;
    var star = c.layers.addShape();
    star.name = "My star";
    var g = star.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var v = g.property("ADBE Vectors Group");
    var p = v.addProperty("ADBE Vector Shape - Star");
    p.property("ADBE Vector Star Type").setValue(1);
    p.property("ADBE Vector Star Points").setValue(5);
    p.property("ADBE Vector Star Outer Radius").setValue(46);
    p.property("ADBE Vector Star Inner Radius").setValue(20);
    v.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([1, 0.82, 0.2]);
    var t = c.layers.addText("Rio de Janeiro");
    t.name = "My label";
    var doc = t.property("ADBE Text Properties").property("ADBE Text Document");
    var d = doc.value; d.fontSize = 44; d.fillColor = [1, 1, 1]; d.applyStroke = true; d.strokeColor = [0, 0, 0]; d.strokeWidth = 4; d.strokeOverFill = false; doc.setValue(d);
    t.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([-70, 14]);
    for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
    star.selected = true; t.selected = true;
    return "ok";
  })()`);
  await s.click("tool-attach");
  await s.click("attach-refresh");
  await s.idle();
  await s.shot("13-attach-sheet", { mark: ["attach-selection", "attach-scale", "attach-rotate"] });
  await s.clickMap(-22.9068, -43.1729);
  await s.idle();
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: -22.95, lng: -43.25 }, zoom: 8.3, bearing: -30, pitch: 45 }, 1500);
  await s.time(5.9);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.gif("13-attach", { start: 0, duration: 5.5 });
  await s.ae(`(function () { var c = app.project.activeItem; for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = c.layer(i).name === "My star"; return "ok"; })()`);
  await s.store(`(store.tool.value === "attach" || store.armTool("attach"), true)`);
  await s.click("attach-refresh");
  await s.idle();
  await s.shot("13-unlink", { mark: ["attach-detach"] });
}
