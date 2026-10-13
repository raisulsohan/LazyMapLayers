// Chapter 2: the panel at a glance. One map (the world flight sample) so every control is live.

const MENU = { around: [".bar.tools", ".menu"], pad: 8 };

export async function run(s) {
  await s.store("store.buildSample()");
  await s.idle();
  await s.view({ center: { lat: 30, lng: 20 }, zoom: 2.3, bearing: 0, pitch: 0 });
  await s.shot("02-panel-overview", { mark: [".bar.header", ".bar.tools", ".search", ".map-wrap", ".view-readout", ".bar.strip", ".tabs", "status"] });
  await s.shot("02-header", { mark: ["maps", "settings", "header-manual", "render-preview", "render"], clip: { around: [".bar.header"] }, badges: "below" });
  // The tool row: two menus (D106), then the look, the basemap and the globe.
  await s.shot("02-tool-row", { mark: ["menu-add", "menu-data", "look", "basemap", "globe"], clip: { around: [".bar.tools"] }, badges: "below" });
  await s.shot("02-menu-add", {
    mark: ["tool-pin", "tool-pin3d", "tool-callout", "tool-route", "tool-highlight", "tool-attach", "tool-labels", "tool-borders", "tool-camera"],
    clip: MENU
  });
  await s.shot("02-menu-data", { mark: ["tool-import", "tool-data", "tool-osm", "tool-drawing", "download-area", "export-geojson"], clip: MENU });
  await s.shot("02-preview-corner", { mark: ["match-ae", "exact-look"], clip: { around: ["match-ae"], pad: 8, width: 260 }, badges: "below" });
  await s.shot("02-strip", {
    mark: ["keyframe", "live-link", "fly-here", ".bar.strip select", ".bar.strip button[title='Zoom out']", ".zoom-slider", ".bar.strip button[title='Zoom in']", ".bar.strip button[title^='North']"],
    clip: { around: [".bar.strip"] },
    badges: "below"
  });
  // The log, opened by a click on the status line.
  await s.click("status");
  await s.shot("02-log", { clip: { around: [".log", "status"] } });
  await s.click("status");
}
