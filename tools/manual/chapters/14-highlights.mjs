// Chapter 14: highlights: countries, provinces, districts, a shape layer, merge, grow, circle.

export async function run(s) {
  await s.newMap("Mekong", { center: { lat: 15, lng: 103 }, zoom: 4.7, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.click("tool-highlight");
  await s.shot("14-highlight-sheet", { mark: ["level-country", "level-province", "level-district", "feature-browse"] });
  for (const [lat, lng] of [[15.5, 101], [13.5, 105], [19, 102.5], [16, 107.5]]) {
    await s.clickMap(lat, lng);
    await s.idle();
  }
  await s.shot("14-four-countries", { mark: ["highlight-sheet"] });
  // Each highlight renders as its own layer; give them a stagger in After Effects and render.
  await s.preview();
  // The highlight layers live in the map comp, under the map layer's source.
  await s.ae(`(function () { var scene = app.project.activeItem; var c = null; for (var k = 1; k <= scene.numLayers; k++) if (scene.layer(k).source instanceof CompItem) { c = scene.layer(k).source; break; } var n = 0; for (var i = c.numLayers; i >= 1; i--) { var l = c.layer(i); if (/^Highlight/.test(l.name)) { var o = l.property("ADBE Transform Group").property("ADBE Opacity"); o.setValueAtTime(0.4 + n * 0.6, 0); o.setValueAtTime(1.0 + n * 0.6, 100); n++; } } return "ok " + n; })()`);
  await s.gif("14-countries-fade-in", { start: 0, duration: 4.5 });
  // A shape layer of one country, drawing on.
  await s.set("shape-draw-on", true);
  await s.time(0);
  const code = await s.js(`window.lmlDebug.store.highlights.value[0].code`);
  await s.shot("14-shape-button", { mark: [`shape-${code}`, "shape-draw-on"] });
  await s.click(`shape-${code}`);
  await s.idle();
  await s.gif("14-shape-draw-on", { start: 0, duration: 4.5 });
  // Adding a shape layer can close the sheet; open the tool again for the next steps.
  await s.store(`(store.tool.value === "highlight" || store.armTool("highlight"), true)`);
  await new Promise((r) => setTimeout(r, 400));
  // Merge into one area, then grow it.
  await s.click("merge-areas");
  await s.idle();
  await s.shot("14-merged", { mark: ["merge-areas"] });
  await s.set("combine-km", 150);
  await s.click("grow-areas");
  await s.idle();
  await s.shot("14-grown", { mark: ["combine-km", "grow-areas"] });
  // Provinces of Vietnam and a 300 km circle around Bangkok, on a fresh look.
  await s.store("store.setHighlights([])");
  await s.idle();
  await s.click("level-province");
  await s.view({ center: { lat: 16, lng: 106.5 }, zoom: 5.6, bearing: 0, pitch: 0 }, 2000);
  for (const [lat, lng] of [[21.03, 105.85], [10.82, 106.63], [16.05, 108.2]]) {
    await s.clickMap(lat, lng);
    await s.idle();
  }
  await s.shot("14-provinces");
  await s.view({ center: { lat: 13.75, lng: 100.5 }, zoom: 5.6, bearing: 0, pitch: 0 }, 2000);
  await s.set("combine-km", 300);
  await s.click("circle-area");
  await s.idle();
  await s.shot("14-circle", { mark: ["circle-area"] });
  // Districts: the sets on this computer.
  await s.click("level-district");
  await s.clickMap(13.75, 100.5);
  await s.idle();
  await s.shot("14-districts", { mark: ["district-sets"] });
  await s.preview();
  await s.still("14-provinces-circle-district", { time: 5 });
}
