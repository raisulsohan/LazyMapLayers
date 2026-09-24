// FB1: what the feature browser makes. The list itself is unit-tested; this checks the parts that
// only After Effects can answer for - a shape broken into its islands, one area cut out of another,
// the points inside an area, and the connection mesh as real route layers in the scene.

import type { View } from "../core/camera/camera.ts";
import { filterFeatures, parseFilter } from "../core/data/featureList.ts";
import { areaKm2 } from "../core/geo/combine.ts";
import { connectionMesh, cutHole, explodeArea, pointsInside } from "../core/geo/shapeOps.ts";
import { evalScript } from "./cep.ts";
import { featureCentre, featurePolygons, featureRows } from "./features.ts";
import { createMapComp } from "./mapApi.ts";
import { addMesh } from "./overlays/mesh.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

/** The route layers the mesh made, with what After Effects works out for each path. */
async function meshLayers(mapId: string): Promise<{ name: string; points: number; error: string }[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        if (layer.name.indexOf("Link: ") !== 0) continue;
        var path = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Shape");
        var shape = path.valueAtTime(scene.time, false);
        out.push({ name: layer.name, points: shape.vertices.length, error: path.expressionError || "" });
      }
      return LML.json.stringify(out);
    })()`)
  ) as { name: string; points: number; error: string }[];
}

const square = (lng: number, lat: number, size: number) => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat]
];

export async function runFeatureTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const view: View = { center: { lat: 20, lng: 20 }, zoom: 3.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "FB1 features", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });

  // The list the browser shows, from the data this build carries.
  const rows = featureRows("country");
  if (rows.length < 150) problems.push(`only ${rows.length} countries in the list`);
  const filter = parseFilter("population > 200000000");
  const big = filter ? filterFeatures(rows, { filter, sort: { key: "population", descending: true } }) : { rows: [], total: 0, hidden: 0 };
  if (big.rows.length < 5 || big.rows[0].props.population === undefined) problems.push(`the filter found ${big.rows.length}`);
  if (big.rows.some((row, i) => i > 0 && Number(row.props.population) > Number(big.rows[i - 1].props.population))) problems.push("the sort is not largest first");

  // A country of islands breaks into its parts, largest first, and every part keeps its ground.
  const islands = rows.find((row) => row.name === "Philippines") ?? rows.find((row) => row.name === "Indonesia");
  const outline = islands ? featurePolygons(islands) : null;
  const parts = outline ? explodeArea(outline) : [];
  if (!outline || parts.length < 3) {
    problems.push(`${islands?.name ?? "no island country"} broke into ${parts.length} parts`);
  } else {
    const whole = areaKm2(outline);
    const summed = parts.reduce((total, part) => total + part.km2, 0);
    if (Math.abs(whole - summed) > whole * 0.001) problems.push(`the parts add up to ${Math.round(summed)} km2 of ${Math.round(whole)} km2`);
    if (parts[0].km2 < parts[1].km2) problems.push("the parts are not largest first");
  }

  // One area cut out of another as a hole, and the points that fall inside what is left.
  const outer = [[square(0, 0, 10)]];
  const inner = [[square(3, 3, 2)]];
  const cut = cutHole(outer, inner);
  if (cut.cut !== 1 || cut.polygons[0].length !== 2) problems.push(`the cut made ${cut.cut} holes and ${cut.polygons[0].length} rings`);
  const dots = [
    { lat: 5, lng: 5 },
    { lat: 4, lng: 4 },
    { lat: 60, lng: 60 }
  ];
  const inside = pointsInside(cut.polygons, dots);
  if (inside.join() !== "0") problems.push(`the points inside came back as ${JSON.stringify(inside)}`);

  // The mesh: a line between every pair of four capitals, as route layers that follow the map.
  const places = ["France", "Spain", "Italy", "Germany"]
    .map((name) => rows.find((row) => row.name === name))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => ({ row, centre: featureCentre(row) }))
    .filter((place): place is { row: NonNullable<(typeof rows)[number]>; centre: { lat: number; lng: number } } => !!place.centre)
    .map((place) => ({ name: place.row.name, lat: place.centre.lat, lng: place.centre.lng }));
  if (places.length !== 4) problems.push(`${places.length} of 4 countries had an outline to take a centre from`);
  const expected = connectionMesh(places, { steps: 64 }).lines.length;
  const made = await addMesh(map.id, places, { startFrame: 0, endFrame: 50, theme: "midnight" });
  if (made.expressionErrors.length) problems.push(`mesh expressions: ${made.expressionErrors.slice(0, 2).join("; ")}`);
  if (made.lines !== expected) problems.push(`${made.lines} lines drawn, ${expected} expected`);
  const layers = await meshLayers(map.id);
  if (layers.length !== made.lines) problems.push(`${layers.length} link layers in the scene for ${made.lines} lines`);
  for (const layer of layers) {
    if (layer.error) problems.push(`${layer.name}: ${layer.error}`);
    if (layer.points < 8) problems.push(`${layer.name} has ${layer.points} points`);
  }
  // Only the nearest neighbour each: fewer lines than every pair.
  const near = connectionMesh(places, { neighbours: 1, steps: 8 });
  if (near.lines.length >= expected) problems.push(`nearest-neighbour drew ${near.lines.length} of ${expected}`);

  const passed = problems.length === 0;
  log(`FB1 features: ${rows.length} countries, ${big.total} over 200 million, ${parts.length} islands, ${layers.length} link layers, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, countries: rows.length, filtered: big.rows.map((row) => row.name).slice(0, 5), parts: parts.length, links: layers.length, problems };
}
