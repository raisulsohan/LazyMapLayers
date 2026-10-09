// Chapter 15: the feature browser: search, filter, sort, tick, act.

export async function run(s) {
  await s.newMap("World", { center: { lat: 20, lng: 20 }, zoom: 1.7, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.click("tool-highlight");
  await s.click("feature-browse");
  await new Promise((r) => setTimeout(r, 800));
  await s.shot("15-browser", { mark: ["feature-scope-country", "feature-text", "feature-filter", "feature-sort"] });
  await s.type(`[data-id="feature-filter"]`, "population > 100000000");
  await s.set("feature-sort", "population");
  await s.click("feature-sort-order");
  await new Promise((r) => setTimeout(r, 600));
  await s.shot("15-filtered", { mark: ["feature-filter", "feature-sort", "feature-sort-order"] });
  await s.click("feature-pick-all");
  await s.click("feature-highlight");
  await s.idle();
  await s.shot("15-highlighted", { mark: ["feature-pick-all", "feature-highlight"] });
  // Connect the five largest with lines to their two nearest neighbours.
  await s.time(0.5);
  await s.set("mesh-neighbours", 2);
  await s.click("feature-connect");
  await s.idle();
  await s.preview();
  await s.gif("15-connect", { start: 0, duration: 5 });
  // Provinces of one country: Brazil, the editor of one row.
  await s.click("feature-scope-province");
  await s.set("feature-country", await s.js(`[...document.querySelectorAll('[data-id="feature-country"] option')].find((o) => o.textContent === "Brazil").value`));
  await s.type(`[data-id="feature-filter"]`, "");
  await new Promise((r) => setTimeout(r, 600));
  await s.js(`(document.querySelector('[data-id="feature-edit"]').click(), true)`);
  await new Promise((r) => setTimeout(r, 400));
  await s.shot("15-editor", { mark: ["feature-editor"] });
}
