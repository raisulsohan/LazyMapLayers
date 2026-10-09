// Chapter 33: a table with a column per year: the map runs through the years, with the year on screen
// and a line chart that grows with it.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Internet", { center: { lat: 15, lng: 15 }, zoom: 1.7, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.importFile(sample("internet-sample.csv"));
  await s.set("data-animate", true);
  await s.set("data-ramp", "blues");
  await s.click("data-apply");
  await s.idle();
  await s.click("data-year-add");
  await s.idle();
  await s.js(`(document.querySelector('[data-id="chart-kind"]').scrollIntoView({ block: "center" }), true)`);
  await s.set("chart-kind", await s.js(`[...document.querySelectorAll('[data-id="chart-kind"] option')].map((o) => o.value).find((v) => /line/i.test(v)) || ""`));
  await s.set("chart-corner", "bottomLeft");
  await s.click("data-chart-add");
  await s.idle();
  await s.js(`(document.querySelector('[data-id="data-animate"]').scrollIntoView({ block: "center" }), true)`);
  await s.shot("33-years-sheet", { mark: ["data-animate", "data-year-add"] });
  await s.preview();
  await s.gif("33-years", { start: 0, duration: 6, fps: 10 });
}
