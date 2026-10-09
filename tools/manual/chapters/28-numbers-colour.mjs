// Chapter 28: colouring places by a number, and by a category.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Coffee", { center: { lat: 5, lng: -20 }, zoom: 1.75, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.shot("28-numbers-tool", { mark: ["tool-data"], clip: { x: 0, y: 34, width: 520, height: 64 } });
  await s.importFile(sample("coffee-sample.csv"));
  await s.shot("28-data-sheet", { mark: ["data-key", "data-value", "data-level", "data-ramp", "data-steps", "data-method", "data-reverse", "data-apply"] });
  await s.click("data-apply");
  await s.idle();
  await s.shot("28-applied", { mark: ["data-legend"] });
  await s.preview();
  await s.still("28-coffee-map", { time: 1 });
  // Equal counts and another ramp.
  await s.set("data-method", "quantile");
  await s.idle();
  await s.set("data-ramp", "teal");
  await s.idle();
  await s.preview();
  await s.still("28-coffee-quantile", { time: 1 });
  await s.click("data-clear");
  await s.idle();
  // Categories: which currency.
  await s.view({ center: { lat: 25, lng: -5 }, zoom: 2.4, bearing: 0, pitch: 0 }, 1500);
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.importFile(sample("currency.csv"));
  await s.click("data-apply");
  await s.idle();
  await s.shot("28-categories", { mark: ["data-value", "data-palette", "data-legend"] });
  await s.preview();
  await s.still("28-currency-map", { time: 1 });
}
