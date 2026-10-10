// Historical borders (1.1): the year list, 1914, the partition 1945 to 1947 keyed with the year on
// screen and Auto labels, Shift+click on an empire, and the Past list in the feature browser.
// Needs the history pack in the user data folder (history-3 or newer); it never downloads it.

const scrollTo = (s, id) => s.js(`(document.querySelector('[data-id="${id}"]').scrollIntoView({ block: "center" }), true)`);

export async function run(s) {
  await s.newMap("Partition", { center: { lat: 24, lng: 80 }, zoom: 3.9, bearing: 0, pitch: 25 }, { duration: 6 });
  await s.click("look");
  await new Promise((r) => setTimeout(r, 600));
  if (!(await s.js(`!!document.querySelector('[data-id="history-year"]')`))) throw new Error("no historical pack on this computer; download it first");

  // 1914 on Atlas, the empires and their colonies.
  await s.click("theme-atlas");
  await s.idle();
  await s.set("history-year", 1914);
  await s.idle();
  await scrollTo(s, "history-year");
  await s.shot("hb-sheet", { mark: ["history-year", "history-to", "history-year-add"] });
  await s.view({ center: { lat: 15, lng: 40 }, zoom: 1.9, bearing: 0, pitch: 0 }, 2000);
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.still("hb-1914", { time: 1 });

  // Shift+click a colony of 1914 with the Highlight tool: every land of its ruling power.
  await s.click("tool-highlight");
  await s.click("level-country");
  await s.clickMap(22, 79, { shift: true });
  await s.idle();
  await s.preview();
  await s.still("hb-power", { time: 1 });

  // The Past list, filtered by ruler.
  await s.click("feature-browse");
  await new Promise((r) => setTimeout(r, 600));
  await s.click("feature-scope-history");
  await s.type(`[data-id="feature-filter"]`, "ruler = France");
  await new Promise((r) => setTimeout(r, 800));
  await s.shot("hb-past", { mark: ["feature-scope-history", "feature-filter"] });
  await s.click("feature-close");
  await s.store("store.setHighlights([])");
  await s.idle();
  await s.store(`(store.tool.value = "none", true)`);

  // The partition: 1945 at the start, 1947 at the end, the year on screen, Midnight, names by year.
  await s.click("look");
  await new Promise((r) => setTimeout(r, 400));
  if (!(await s.js(`!!document.querySelector('[data-id="look-sheet"]')`))) await s.click("look");
  await s.click("theme-midnight");
  await s.idle();
  await s.set("history-year", 1945);
  await s.idle();
  await s.set("history-to", 1947);
  await s.idle();
  // Arrive at 1947 at 4.5 s instead of the comp's last frame, so the shot holds on 1947.
  await s.ae(`(function () {
    var c = app.project.activeItem;
    for (var i = 1; i <= c.numLayers; i++) {
      var e = c.layer(i).property("ADBE Effect Parade").property("History Year");
      if (e && e.property(1).numKeys >= 2) { var p = e.property(1); var v = p.keyValue(2); p.removeKey(2); p.setValueAtTime(4.5, v); return "ok"; }
    }
    return "no keys";
  })()`);
  await s.time(0);
  await s.click("history-year-add");
  await s.idle();
  await scrollTo(s, "history-to");
  // The keys line comes once the panel has read the slider back; wait for it a moment.
  for (let i = 0; i < 20 && !(await s.js(`!!document.querySelector('[data-id="history-keys"]')`)); i++) await new Promise((r) => setTimeout(r, 300));
  const keysShown = await s.js(`!!document.querySelector('[data-id="history-keys"]')`);
  await s.shot("hb-move-to", { mark: ["history-year", "history-to", "history-year-add", ...(keysShown ? ["history-keys", "history-hold"] : [])] });
  await s.view({ center: { lat: 24, lng: 80 }, zoom: 3.9, bearing: 0, pitch: 25 }, 1500);
  await s.click("keyframe");
  await s.idle();
  await s.time(5.9);
  await s.view({ center: { lat: 25, lng: 82 }, zoom: 4.3, bearing: 0, pitch: 30 }, 1500);
  await s.click("keyframe");
  await s.idle();
  await s.click("tool-labels");
  await s.click("place-labels");
  await s.idle();
  await s.preview();
  await s.gif("hb-partition", { start: 0, duration: 6, fps: 10 });
}
