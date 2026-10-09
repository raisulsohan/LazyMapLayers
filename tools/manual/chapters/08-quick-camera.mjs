// Chapter 8: the quick camera: Keyframe view, Fly here, Live link, 3D camera.

export async function run(s) {
  await s.newMap("Nile", { center: { lat: 26.5, lng: 31.5 }, zoom: 4.6, bearing: 0, pitch: 0 }, { duration: 6 });
  // Keyframe view at 0, then Fly here to Cairo over 4 s from 1 s.
  await s.time(0);
  await s.shot("08-keyframe", { mark: ["keyframe"], clip: { x: 0, y: 500, width: 520, height: 66 } });
  await s.click("keyframe");
  await s.idle();
  await s.time(1);
  await s.view({ center: { lat: 30.04, lng: 31.24 }, zoom: 9.5, bearing: 20, pitch: 50 }, 1500);
  await s.store("(store.flightSeconds.value = 4, true)");
  await s.shot("08-fly-here", { mark: ["fly-here", ".bar.strip select"], clip: { x: 0, y: 500, width: 520, height: 66 } });
  await s.click("fly-here");
  await s.idle();
  await s.preview();
  await s.gif("08-fly-here", { start: 0, duration: 5.5 });
  // Live link: on, the preview moves the camera at the current time.
  await s.click("live-link");
  await s.shot("08-live-link", { mark: ["live-link"], clip: { x: 0, y: 500, width: 520, height: 66 } });
  await s.click("live-link");
  // The 3D camera.
  await s.time(5.5);
  await s.click("tool-camera");
  await s.idle();
  await s.shot("08-camera-on", { mark: ["tool-camera"], clip: { x: 0, y: 34, width: 520, height: 64 } });
}
