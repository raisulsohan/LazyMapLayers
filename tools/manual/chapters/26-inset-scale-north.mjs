// Chapter 26: inset map, scale bar and north arrow, through a turning push-in over New Zealand.

export async function run(s) {
  await s.newMap("New Zealand", { center: { lat: -41, lng: 173 }, zoom: 5.2, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: -41.29, lng: 174.78 }, zoom: 8.2, bearing: 40, pitch: 30 }, 1500);
  await s.time(5.9);
  await s.click("keyframe");
  await s.idle();
  await s.time(0);
  await s.click("look");
  await new Promise((r) => setTimeout(r, 500));
  await s.js(`(document.querySelector('[data-id="scale-bar-add"]').scrollIntoView({ block: "center" }), true)`);
  await s.click("scale-bar-add");
  await s.idle();
  await s.click("north-arrow-add");
  await s.idle();
  await s.set("minimap-zoom-out", 4);
  await s.click("minimap-add");
  await s.idle();
  await s.js(`(document.querySelector('[data-id="scale-bar-add"]').scrollIntoView({ block: "center" }), true)`);
  await s.shot("26-furniture-sheet", { mark: ["scale-bar-add", "scale-bar-units", "scale-bar-corner", "north-arrow-add", "north-letter", "minimap-add", "minimap-zoom-out", "minimap-corner"] });
  // Render both maps: the inset is a map of its own.
  await s.preview();
  const inset = await s.js(`(window.lmlDebug.store.maps.value.find((m) => m.mapId !== window.lmlDebug.selectedMapId()) || {}).mapId`);
  if (inset) {
    const main = await s.js("window.lmlDebug.selectedMapId()");
    await s.js(`(window.lmlDebug.store.selectMap(${JSON.stringify(inset)}), true)`);
    await s.idle();
    await s.preview();
    await s.js(`(window.lmlDebug.store.selectMap(${JSON.stringify(main)}), true)`);
    await s.idle();
  }
  await s.gif("26-furniture", { start: 0, duration: 5.5 });
  await s.still("26-furniture-still", { time: 5 });
}
