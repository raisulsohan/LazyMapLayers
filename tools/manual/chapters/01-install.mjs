// Chapter 1: the panel as it first opens, in an empty project.

export async function run(s) {
  await s.view({ center: { lat: 20, lng: 10 }, zoom: 1.2, bearing: 0, pitch: 0 });
  await s.shot("01-first-open", { mark: ["new-map-header"] });
}
