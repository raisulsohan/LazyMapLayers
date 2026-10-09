// Chapter 5: map settings: name, basemap, globe, and a second map following the first (an overview
// in the corner).

export async function run(s) {
  await s.newMap("Europe", { center: { lat: 48.5, lng: 10 }, zoom: 3.6, bearing: 0, pitch: 0 }, { duration: 6, globe: true });
  await s.js(`(window.lmlDebug.store.screen.value = "settings", true)`);
  await s.shot("05-settings", { mark: ["basemap", ".screen label.check", "follow-map"] });
  await s.js(`(window.lmlDebug.store.screen.value = "main", true)`);
  // The globe turning into the flat map: key a flight from space into Germany.
  await s.view({ center: { lat: 30, lng: 0 }, zoom: 1.4, bearing: 0, pitch: 0 }, 1500);
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 50.1, lng: 8.7 }, zoom: 7.5, bearing: 0, pitch: 30 }, 1500);
  await s.store("(store.flightSeconds.value = 4, true)");
  await s.click("fly-here");
  await s.idle();
  await s.preview();
  await s.gif("05-globe-to-flat", { start: 0, duration: 5 });
  // A second map in the same comp, as an overview in the corner that follows the first.
  await s.view({ center: { lat: 50.1, lng: 8.7 }, zoom: 4.5, bearing: 0, pitch: 0 }, 1200);
  await s.js(`(window.lmlDebug.store.screen.value = "newMap", true)`);
  await new Promise((r) => setTimeout(r, 800));
  await s.type(`[data-id="new-map-name"]`, "Overview");
  await s.shot("05-new-map-into-comp", { mark: [".screen label.check"] });
  await s.click("create-map");
  await s.idle();
  // Scale the overview into the top-right corner with a frame-like stroke left to the user.
  await s.ae(`(function () { var c = app.project.activeItem; for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i); if (l.name === "Overview") { l.property("ADBE Transform Group").property("ADBE Scale").setValue([30, 30]); l.property("ADBE Transform Group").property("ADBE Position").setValue([c.width - c.width * 0.17 - 40, c.height * 0.17 + 40]); } } return "ok"; })()`);
  await s.js(`(window.lmlDebug.store.screen.value = "settings", true)`);
  await new Promise((r) => setTimeout(r, 800));
  const first = await s.js(`window.lmlDebug.store.maps.value.find((m) => m.mapCompName === "Europe").mapId`);
  await s.set("follow-map", first);
  await s.idle();
  await s.set("follow-zoom", -3);
  await s.idle();
  await s.set("follow-pitch", false);
  await s.idle();
  await s.shot("05-follow", { mark: ["follow-map", "follow-zoom", "follow-bearing", "follow-pitch"] });
  await s.js(`(window.lmlDebug.store.screen.value = "main", true)`);
  await s.preview();
  const europe = await s.js(`window.lmlDebug.store.maps.value.find((m) => m.mapCompName === "Europe").mapId`);
  await s.js(`(window.lmlDebug.store.selectMap(${JSON.stringify(europe)}), true)`);
  await s.idle();
  await s.preview();
  await s.gif("05-overview-follows", { start: 0, duration: 5 });
}
