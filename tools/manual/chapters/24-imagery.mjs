// Chapter 24: imagery: the Satellite look (offline), your own tile address and the open services
// (screenshots only: tiles from those services are fetched online), and the Sentinel-2 button.

export async function run(s) {
  await s.newMap("Satellite", { center: { lat: 23.5, lng: 31 }, zoom: 4.3, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.click("look");
  await new Promise((r) => setTimeout(r, 500));
  await s.click("theme-satellite");
  await s.idle();
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.view({ center: { lat: 30.05, lng: 31.25 }, zoom: 6.5, bearing: 0, pitch: 40 }, 1500);
  await s.time(4.9);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.gif("24-satellite-look", { start: 0, duration: 5 });
  await s.js(`(document.querySelector('[data-id="own-url"]').scrollIntoView({ block: "center" }), true)`);
  await s.shot("24-own-imagery", { mark: ["own-url", "own-service", "satellite-open"] });
}
