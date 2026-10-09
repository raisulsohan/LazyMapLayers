// Chapter 20: Auto labels: kinds, languages, how many, keep-out zones, restyling.

const language = (s, value) =>
  s.js(`(() => { const sel = [...document.querySelectorAll('[data-id="labels-sheet"] select')][0]; sel.value = ${JSON.stringify(value)}; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);

export async function run(s) {
  await s.newMap("Gulf", { center: { lat: 25.5, lng: 52 }, zoom: 4.4, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 25.2, lng: 55.3 }, zoom: 6.4, bearing: 10, pitch: 35 }, 1500);
  await s.time(5.9);
  await s.click("keyframe");
  await s.idle();
  await s.click("tool-labels");
  await s.shot("20-labels-sheet", { mark: ["label-kinds", "label-density", "label-design", "label-color", "keep-out-lower-third", "place-labels"] });
  await s.click("place-labels");
  await s.idle();
  await s.preview();
  await s.gif("20-labels", { start: 0, duration: 5.5 });
  await s.still("20-local-english", { time: 3 });
  // One language for every name.
  await s.click("tool-labels");
  await language(s, "en");
  await s.click("place-labels");
  await s.idle();
  await s.still("20-english", { time: 3 });
  // Back to Local + English, with the lower third kept free.
  await s.click("tool-labels");
  await language(s, "local+en");
  await s.click("keep-out-lower-third");
  await s.idle();
  await s.shot("20-keep-out", { mark: ["keep-out-lower-third"] });
  await s.click("place-labels");
  await s.idle();
  await s.still("20-lower-third", { time: 3 });
  // Larger names in another colour restyle the names already placed.
  await s.click("tool-labels");
  await s.set("label-size", 30);
  await s.idle();
  await s.set("label-color", "#ffd27a");
  await s.idle();
  await s.still("20-restyled", { time: 3 });
}
