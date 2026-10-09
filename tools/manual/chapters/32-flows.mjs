// Chapter 32: flows between places, from a table of origin, destination and amount.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Flights", { center: { lat: 25, lng: 30 }, zoom: 1.6, bearing: 0, pitch: 0 }, { duration: 6, globe: false });
  await s.importFile(sample("flights-sample.csv"));
  await s.time(0.3);
  await s.set("flow-arrows", true);
  await s.set("flow-coloured", true);
  await s.set("flow-seconds", 4);
  await s.js(`(document.querySelector('[data-id="flow-draw"]').scrollIntoView({ block: "center" }), true)`);
  await s.shot("32-flows-sheet", { mark: ["flow-from", "flow-to", "flow-value", "flow-width", "flow-seconds", "flow-arrows", "flow-coloured", "flow-draw"] });
  await s.click("flow-draw");
  await s.idle();
  await s.preview();
  await s.gif("32-flows", { start: 0, duration: 5 });
}
