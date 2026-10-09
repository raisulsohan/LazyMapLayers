// Chapter 10: pins and 3D pins, on a map of Japan.

const TOKYO = [35.6895, 139.6917];
const OSAKA = [34.6937, 135.5023];
const SAPPORO = [43.0618, 141.3545];
const FUKUOKA = [33.5902, 130.4017];

export async function run(s) {
  await s.newMap("Japan", { center: { lat: 37.2, lng: 137.5 }, zoom: 4.6, bearing: 0, pitch: 0 }, { duration: 5 });
  // The tool, armed.
  await s.click("tool-pin");
  await s.shot("10-pin-tool", { mark: ["tool-pin"] });
  await s.clickMap(...TOKYO);
  await s.idle();
  await s.shot("10-pin-added");
  // Alt+click drops a pin without the tool.
  for (const place of [OSAKA, SAPPORO, FUKUOKA]) {
    await s.clickMap(...place, { alt: true });
    await s.idle();
  }
  await s.shot("10-four-pins");
  // A camera move so the GIF shows the pins staying on their places: key the view at 0, fly in by 4.5 s.
  await s.time(0);
  await s.click("keyframe");
  await s.idle();
  await s.time(0.5);
  await s.view({ center: { lat: 35.0, lng: 136.4 }, zoom: 6.3, bearing: -20, pitch: 40 }, 1500);
  await s.store("(store.flightSeconds.value = 4, true)");
  await s.click("fly-here");
  await s.idle();
  await s.preview();
  await s.gif("10-pins-flight", { start: 0, duration: 5 });
  // 3D pins lie on the ground under the matched 3D camera.
  await s.time(4.9);
  await s.click("tool-pin3d");
  await s.shot("10-pin3d-tool", { mark: ["tool-pin3d"] });
  await s.clickMap(34.9858, 135.7588);
  await s.idle();
  // Alt+Shift+click: a 3D pin without the tool.
  await s.clickMap(34.6851, 135.8048, { alt: true, shift: true });
  await s.idle();
  // Closer and tilted, so the 3D pins read as lying on the ground next to the flat Osaka pin.
  await s.view({ center: { lat: 34.82, lng: 135.62 }, zoom: 8.6, bearing: -25, pitch: 58 }, 1500);
  await s.click("keyframe");
  await s.idle();
  await s.preview();
  await s.still("10-pin3d-result", { time: 4.9 });
}
