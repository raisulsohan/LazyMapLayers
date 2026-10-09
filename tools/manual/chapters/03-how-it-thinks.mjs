// Chapter 3: how the panel thinks. The world flight sample shows one map, its camera and the layers
// that follow it.

export async function run(s) {
  await s.store("store.buildSample()");
  await s.idle();
  await s.preview();
  await s.strip("03-one-camera", [
    { time: 2, label: "0:02  the globe" },
    { time: 12, label: "0:12  flying down" },
    { time: 19, label: "0:19  Paris" },
    { time: 30, label: "0:30  on the way to Tokyo" }
  ], { width: 1600 });
  await s.gif("03-flight-down", { start: 9, duration: 5 });
  await s.time(19);
  await s.click("match-ae");
  await s.idle();
  await s.shot("03-readout", { mark: [".view-readout"], clip: { x: 0, y: 380, width: 520, height: 130 } });
}
