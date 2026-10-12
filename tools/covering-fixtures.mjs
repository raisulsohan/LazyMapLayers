// Records which tiles MapLibre GL itself chooses for a set of views, so the unit test of
// src/core/tiles/coveringTiles.ts can hold our version to MapLibre's (DECISIONS D101).
//
//   node tools/covering-fixtures.mjs        writes tests/core/fixtures/covering-tiles.json
//
// MapLibre's TypeScript sources ship in node_modules/maplibre-gl/src; esbuild bundles its mercator
// transform and coveringTiles into a temporary file that Node runs. Run it again when maplibre-gl is
// updated, and the unit test says whether our covering still matches.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "maplibre-gl", "src").replace(/\\/g, "/");
const version = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "maplibre-gl", "package.json"), "utf8")).version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "lml-covering-"));
const entry = path.join(work, "entry.ts");
fs.writeFileSync(
  entry,
  [
    `export { MercatorTransform } from "${src}/geo/projection/mercator_transform.ts";`,
    `export { coveringTiles } from "${src}/geo/projection/covering_tiles.ts";`,
    `export { LngLat } from "${src}/geo/lng_lat.ts";`
  ].join("\n")
);
const bundle = path.join(work, "maplibre-covering.mjs");
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "error" });
const { MercatorTransform, coveringTiles, LngLat } = await import(pathToFileURL(bundle).href);

// A fixed pseudo-random sequence, so the fixtures stay the same between runs.
let seed = 20261012;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const places = [
  { name: "dhaka", lng: 90.4, lat: 23.78 },
  { name: "paris", lng: 2.35, lat: 48.86 },
  { name: "oslo", lng: 10.75, lat: 59.91 },
  { name: "sydney", lng: 151.2, lat: -33.87 },
  { name: "fiji", lng: 179.93, lat: -17.7 },
  { name: "samoa", lng: -171.8, lat: -13.83 },
  { name: "quito", lng: -78.5, lat: -0.2 },
  { name: "nuuk", lng: -51.7, lat: 64.18 }
];
const viewports = [
  { width: 1920, height: 1080 },
  { width: 640, height: 360 },
  { width: 3840, height: 2160 },
  { width: 1080, height: 1920 },
  { width: 1000, height: 1000 }
];
const pitches = [0, 0, 20, 45, 59.5, 60.5, 66, 72, 78, 85];
const views = [];
for (let i = 0; i < 160; i++) {
  const place = pick(places);
  views.push({
    place: place.name,
    center: { lng: place.lng + (random() - 0.5) * 0.4, lat: place.lat + (random() - 0.5) * 0.3 },
    zoom: Math.round((random() < 0.15 ? random() * 6 : 6 + random() * 11) * 1000) / 1000,
    bearing: random() < 0.3 ? 0 : Math.round((random() * 360 - 180) * 10) / 10,
    pitch: pick(pitches),
    viewport: pick(viewports),
    maxZoom: random() < 0.35 ? 9 : 15
  });
}

// MapLibre keeps a world too small for the frame from showing past the poles by zooming in; such views
// draw no detail anyway and are left out.
let skipped = 0;
const cases = views.flatMap((view) => {
  const transform = new MercatorTransform({ minZoom: -2, maxZoom: 22, minPitch: 0, maxPitch: 85, renderWorldCopies: true });
  transform.resize(view.viewport.width, view.viewport.height);
  // Zoom before the centre: at the starting zoom 0 MapLibre would pull the latitude to the equator.
  transform.setZoom(view.zoom);
  transform.setCenter(new LngLat(view.center.lng, view.center.lat));
  transform.setBearing(view.bearing);
  transform.setPitch(view.pitch);
  const moved = Math.abs(transform.pitch - view.pitch) > 1e-9 || Math.abs(transform.zoom - view.zoom) > 1e-9 || Math.abs(transform.center.lat - view.center.lat) > 1e-7;
  if (moved) {
    skipped++;
    return [];
  }
  const tiles = coveringTiles(transform, { tileSize: 512, minzoom: 0, maxzoom: view.maxZoom, reparseOverscaled: true });
  return [{ ...view, tiles: tiles.map((id) => `${id.canonical.z}/${id.canonical.x}/${id.canonical.y}@${id.wrap}`).sort() }];
});

const out = path.join(root, "tests", "core", "fixtures", "covering-tiles.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ maplibre: version, fov: "default", cases }, null, 1)}\n`);
fs.rmSync(work, { recursive: true, force: true });
const counts = cases.map((c) => c.tiles.length);
console.log(`wrote ${out}: ${cases.length} views from MapLibre ${version} (${skipped} left out), ${Math.min(...counts)} to ${Math.max(...counts)} tiles each`);
