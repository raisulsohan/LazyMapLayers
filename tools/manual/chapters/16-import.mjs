// Chapter 16: importing files: a GPX track with times, a CSV of stops, a GeoJSON area.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

const setDuration = (s, seconds) =>
  s.js(`(() => { const i = document.querySelector('[data-id="import-sheet"] input[type=number]'); i.value = "${seconds}"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);

export async function run(s) {
  await s.newMap("Trans-Siberian", { center: { lat: 55, lng: 85 }, zoom: 2.9, bearing: 0, pitch: 0 }, { duration: 8 });
  await s.shot("16-import-tool", { mark: ["tool-import"], clip: { x: 0, y: 34, width: 520, height: 64 } });
  await s.importFile(sample("trans-siberian.gpx"));
  await s.shot("16-import-sheet", { mark: ["import-sheet"] });
  // Draw + arrow at the recorded pace, over 7 s from 0.5 s.
  await s.time(0.5);
  await setDuration(s, 7);
  await s.set("recorded-pace", true);
  await s.shot("16-import-options", { mark: ["recorded-pace", "import-arrow-0"] });
  await s.click("import-arrow-0");
  await s.idle();
  // The stations of the track as pins.
  await s.js(`(() => { const b = [...document.querySelectorAll('[data-id="import-sheet"] button')].find((x) => /^Pin \\d+ places?$/.test(x.textContent.trim())); if (!b) throw new Error("no Pin button"); b.click(); return true; })()`);
  await s.idle();
  await s.preview();
  await s.gif("16-recorded-pace", { start: 0, duration: 8, fps: 10 });
  // A CSV of places: pins.
  await s.importFile(sample("trans-siberian-stops.csv"));
  await s.shot("16-csv-places", { mark: ["import-sheet"] });
  await s.click("import-close");
  // A GeoJSON area: Highlight.
  await s.importFile(sample("baikal-area.geojson"));
  await s.clickText("Highlight", "import-sheet");
  await s.idle();
  await s.shot("16-area", { mark: ["import-sheet"] });
  await s.click("import-close");
}
