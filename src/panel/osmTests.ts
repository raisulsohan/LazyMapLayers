// OSM1 (online): features from OpenStreetMap. Goes to the Overpass API, so it runs only when it is
// named: npm run ae:spikes -- --only OSM1

import type { View } from "../core/camera/camera.ts";
import { importGeoJson } from "../core/data/importLines.ts";
import { osmGeoJson, type OsmBbox } from "../core/data/overpass.ts";
import { searchOsm } from "./data/osm.ts";
import { evalScript } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { addFeatureShape } from "./overlays/shapeFeature.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };
/** Lake Como: a lake held by a relation, with islands, and rivers and towns around it. */
const BBOX: OsmBbox = [45.78, 9.03, 46.18, 9.45];

export async function runOsmTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 45.98, lng: 9.24 }, zoom: 9.6, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "OSM1 features", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });

  const started = performance.now();
  const water = await searchOsm({ text: "Como", kind: "water", bbox: BBOX });
  const seconds = (performance.now() - started) / 1000;
  const lake = water.features.find((feature) => /Como/i.test(feature.name) && feature.geometry.type !== "Point" && feature.geometry.type !== "LineString");
  if (!water.features.length) problems.push("OpenStreetMap returned no water named Como");
  if (!lake) problems.push(`no lake among ${water.features.map((f) => `${f.name} (${f.geometry.type})`).slice(0, 5).join(", ")}`);
  if (lake && lake.points < 200) problems.push(`the lake has ${lake.points} points, expected a real outline`);

  // The same search again costs nothing: the answer is kept in the user data folder.
  const again = await searchOsm({ text: "Como", kind: "water", bbox: BBOX });
  if (!again.cached || again.bytes) problems.push(`the second search cost ${again.bytes} bytes (cached: ${again.cached})`);
  if (again.features.length !== water.features.length) problems.push(`the kept answer gave ${again.features.length} features, the first ${water.features.length}`);

  // What comes back reads as an ordinary import.
  const imported = importGeoJson(osmGeoJson(water.features), "OpenStreetMap: Como");
  if (!imported.areas.length) problems.push("nothing became an area");
  const area = imported.areas.find((candidate) => /Como/i.test(candidate.name));
  if (!area) problems.push(`the areas are ${imported.areas.map((a) => a.name).slice(0, 5).join(", ")}`);

  // And draws in After Effects as a shape layer that follows the map.
  let made: { layers: string[]; expressionErrors: string[]; points: number; rings: number } | null = null;
  if (area) {
    made = await addFeatureShape(map.id, { name: area.name, polygons: area.polygons, code: "osm" }, { color: "#33ccff", fill: 0.8, outline: 3 });
    if (made.expressionErrors.length) problems.push(`shape expressions: ${made.expressionErrors.slice(0, 2).join("; ")}`);
    if (!made.rings || made.points < 50) problems.push(`the shape has ${made.rings} rings and ${made.points} points`);
    const drawn = Number(
      await evalScript(`(function () {
        var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, found = 0;
        for (var i = 1; i <= scene.numLayers; i++) {
          var tag = LML.tag.read(scene.layer(i));
          if (tag && tag.kind === "feature") found++;
        }
        return String(found);
      })()`)
    );
    if (drawn !== 1) problems.push(`${drawn} shape layers are in the scene`);
  }

  // Boundaries without a name are asked for by kind alone.
  const parks = await searchOsm({ text: "", kind: "green", bbox: [45.95, 9.2, 46.05, 9.3] });
  if (!parks.features.length) problems.push("nothing green was found around Lake Como");

  const passed = problems.length === 0;
  log(
    `OSM1 OpenStreetMap: ${water.features.length} water features in ${seconds.toFixed(1)} s (${Math.round(water.bytes / 1024)} KB), "${lake?.name ?? "-"}" has ${lake?.points ?? 0} points, ${imported.areas.length} areas and ${imported.lines.length} lines imported, the shape layer has ${made?.rings ?? 0} rings, ${parks.features.length} green features by kind alone, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return {
    passed,
    features: water.features.length,
    bytes: water.bytes,
    seconds: Math.round(seconds * 10) / 10,
    lake: lake ? { name: lake.name, kind: lake.kind, type: lake.geometry.type, points: lake.points } : null,
    areas: imported.areas.length,
    lines: imported.lines.length,
    shape: made ? { rings: made.rings, points: made.points } : null,
    green: parks.features.length,
    problems
  };
}
