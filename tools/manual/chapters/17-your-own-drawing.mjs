// Chapter 17: your own drawing: an open Pen path becomes a route, a closed one an area.

export async function run(s) {
  await s.newMap("Caribbean", { center: { lat: 18, lng: -72 }, zoom: 4.6, bearing: 0, pitch: 0 }, { duration: 6 });
  // Comp pixels of a few places, from the preview's own projection.
  const px = (lat, lng) => s.js(`(() => { const p = window.lmlDebug.map().project([${lng}, ${lat}]); return [p.x, p.y]; })()`);
  const open = [await px(25.77, -80.19), await px(23.13, -82.38), await px(18.47, -69.9), await px(18.22, -66.59), await px(13.1, -59.6)];
  const closed = [await px(19.9, -74.5), await px(19.9, -71.7), await px(17.9, -71.7), await px(17.9, -74.5)];
  await s.ae(`(function () {
    var c = app.project.activeItem;
    function shapeLayer(name, points, closed) {
      var l = c.layers.addShape(); l.name = name;
      var g = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
      var p = g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
      // A shape layer sits at the comp's centre: its path is drawn around that point.
      var local = [];
      for (var k = 0; k < points.length; k++) local.push([points[k][0] - c.width / 2, points[k][1] - c.height / 2]);
      var sh = new Shape(); sh.vertices = local; sh.closed = closed;
      var ins = [], outs = [];
      for (var i = 0; i < points.length; i++) { ins.push([0, 0]); outs.push([0, 0]); }
      sh.inTangents = ins; sh.outTangents = outs;
      p.property("ADBE Vector Shape").setValue(sh);
      var st = g.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
      st.property("ADBE Vector Stroke Color").setValue([1, 0.3, 0.6]); st.property("ADBE Vector Stroke Width").setValue(6);
      return l;
    }
    var a = shapeLayer("My cruise", ${JSON.stringify(open)}, false);
    var b = shapeLayer("My zone", ${JSON.stringify(closed)}, true);
    for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
    a.selected = true; b.selected = true;
    return "ok";
  })()`);
  await new Promise((r) => setTimeout(r, 800));
  await s.preview();
  await s.still("17-drawing-in-ae", { time: 0 });
  await s.time(0.3);
  await s.click("tool-drawing");
  await s.idle();
  await s.shot("17-drawing-opened", { mark: ["import-sheet"] });
  await s.js(`(() => { const i = document.querySelector('[data-id="import-sheet"] input[type=number]'); i.value = "4"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await s.click("import-arrow-0");
  await s.idle();
  await s.clickText("Highlight", "import-sheet");
  await s.idle();
  // Hide the drawing; the route and the area follow the map from now on.
  await s.ae(`(function () { var c = app.project.activeItem; for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i); if (l.name === "My cruise" || l.name === "My zone") l.enabled = false; } return "ok"; })()`);
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 19, lng: -70 }, zoom: 5.4, bearing: -15, pitch: 40 }, 1500);
  await s.time(5.9);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.gif("17-drawing-result", { start: 0, duration: 5.5 });
}
