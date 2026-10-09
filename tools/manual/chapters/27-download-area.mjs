// Chapter 27: downloading an area. The sheet is shown and cancelled (nothing is downloaded); the
// flight uses the Paris area already on this computer.

export async function run(s) {
  await s.newMap("Paris", { center: { lat: 48.86, lng: 2.33 }, zoom: 11.5, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.click("download-area");
  await new Promise((r) => setTimeout(r, 800));
  await s.type(`[data-id="region-sheet"] input`, "paris-centre", true);
  await new Promise((r) => setTimeout(r, 500));
  await s.shot("27-region-sheet", { mark: ["region-sheet"] });
  await s.js(`(() => { [...document.querySelectorAll('[data-id="region-sheet"] button')].find((b) => b.textContent.trim() === "Cancel").click(); return true; })()`);
  // A flight from the world into the downloaded Paris: the streets and buildings take over.
  await s.set("basemap", "region:paris");
  await s.idle();
  await s.view({ center: { lat: 48.86, lng: 2.33 }, zoom: 9, bearing: 0, pitch: 0 }, 1500);
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 48.8584, lng: 2.2945 }, zoom: 15.6, bearing: 30, pitch: 60 }, 2000);
  await s.store("(store.flightSeconds.value = 5, true)");
  await s.click("fly-here");
  await s.idle();
  await s.shot("27-basemap-region", { mark: ["basemap"] });
  await s.preview();
  await s.gif("27-into-paris", { start: 0, duration: 5.5 });
  await s.still("27-paris-street", { time: 5.5 });
}
