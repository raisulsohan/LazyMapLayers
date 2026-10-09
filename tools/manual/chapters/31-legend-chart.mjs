// Chapter 31: legend and chart.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Coffee legend", { center: { lat: 5, lng: -25 }, zoom: 1.9, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.importFile(sample("coffee-sample.csv"));
  await s.click("data-apply");
  await s.idle();
  await s.time(0.5);
  await s.js(`(document.querySelector('[data-id="data-legend-add"]').scrollIntoView({ block: "center" }), true)`);
  await s.set("legend-corner", "bottomLeft");
  await s.click("data-legend-add");
  await s.idle();
  await s.set("chart-corner", "topRight");
  await s.set("chart-bars", 8);
  await s.click("data-chart-add");
  await s.idle();
  await s.shot("31-legend-chart-rows", { mark: ["data-legend-add", "legend-corner", "chart-kind", "data-chart-add", "chart-bars", "chart-corner"] });
  await s.preview();
  await s.gif("31-chart", { start: 0, duration: 5 });
  await s.still("31-legend-chart", { time: 5.5 });
}
