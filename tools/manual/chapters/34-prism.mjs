// Chapter 34: a prism map: the coffee table raised by its numbers under a tilted, turning camera.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Prisms", { center: { lat: -8, lng: -60 }, zoom: 2.9, bearing: -20, pitch: 50 }, { duration: 6 });
  await s.importFile(sample("coffee-sample.csv"));
  await s.set("data-ramp", "warm");
  await s.click("data-apply");
  await s.idle();
  await s.set("data-extrude", true);
  await s.idle();
  await s.shot("34-prism-row", { mark: ["data-extrude", "data-extrude-km"] });
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: -8, lng: -60 }, zoom: 3.1, bearing: 25, pitch: 55 }, 1500);
  await s.time(5.9);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.gif("34-prisms", { start: 0, duration: 5.5 });
}
