// Chapter 11: callouts, on Iceland.

export async function run(s) {
  await s.newMap("Iceland", { center: { lat: 64.9, lng: -19 }, zoom: 5.6, bearing: 0, pitch: 0 }, { duration: 6 });
  await s.time(0.5);
  await s.click("tool-callout");
  await s.shot("11-callout-tool", { mark: ["tool-callout"] });
  await s.clickMap(64.1466, -21.9426);
  await new Promise((r) => setTimeout(r, 600));
  await s.type(`[data-id="tool-sheet"] input[placeholder^="Title"]`, "Reykjavík");
  await s.type(`[data-id="tool-sheet"] input[placeholder^="Subtitle"]`, "Capital · 139,000 people");
  await s.js(`(() => { const i = document.querySelector('[data-id="tool-sheet"] input[type=number]'); i.value = "4.5"; i.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await s.shot("11-callout-sheet", { mark: ["tool-sheet"] });
  await s.click("tool-sheet-add");
  await s.idle();
  // A slow push in, so the callout rides the camera.
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 64.4, lng: -20.6 }, zoom: 6.6, bearing: 12, pitch: 35 }, 1500);
  await s.time(5.9);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.gif("11-callout", { start: 0, duration: 5.5 });
  await s.still("11-callout-still", { time: 3 });
}
