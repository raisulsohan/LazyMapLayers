// Chapter 2: the panel at a glance. One map (the world flight sample) so every control is live.

const ROW = { x: 0, y: 34, width: 520, height: 64 };

export async function run(s) {
  await s.store("store.buildSample()");
  await s.idle();
  await s.view({ center: { lat: 30, lng: 20 }, zoom: 2.3, bearing: 0, pitch: 0 });
  await s.shot("02-panel-overview", { mark: [".bar.header", ".bar.tools", ".search", ".map-wrap", ".view-readout", ".bar.strip", ".tabs", "status"] });
  await s.shot("02-header", { mark: ["maps", "settings", "render-preview", "render"], clip: { x: 0, y: 0, width: 520, height: 64 }, badges: "below" });
  await s.shot("02-tool-row", {
    mark: ["tool-pin", "tool-pin3d", "tool-callout", "tool-route", "tool-attach", "tool-highlight", "tool-import", "tool-drawing", "tool-data", "tool-osm", "export-geojson"],
    clip: ROW,
    badges: "below"
  });
  await s.shot("02-tool-row-right", { mark: ["tool-labels", "tool-borders", "tool-camera", "look", "basemap", "download-area", "globe"], clip: ROW, badges: "below" });
  await s.shot("02-preview-corner", { mark: ["match-ae", "exact-look"], clip: { x: 0, y: 100, width: 260, height: 70 }, badges: "below" });
  await s.shot("02-strip", {
    mark: ["keyframe", "live-link", "fly-here", ".bar.strip select", ".bar.strip button[title='Zoom out']", ".zoom-slider", ".bar.strip button[title='Zoom in']", ".bar.strip button[title^='North']"],
    clip: { x: 0, y: 500, width: 520, height: 66 },
    badges: "below"
  });
  // The log, opened by a click on the status line.
  await s.click("status");
  await s.shot("02-log", { clip: { x: 0, y: 560, width: 520, height: 340 } });
  await s.click("status");
}
