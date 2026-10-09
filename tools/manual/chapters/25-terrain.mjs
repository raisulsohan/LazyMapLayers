// Chapter 25: terrain with the world elevation pack that comes with the panel: shaded slopes and
// 3D height over the Himalaya, with the Terrain Height slider keyed so the mountains rise.

export async function run(s) {
  await s.newMap("Himalaya", { center: { lat: 27.6, lng: 86.9 }, zoom: 7.2, bearing: -15, pitch: 68 }, { duration: 5 });
  await s.click("look");
  await new Promise((r) => setTimeout(r, 500));
  // The satellite picture shows the rising ground best.
  await s.click("theme-satellite");
  await s.idle();
  await s.set("terrain-pack", "world");
  await s.idle();
  await s.set("terrain-height", 40);
  await s.idle();
  await s.js(`(document.querySelector('[data-id="terrain-pack"]').scrollIntoView({ block: "center" }), true)`);
  await s.shot("25-terrain-sheet", { mark: ["terrain-pack", "terrain-download", "terrain-height", "terrain-ground"] });
  // Key the map layer's Terrain Height from flat to 4x.
  await s.ae(`(function () {
    var c = app.project.activeItem;
    for (var i = 1; i <= c.numLayers; i++) {
      var e = c.layer(i).property("ADBE Effect Parade").property("Terrain Height");
      if (e) { var p = e.property(1); p.setValueAtTime(0.3, 0); p.setValueAtTime(3.8, 4); return "ok"; }
    }
    return "no slider";
  })()`);
  await s.preview();
  await s.gif("25-mountains-rise", { start: 0, duration: 5 });
  await s.still("25-terrain-still", { time: 4.5 });
  // Shaded slopes alone, flat, looking down.
  await s.set("terrain-height", 0);
  await s.idle();
}
