// Chapter 29: bubbles, spikes, heat and shapes, from one table.

import path from "node:path";
import { root } from "../session.mjs";

const sample = (name) => path.join(root, "tools", "manual", "samples", name);

const scrollTo = (s, id) => s.js(`(document.querySelector('[data-id="${id}"]').scrollIntoView({ block: "center" }), true)`);

export async function run(s) {
  await s.newMap("Coffee bubbles", { center: { lat: 3, lng: -30 }, zoom: 1.9, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.importFile(sample("coffee-sample.csv"));
  await s.click("data-apply");
  await s.idle();
  await s.time(0.3);
  // Bubbles.
  await scrollTo(s, "data-bubbles-add");
  await s.set("bubble-coloured", true);
  await s.click("data-bubbles-add");
  await s.idle();
  await s.shot("29-bubbles-row", { mark: ["data-bubbles-add", "bubble-size", "bubble-coloured", "data-bubbles-remove"] });
  // Pop the circles on one after another: each has its own transform.
  console.log("  bubble keys: " + await s.ae(`(function () {
    var c = app.project.activeItem;
    for (var i = 1; i <= c.numLayers; i++) {
      var l = c.layer(i);
      if (!/bubble/i.test(l.name)) continue;
      var groups = l.property("ADBE Root Vectors Group");
      for (var g = 1; g <= groups.numProperties; g++) {
        var sc = groups.property(g).property("ADBE Vector Transform Group").property("ADBE Vector Scale");
        var t = 0.3 + (g - 1) * 0.15;
        sc.setValueAtTime(t, [0, 0]); sc.setValueAtTime(t + 0.35, [100, 100]);
      }
      return "ok " + groups.numProperties;
    }
    var names = []; for (var j = 1; j <= c.numLayers; j++) names.push(c.layer(j).name);
    return "no bubbles in " + names.join(", ");
  })()`));
  await s.preview();
  await s.gif("29-bubbles", { start: 0, duration: 4 });
  await s.click("data-bubbles-remove");
  await s.idle();
  // Spikes, tilted.
  await s.click("data-spikes-add");
  await s.idle();
  await s.shot("29-spikes-row", { mark: ["data-spikes-add", "spike-height", "spike-coloured"] });
  await s.preview();
  await s.still("29-spikes", { time: 2 });
  await s.click("data-spikes-remove");
  await s.idle();
  // Heat, with a wide reach and the fill faded back so the warmth reads.
  await s.set("data-opacity", 20);
  await s.idle();
  await s.set("heat-radius", 140);
  await s.click("data-heat-add");
  await s.idle();
  await s.preview();
  await s.still("29-heat", { time: 2 });
  await s.click("data-heat-remove");
  await s.idle();
  // Shapes: one shape layer per place.
  await s.click("data-shapes-add");
  await s.idle();
  await s.shot("29-shapes-row", { mark: ["data-shapes-add", "shapes-by-value"] });
  await s.preview();
  await s.still("29-shapes", { time: 2 });
}
