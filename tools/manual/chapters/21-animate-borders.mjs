// Chapter 21: Animate borders.

export async function run(s) {
  await s.newMap("Balkans", { center: { lat: 43.5, lng: 20.5 }, zoom: 5.3, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.time(0.3);
  await s.shot("21-borders-button", { mark: ["tool-borders"], clip: { around: [".bar.tools", ".menu"] } });
  await s.click("tool-borders");
  await s.idle();
  await s.preview();
  await s.gif("21-borders", { start: 0, duration: 5 });
}
