// Chapter 7: moving the preview: drag, wheel, right-drag, the compass, the readout, Exact look.

const wrapClip = async (s) => s.js(`(() => { const r = document.querySelector(".map-wrap").getBoundingClientRect(); return { x: 0, y: r.top, width: r.width, height: r.height + 36 }; })()`);

export async function run(s) {
  await s.newMap("Peru", { center: { lat: -12.5, lng: -75 }, zoom: 5.2, bearing: 0, pitch: 0 }, { duration: 5 });
  const clip = await wrapClip(s);
  const c = await s.previewCentre();
  await s.record("07-drag-pan", async () => {
    await s.drag(c, { x: c.x - 140, y: c.y - 60 }, { steps: 24 });
    await s.drag({ x: c.x - 140, y: c.y - 60 }, c, { steps: 24 });
  }, { clip });
  await s.record("07-wheel-zoom", async () => {
    await s.wheel(c, -120, { times: 8, gapMs: 120 });
    await s.wheel(c, 120, { times: 8, gapMs: 120 });
  }, { clip });
  await s.record("07-right-drag", async () => {
    await s.drag(c, { x: c.x + 45, y: c.y - 28 }, { button: "right", steps: 30 });
  }, { clip });
  await s.shot("07-tilted", { mark: [".view-readout"] });
  // North up, then Alt+click it to look straight down as well.
  await s.shot("07-compass", { mark: [".bar.strip button[title^='North']"], clip: { x: 0, y: 500, width: 520, height: 66 } });
  await s.js(`(document.querySelector(".bar.strip button[title^='North']").click(), true)`);
  await new Promise((r) => setTimeout(r, 1200));
  await s.js(`(document.querySelector(".bar.strip button[title^='North']").dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true })), true)`);
  await new Promise((r) => setTimeout(r, 1200));
  // What is under the pointer.
  await s.view({ center: { lat: -13.53, lng: -71.97 }, zoom: 9, bearing: 0, pitch: 0 }, 2500);
  const p = await s.pointOf(-13.52, -71.97);
  await s.panel.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await new Promise((r) => setTimeout(r, 900));
  await s.shot("07-here", { mark: ["here-readout"] });
  // The pointer leaves the map, so the line goes away for the next pictures.
  await s.panel.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 880 });
  await s.js(`(window.lmlDebug.store.previewHovered(null), true)`);
  // Exact look off and on.
  await s.view({ center: { lat: -12.05, lng: -77.04 }, zoom: 10.5, bearing: 0, pitch: 0 }, 2500);
  await s.shot("07-exact-off", { clip, mark: ["exact-look"] });
  await s.click("exact-look");
  await new Promise((r) => setTimeout(r, 2500));
  await s.shot("07-exact-on", { clip, mark: ["exact-look"] });
  await s.click("exact-look");
}
