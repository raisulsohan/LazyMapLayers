// FB1: what the feature browser makes. The list itself is unit-tested; this checks the parts that
// only After Effects can answer for - a shape broken into its islands, one area cut out of another,
// the points inside an area, the connection mesh as real route layers in the scene (every pair, and
// from a hub), the borders between a country's provinces as one shape layer of open paths, and a TCX
// activity read by the panel's own file import (the DOM parser lives only in the panel).

import type { View } from "../core/camera/camera.ts";
import { filterFeatures, parseFilter } from "../core/data/featureList.ts";
import { areaKm2 } from "../core/geo/combine.ts";
import { bordersBetween, connectionMesh, cutHole, explodeArea, pointsInside } from "../core/geo/shapeOps.ts";
import { evalScript } from "./cep.ts";
import { featureCentre, featurePolygons, featureRows } from "./features.ts";
import { createMapComp } from "./mapApi.ts";
import { importFile } from "./data/importFile.ts";
import { addMesh } from "./overlays/mesh.ts";
import { addBorderShape } from "./overlays/shapeFeature.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

type LinkLayer = { name: string; points: number; error: string; first: number[] };

/** The route layers the mesh made, with what After Effects works out for each path. */
async function meshLayers(mapId: string): Promise<LinkLayer[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        if (layer.name.indexOf("Link: ") !== 0) continue;
        var path = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Shape");
        var shape = path.valueAtTime(scene.time, false);
        out.push({ name: layer.name, points: shape.vertices.length, error: path.expressionError || "", first: shape.vertices.length ? shape.vertices[0] : [] });
      }
      return LML.json.stringify(out);
    })()`)
  ) as LinkLayer[];
}

type BorderLayer = { name: string; kind: string; paths: { name: string; points: number; closed: boolean; error: string; inside: boolean }[]; fill: boolean; stroke: boolean };

/** The border layers of a map: their tag, and every path as After Effects works it out. */
async function borderLayers(mapId: string): Promise<BorderLayer[]> {
  return JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "borders") continue;
        var contents = layer.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
        var paths = [], fill = false, stroke = false;
        for (var j = 1; j <= contents.numProperties; j++) {
          var item = contents.property(j);
          if (item.matchName === "ADBE Vector Graphic - Fill") fill = true;
          if (item.matchName === "ADBE Vector Graphic - Stroke") stroke = true;
          if (item.matchName !== "ADBE Vector Shape - Group") continue;
          var prop = item.property("ADBE Vector Shape");
          var shape = prop.valueAtTime(scene.time, false), inside = true;
          for (var k = 0; k < shape.vertices.length; k++) {
            var v = shape.vertices[k];
            if (!(v[0] > -scene.width && v[0] < 2 * scene.width && v[1] > -scene.height && v[1] < 2 * scene.height)) inside = false;
          }
          paths.push({ name: item.name, points: shape.vertices.length, closed: shape.closed, error: prop.expressionError || "", inside: inside });
        }
        out.push({ name: layer.name, kind: tag.kind, paths: paths, fill: fill, stroke: stroke });
      }
      return LML.json.stringify(out);
    })()`)
  ) as BorderLayer[];
}

/** A small TCX activity: two laps of three points each, every point with its time. */
function tcxText(): string {
  const point = (i: number) =>
    `<Trackpoint><Time>2026-10-12T06:00:${String(i * 10).padStart(2, "0")}Z</Time><Position><LatitudeDegrees>${23.81 + i * 0.001}</LatitudeDegrees><LongitudeDegrees>${90.41 + i * 0.001}</LongitudeDegrees></Position><HeartRateBpm><Value>${120 + i}</Value></HeartRateBpm></Trackpoint>`;
  const lap = (from: number) => `<Lap StartTime="2026-10-12T06:00:${String(from * 10).padStart(2, "0")}Z"><TotalTimeSeconds>30</TotalTimeSeconds><DistanceMeters>400</DistanceMeters><Track>${[0, 1, 2].map((i) => point(from + i)).join("")}</Track></Lap>`;
  return `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>2026-10-12T06:00:00Z</Id>${lap(0)}${lap(3)}</Activity></Activities></TrainingCenterDatabase>`;
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

  // A real outline with a box over its western half: only the overlap goes (a polygon clipper).
  if (outline && outline.length) {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const polygon of outline) for (const [lng, lat] of polygon[0]) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    const middle = (west + east) / 2;
    const box = [[[[west - 1, south - 1], [middle, south - 1], [middle, north + 1], [west - 1, north + 1], [west - 1, south - 1]]]];
    const clipped = cutHole(outline, box);
    const before = areaKm2(outline);
    const after = areaKm2(clipped.polygons);
    if (clipped.clipped !== 1 || !(after > before * 0.05 && after < before * 0.95)) problems.push(`half of ${islands?.name ?? "the outline"} clipped away left ${Math.round(after)} of ${Math.round(before)} km2 (clipped ${clipped.clipped})`);
    const leftWest = clipped.polygons.every((polygon) => polygon[0].every(([lng]) => lng >= middle - 1e-6));
    if (!leftWest) problems.push("the clip left land west of the cut");
  }

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

  // From a hub: one line to each other place, and every one starts on the hub in the comp.
  const hubMap = await createMapComp({ name: "FB1 hub", ...SIZE, duration: 4, frameRate: 25, view, newScene: true });
  const fromHub = await addMesh(hubMap.id, places, { startFrame: 0, endFrame: 50, theme: "midnight", hub: 0 });
  if (fromHub.expressionErrors.length) problems.push(`hub expressions: ${fromHub.expressionErrors.slice(0, 2).join("; ")}`);
  const spokes = await meshLayers(hubMap.id);
  if (spokes.length !== places.length - 1) problems.push(`${spokes.length} lines from the hub for ${places.length - 1} other places`);
  for (const spoke of spokes) {
    if (spoke.error) problems.push(`${spoke.name}: ${spoke.error}`);
    const gap = Math.hypot((spoke.first[0] ?? NaN) - (spokes[0].first[0] ?? NaN), (spoke.first[1] ?? NaN) - (spokes[0].first[1] ?? NaN));
    if (!(gap < 1)) problems.push(`${spoke.name} starts ${gap.toFixed(1)} px from the others`);
  }

  // The borders between the states of India, as one shape layer of open paths on a map of India.
  const states = featureRows("province", { country: "IND" });
  const outlines = states.map((row) => featurePolygons(row, { country: "IND" })).filter((p): p is NonNullable<typeof p> => !!p);
  const borderLines = bordersBetween(outlines);
  if (states.length < 30 || borderLines.length < 20) problems.push(`${states.length} states of India gave ${borderLines.length} border lines`);
  const india = await createMapComp({ name: "FB1 borders", ...SIZE, duration: 4, frameRate: 25, view: { center: { lat: 22, lng: 80 }, zoom: 3.6, bearing: 0, pitch: 0 }, newScene: true });
  const drawn = await addBorderShape(india.id, { name: "India", lines: borderLines }, { color: "#ffd166", fill: 0, outline: 1.5, startFrame: 0, drawFrames: 50 });
  if (drawn.expressionErrors.length) problems.push(`border expressions: ${drawn.expressionErrors.slice(0, 2).join("; ")}`);
  if (drawn.paths !== borderLines.length || drawn.dropped) problems.push(`${drawn.paths} border paths kept of ${borderLines.length}, ${drawn.dropped} dropped`);
  const borders = await borderLayers(india.id);
  const layer = borders[0];
  if (borders.length !== 1 || !layer) problems.push(`${borders.length} border layers`);
  else {
    if (layer.paths.length !== drawn.paths) problems.push(`the border layer holds ${layer.paths.length} paths of ${drawn.paths}`);
    if (layer.fill || !layer.stroke) problems.push(`the border layer has fill ${layer.fill}, stroke ${layer.stroke}`);
    const bad = layer.paths.filter((path) => path.error || path.closed || path.points < 2 || !path.inside);
    if (bad.length) problems.push(`${bad.length} border paths wrong, first: ${JSON.stringify(bad[0])}`);
    if (layer.paths.length > 1 && !/^Line \d+$/.test(layer.paths[0].name)) problems.push(`border paths are named ${layer.paths[0].name}`);
  }

  // A TCX activity of two laps comes in as one line with a time on every point.
  const tcx = await importFile(new File([tcxText()], "FB1 run.tcx", { type: "application/xml" }));
  const track = tcx.lines[0];
  if (tcx.lines.length !== 1 || !track) problems.push(`the TCX file gave ${tcx.lines.length} lines`);
  else {
    if (track.points.length !== 6) problems.push(`the TCX track has ${track.points.length} of 6 points`);
    if (!track.times || track.times[track.times.length - 1] !== 50) problems.push(`the TCX times came back as ${JSON.stringify(track.times)}`);
    if (track.name !== "FB1 run") problems.push(`the TCX track is called ${track.name}`);
  }

  const passed = problems.length === 0;
  log(`FB1 features: ${rows.length} countries, ${big.total} over 200 million, ${parts.length} islands, ${layers.length} link layers, ${spokes.length} from a hub, ${layer?.paths.length ?? 0} border paths, a TCX track of ${track?.points.length ?? 0} points, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, countries: rows.length, filtered: big.rows.map((row) => row.name).slice(0, 5), parts: parts.length, links: layers.length, hub: spokes.length, borderPaths: layer?.paths.length ?? 0, tcxPoints: track?.points.length ?? 0, problems };
}
