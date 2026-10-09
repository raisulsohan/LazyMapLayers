// Chapter 12: routes: plain, with an arrow, a comet, dashed. Lagos to Nairobi to Johannesburg.

const LAGOS = [6.5244, 3.3792];
const NAIROBI = [-1.2921, 36.8219];
const JOBURG = [-26.2041, 28.0473];
const CAIRO = [30.0444, 31.2357];

export async function run(s) {
  await s.newMap("Africa", { center: { lat: 3, lng: 21 }, zoom: 3.3, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.time(0.3);
  await s.click("tool-route");
  await s.shot("12-route-tool", { mark: ["tool-route"] });
  await s.clickMap(...LAGOS);
  await s.shot("12-route-second-click");
  await s.clickMap(...NAIROBI);
  await new Promise((r) => setTimeout(r, 600));
  await s.set("route-arrow", true);
  await s.js(`(() => { const i = document.querySelector('[data-id="tool-sheet"] input[type=number]'); i.value = "4"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await s.shot("12-route-sheet", { mark: ["route-arrow", "tool-route-comet", "tool-route-dashed", "tool-sheet-add"] });
  await s.click("tool-sheet-add");
  await s.idle();
  // A comet from Nairobi to Johannesburg.
  await s.set("route-arrow", false).catch(() => undefined);
  await s.time(1.2);
  await s.click("tool-route");
  await s.clickMap(...NAIROBI);
  await s.clickMap(...JOBURG);
  await new Promise((r) => setTimeout(r, 600));
  await s.set("route-arrow", false);
  await s.set("tool-route-comet", true);
  await s.js(`(() => { const i = document.querySelector('[data-id="tool-sheet"] input[type=number]'); i.value = "3.5"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await s.click("tool-sheet-add");
  await s.idle();
  // A dashed line from Cairo to Nairobi.
  await s.time(0.8);
  await s.click("tool-route");
  await s.clickMap(...CAIRO);
  await s.clickMap(...NAIROBI);
  await new Promise((r) => setTimeout(r, 600));
  await s.set("tool-route-comet", false);
  await s.set("tool-route-dashed", true);
  await s.js(`(() => { const i = document.querySelector('[data-id="tool-sheet"] input[type=number]'); i.value = "4"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await s.click("tool-sheet-add");
  await s.idle();
  await s.set("tool-route-dashed", false).catch(() => undefined);
  await s.preview();
  await s.gif("12-routes", { start: 0, duration: 5.5 });
  await s.still("12-routes-still", { time: 5.5 });
}
