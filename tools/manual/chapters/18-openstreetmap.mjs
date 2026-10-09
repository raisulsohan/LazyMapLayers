// Chapter 18: finding things on OpenStreetMap (goes online: one Overpass query for the Danube in
// Budapest). Run only when Sohan has agreed to the online chapters.

export const online = true;

export async function run(s) {
  await s.newMap("Budapest", { center: { lat: 47.5, lng: 19.05 }, zoom: 11.3, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.click("tool-osm");
  await s.type(`[data-id="osm-text"]`, "Duna");
  await s.set("osm-kind", "water");
  await s.shot("18-osm-sheet", { mark: ["osm-text", "osm-kind", "osm-find"] });
  await s.click("osm-find");
  await s.idle(180000);
  await s.shot("18-osm-result", { mark: ["import-sheet"] });
  await s.time(0.3);
  await s.js(`(() => { const i = document.querySelector('[data-id="import-sheet"] input[type=number]'); i.value = "4"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  // Draw the longest line called just "Duna": the main river through the city.
  await s.js(`(() => { const rows = [...document.querySelectorAll('[data-id="import-sheet"] .import-row')]; const row = rows.find((r) => /^Duna ·/.test(r.textContent.trim())) || rows[0]; [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === "Draw").click(); return true; })()`);
  await s.idle();
  await s.preview();
  await s.gif("18-osm-river", { start: 0, duration: 5 });
}
