// Chapter 19: Save as GeoJSON (the button only; the save dialog is After Effects' own).

export async function run(s) {
  await s.newMap("Export", { center: { lat: 48, lng: 10 }, zoom: 3.8, bearing: 0, pitch: 0 }, { duration: 5 });
  await s.shot("19-save-button", { mark: ["export-geojson"], clip: { around: [".bar.tools", ".menu"] } });
}
