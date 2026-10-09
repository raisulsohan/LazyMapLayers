// Chapter 35: live numbers. The watch itself needs a file dialog, so this shows the button and the
// "Watching" line the panel shows once a file is picked (set up through the panel's own store).

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

export async function run(s) {
  await s.newMap("Live", { center: { lat: 5, lng: -25 }, zoom: 1.9, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.importFile(sample("coffee-sample.csv"));
  await s.shot("35-watch-button", { mark: ["watch-table"], clip: { x: 0, y: 95, width: 520, height: 150 } });
}
