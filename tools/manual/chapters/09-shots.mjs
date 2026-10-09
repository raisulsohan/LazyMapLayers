// Chapter 9: the Shots tab. Three shots across the Mediterranean, with a Fly, an Along route and a hold.

export async function run(s) {
  await s.newMap("Mediterranean", { center: { lat: 41.9, lng: 12.5 }, zoom: 9.6, bearing: 0, pitch: 0 }, { duration: 14, globe: true });
  await s.click("tab-shots");
  await s.shot("09-empty");
  await s.view({ center: { lat: 41.9, lng: 12.5 }, zoom: 9.6, bearing: 0, pitch: 30 }, 1500);
  await s.js(`(window.lmlDebug.store.lastPlaceName.value = "Rome", true)`);
  await s.click("shot-add");
  await s.view({ center: { lat: 37.98, lng: 23.73 }, zoom: 10, bearing: -20, pitch: 45 }, 1500);
  await s.js(`(window.lmlDebug.store.lastPlaceName.value = "Athens", true)`);
  await s.click("shot-add");
  await s.view({ center: { lat: 31.2, lng: 29.92 }, zoom: 10.2, bearing: 15, pitch: 40 }, 1500);
  await s.js(`(window.lmlDebug.store.lastPlaceName.value = "Alexandria", true)`);
  await s.click("shot-add");
  await s.shot("09-three-shots", { mark: ["shot-add", "move-1", "shot-1", "shot-apply"] });
  // The first move: Fly, 4 s, Cinematic.
  await s.click("move-1");
  await s.js(`(() => { const set = (sel, v) => { const i = document.querySelector(sel); i.value = String(v); i.dispatchEvent(new Event("change", { bubbles: true })); }; set(".editor input[type=number]", 4); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await s.clickText("Cinematic");
  await s.shot("09-move-editor", { mark: [".editor .chips", ".editor .easing"] });
  await s.click("move-1");
  // The second move: Along route, Turn with the route.
  await s.click("move-2");
  await s.clickText("Along route");
  await s.js(`(() => { const set = (sel, v) => { const i = document.querySelector(sel); i.value = String(v); i.dispatchEvent(new Event("change", { bubbles: true })); }; set(".editor input[type=number]", 5); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await s.js(`(() => { const l = [...document.querySelectorAll(".editor label.check")].find((x) => x.textContent.includes("Turn with the route")); l.querySelector("input").click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await s.shot("09-route-move");
  await s.click("move-2");
  // The last shot holds and orbits.
  // Select the last shot (the shot just added is selected already; a click would close it).
  await s.js(`(() => { const sh = window.lmlDebug.shots; const list = sh.shotList.value.shots; sh.selectedShot.value = list[list.length - 1].id; return true; })()`);
  await new Promise((r) => setTimeout(r, 400));
  const field = (label, value) =>
    s.js(`(() => { const l = [...document.querySelectorAll(".editor label.num-field")].find((x) => x.querySelector("span") && x.querySelector("span").textContent.trim() === ${JSON.stringify(label)}); if (!l) throw new Error("no field ${label}"); const i = l.querySelector("input"); i.value = String(${value}); i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await field("Hold", 2);
  await new Promise((r) => setTimeout(r, 300));
  await field("Orbit", 30);
  await new Promise((r) => setTimeout(r, 300));
  await s.shot("09-shot-editor");
  await s.js(`(window.lmlDebug.shots.selectedShot.value = null, true)`);
  await s.click("shot-apply");
  await s.idle();
  await s.shot("09-applied", { mark: ["shot-apply"] });
  await s.preview();
  await s.gif("09-shots-route", { start: 8, duration: 5 });
  await s.strip("09-three-moves", [
    { time: 1, label: "Rome" },
    { time: 4, label: "Fly, Cinematic" },
    { time: 10.5, label: "Along route" },
    { time: 14.5, label: "Alexandria, orbit" }
  ], { width: 1600 });
}
