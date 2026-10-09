// Chapter 36: Preview, Render and the Render tab: a final render with passes, and the job list.

export async function run(s) {
  await s.newMap("Render", { center: { lat: 35.68, lng: 139.76 }, zoom: 10.5, bearing: -20, pitch: 50 }, { duration: 3 });
  // A camera move, so every frame differs and the render has real work to show.
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 35.66, lng: 139.74 }, zoom: 12, bearing: 20, pitch: 55 }, 1500);
  await s.store("(store.flightSeconds.value = 3, true)");
  await s.click("fly-here");
  await s.idle();
  await s.click("tab-render");
  await s.shot("36-render-tab", { mark: ["supersample", ".render-tab label.check", ".passes"] });
  await s.shot("36-buttons", { mark: ["render-preview", "render"], clip: { x: 0, y: 0, width: 520, height: 64 }, badges: "below" });
  await s.preview();
  await s.shot("36-preview-job", { mark: [".queue .job"] });
  // A final render with the Roads and Water passes and a land matte.
  await s.js(`(() => { for (const label of document.querySelectorAll(".passes label")) { const t = label.textContent.trim(); const i = label.querySelector("input"); if (["Water", "Roads", "Land Matte"].includes(t) && !i.checked) i.click(); } return true; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await s.click("render");
  await new Promise((r) => setTimeout(r, 1500));
  await s.shot("36-rendering", { mark: [".queue .job:last-child"] });
  await s.js("window.lmlDebug.queueIdle()");
  await s.idle();
  await s.shot("36-render-done", { mark: [".queue .job:last-child"] });
  await s.click("render-disk-check");
  await s.idle();
  await new Promise((r) => setTimeout(r, 1500));
  await s.shot("36-disk", { mark: ["render-disk"] });
  await s.still("36-final-frame", { time: 1.5 });
}
