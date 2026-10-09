// Chapter 23: sky above the horizon, shaded relief, and the style of pins, routes and callouts.

export async function run(s) {
  await s.newMap("Alps", { center: { lat: 46.4, lng: 9.5 }, zoom: 6.2, bearing: 20, pitch: 72 }, { duration: 1 });
  await s.click("look");
  await new Promise((r) => setTimeout(r, 500));
  await s.js(`(document.querySelector('[data-id="sky"]').scrollIntoView({ block: "center" }), true)`);
  await s.shot("23-sky-relief", { mark: ["sky", ".sheet label.check"] });
  // Sky on (default) and off.
  await s.preview();
  await s.still("23-sky-on", { time: 0.5, width: 960 });
  await s.set("sky", false);
  await s.idle();
  await s.preview();
  await s.still("23-sky-off", { time: 0.5, width: 960 });
  await s.set("sky", true);
  await s.idle();
  // Shaded relief off and on, looking straight down.
  await s.view({ center: { lat: 46.4, lng: 9.5 }, zoom: 6.4, bearing: 0, pitch: 0 }, 1500);
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.click("theme-paper");
  await s.idle();
  await s.preview();
  await s.still("23-relief-off", { time: 0.5, width: 960 });
  await s.js(`(() => { const l = [...document.querySelectorAll('[data-id="look-sheet"] label.check')].find((x) => x.textContent.trim().startsWith("Shaded relief")); const i = l.querySelector("input"); if (!i.checked) i.click(); return true; })()`);
  await s.idle();
  await s.preview();
  await s.still("23-relief-on", { time: 0.5, width: 960 });
  // The style of pins, routes and callouts.
  await s.js(`(document.querySelector('[data-id="layer-accent"]').scrollIntoView({ block: "center" }), true)`);
  await s.set("layer-accent", "#e0245e");
  await s.idle();
  await s.set("layer-stroke", 6);
  await s.idle();
  await s.shot("23-layer-style", { mark: ["layer-accent", "layer-stroke", "layer-glow", "layer-style-pick", "layer-style-reset"] });
}
