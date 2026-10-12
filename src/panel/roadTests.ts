// RR1 (online): routes on roads (DECISIONS D102). Goes to Overpass, so it runs only when it is named:
// npm run ae:spikes -- --only RR1
//
// The road answers go to a folder of the test's own, which starts empty. Then:
//   1. a car route from Dhaka to Chittagong, fetched: most of it on the national highway N1, every
//      point between the two ends on a road a car may use, in the order the road runs;
//   2. a walk across Paris from the Eiffel Tower to the Louvre, fetched: on walkable ways only, over a
//      bridge across the Seine, not much longer than the straight line;
//   3. offline (every request fails as without a connection): both again from the folder, point for
//      point; with the answers 40 days old, both again from them; with an empty folder, a message that
//      says the roads are not on this computer yet;
//   4. in After Effects: the drive as an arrow rig with a traveller and the walk with a comet, ordinary
//      route layers with their ends in the tag, and a camera move along each that stays on the line.

import type { View } from "../core/camera/camera.ts";
import { fitPoints } from "../core/camera/fit.ts";
import { buildTimeline, normaliseShotList, viewAtFrame } from "../core/camera/shots.ts";
import type { LngLat } from "../core/geo/mercator.ts";
import { simplifyLine } from "../core/geo/simplify.ts";
import { roadWays } from "../core/routing/graph.ts";
import { wayUse, type RoadMode } from "../core/routing/profiles.ts";
import { durationText, mainRoads, type RoadRoute } from "../core/routing/search.ts";
import { evalScript, fs, path } from "./cep.ts";
import { findRouteOnRoads, roadCacheFolder, setRoadCacheFolder, type RoadRouteFound } from "./data/roads.ts";
import { createMapComp } from "./mapApi.ts";
import { setNetworkBlocked } from "./net.ts";
import { addRouteLine } from "./overlays/routeCallout.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const DHAKA = { lat: 23.7104, lng: 90.4074 };
const CHITTAGONG = { lat: 22.3569, lng: 91.7832 };
const EIFFEL = { lat: 48.8584, lng: 2.2945 };
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
const SIZE = { width: 1280, height: 720 };

const key = (p: { lat: number; lng: number }) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;

/**
 * Whether a route runs on the roads a mode may use: every point between the two snapped ends is a
 * point of such a way, and every step between two of them is a step of that way.
 */
function onRoads(route: RoadRoute, mode: RoadMode): { points: number; offRoad: number; offStep: number; bridges: number } {
  const points = new Set<string>();
  const steps = new Set<string>();
  const bridges = new Set<number>();
  for (const name of fs().readdirSync(roadCacheFolder()) as string[]) {
    const text = fs().readFileSync(path().join(roadCacheFolder(), name), "utf8");
    for (const way of roadWays(JSON.parse(text.slice(text.indexOf("\n") + 1)))) {
      if (!wayUse(way.tags, mode)) continue;
      if (way.tags.bridge && way.tags.bridge !== "no") bridges.add(way.id);
      for (let i = 0; i < way.lat.length; i++) {
        const here = key({ lat: way.lat[i], lng: way.lng[i] });
        points.add(here);
        if (i) {
          const before = key({ lat: way.lat[i - 1], lng: way.lng[i - 1] });
          steps.add(`${before}|${here}`);
          steps.add(`${here}|${before}`);
        }
      }
    }
  }
  const inner = route.points.slice(1, -1);
  let offRoad = 0;
  let offStep = 0;
  inner.forEach((p, i) => {
    if (!points.has(key(p))) offRoad++;
    if (i && !steps.has(`${key(inner[i - 1])}|${key(p)}`)) offStep++;
  });
  return { points: inner.length, offRoad, offStep, bridges: route.wayIds.filter((id) => bridges.has(id)).length };
}

/** Km from a place to the nearest point of a line (flat, over the short distances that matter here). */
function kmToLine(p: LngLat, line: LngLat[]): number {
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1].lng - p.lng) * kx;
    const ay = (line[i - 1].lat - p.lat) * 111.32;
    const dx = (line[i].lng - line[i - 1].lng) * kx;
    const dy = (line[i].lat - line[i - 1].lat) * 111.32;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}

/** The camera move the Route sheet's Camera switch adds (addRouteShot), and how far its centre strays from the line. */
function cameraAlong(points: LngLat[], view: View): number {
  const light = simplifyLine(points, 160);
  const at = (p: LngLat): View => ({ ...view, center: { lat: p.lat, lng: p.lng } });
  const list = normaliseShotList({
    v: 1,
    start: 0,
    shots: [
      { id: "a", name: "start", view: at(light[0]), hold: 1, move: { kind: "cut", seconds: 0, easing: { id: "linear" } } },
      { id: "b", name: "end", view: at(light[light.length - 1]), hold: 1, move: { kind: "route", seconds: 6, easing: { id: "smooth" }, height: "normal", pitchDip: false, route: { line: light.map((p) => [p.lng, p.lat] as [number, number]), level: true, followBearing: false } } }
    ]
  });
  const timeline = buildTimeline(list, SIZE, 25);
  let worst = 0;
  for (let frame = timeline.startFrame; frame <= timeline.endFrame; frame += 5) {
    const seen = viewAtFrame(timeline, frame);
    if (seen) worst = Math.max(worst, kmToLine(seen.center, points));
  }
  return worst;
}

async function routeLayer(mapId: string): Promise<{ count: number; from: number[] | null; to: number[] | null; kinds: string[] }> {
  const raw = await evalScript(`(function () {
    var scene = LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp, out = { count: 0, from: null, to: null, kinds: [] };
    for (var i = 1; i <= scene.numLayers; i++) {
      var tag = LML.tag.read(scene.layer(i));
      if (!tag || tag.mapId !== ${JSON.stringify(mapId)}) continue;
      out.kinds.push(tag.kind);
      if (tag.kind === "route" && tag.data && tag.data.from) { out.count++; out.from = tag.data.from; out.to = tag.data.to; }
    }
    return LML.json.stringify(out);
  })()`);
  return JSON.parse(raw);
}

const summary = (found: RoadRouteFound) => `${found.route.km.toFixed(1)} km, ${durationText(found.route.seconds)}, ${found.route.points.length} points, ${found.ways} ways, ${found.fetched} fetched (${Math.round(found.bytes / 1024)} KB), ${found.kept} kept, ${found.stale} old`;

export async function runRoadTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const folder = path().join(spikeDir(), "RR1-roads");
  fs().rmSync(folder, { recursive: true, force: true });
  setRoadCacheFolder(folder);
  const results: Record<string, unknown> = {};
  try {
    // 1. The drive.
    let started = performance.now();
    const drive = await findRouteOnRoads(DHAKA, CHITTAGONG, "car");
    const driveSeconds = (performance.now() - started) / 1000;
    const n1 = drive.route.roads.filter((use) => use.ref.split(/[;,]/).some((ref) => ref.trim().replace(/\s+/g, "") === "N1")).reduce((total, use) => total + use.km, 0) / drive.route.km;
    const driveRoads = onRoads(drive.route, "car");
    if (drive.fetched !== 3 || !drive.bytes) problems.push(`the drive fetched ${drive.fetched} of 3 areas (${drive.bytes} bytes)`);
    if (drive.route.km < 220 || drive.route.km > 320) problems.push(`the drive is ${drive.route.km.toFixed(1)} km`);
    if (n1 < 0.6) problems.push(`only ${Math.round(n1 * 100)} % of the drive is on N1 (${mainRoads(drive.route, 5)})`);
    if (Math.max(...drive.route.snapKm) > 0.5) problems.push(`the drive's ends are ${drive.route.snapKm.map((km) => km.toFixed(2)).join(" and ")} km from their roads`);
    if (driveRoads.offRoad || driveRoads.offStep) problems.push(`the drive has ${driveRoads.offRoad} points and ${driveRoads.offStep} steps off the roads a car may use`);
    log(`RR1 drive Dhaka to Chittagong: ${summary(drive)} in ${driveSeconds.toFixed(1)} s, ${Math.round(n1 * 100)} % on N1, mostly ${mainRoads(drive.route, 4)}; ${driveRoads.points} points on car roads`, "muted");

    // 2. The walk.
    started = performance.now();
    const walk = await findRouteOnRoads(EIFFEL, LOUVRE, "foot");
    const walkSeconds = (performance.now() - started) / 1000;
    const walkRoads = onRoads(walk.route, "foot");
    if (walk.fetched !== 1) problems.push(`the walk fetched ${walk.fetched} of 1 area`);
    if (walk.route.km < 3 || walk.route.km > 5) problems.push(`the walk is ${walk.route.km.toFixed(2)} km against 3.05 km straight`);
    if (walkRoads.offRoad || walkRoads.offStep) problems.push(`the walk has ${walkRoads.offRoad} points and ${walkRoads.offStep} steps off walkable ways`);
    if (!walkRoads.bridges) problems.push("the walk crosses the Seine on no bridge");
    if (Math.max(...walk.route.snapKm) > 0.15) problems.push(`the walk's ends are ${walk.route.snapKm.map((km) => km.toFixed(3)).join(" and ")} km from their ways`);
    log(`RR1 walk Eiffel Tower to the Louvre: ${summary(walk)} in ${walkSeconds.toFixed(1)} s, ${walkRoads.bridges} bridge ways, mostly ${mainRoads(walk.route, 4)}; ${walkRoads.points} points on walkable ways`, "muted");

    // 3. Offline.
    setNetworkBlocked(true);
    const same = (a: RoadRouteFound, b: RoadRouteFound) => JSON.stringify(a.route.points) === JSON.stringify(b.route.points);
    const driveAgain = await findRouteOnRoads(DHAKA, CHITTAGONG, "car");
    const walkAgain = await findRouteOnRoads(EIFFEL, LOUVRE, "foot");
    if (driveAgain.fetched || driveAgain.bytes || driveAgain.kept !== 3 || !same(drive, driveAgain)) problems.push(`offline, the drive: ${summary(driveAgain)}, same points: ${same(drive, driveAgain)}`);
    if (walkAgain.fetched || walkAgain.kept !== 1 || !same(walk, walkAgain)) problems.push(`offline, the walk: ${summary(walkAgain)}, same points: ${same(walk, walkAgain)}`);
    // Answers older than 30 days are asked for again, and still used when the network fails.
    const old = (Date.now() - 40 * 86400000) / 1000;
    for (const name of fs().readdirSync(folder) as string[]) fs().utimesSync(path().join(folder, name), old, old);
    const driveOld = await findRouteOnRoads(DHAKA, CHITTAGONG, "car");
    const walkOld = await findRouteOnRoads(EIFFEL, LOUVRE, "foot");
    if (driveOld.stale !== 3 || !same(drive, driveOld)) problems.push(`offline with old answers, the drive: ${summary(driveOld)}`);
    if (walkOld.stale !== 1 || !same(walk, walkOld)) problems.push(`offline with old answers, the walk: ${summary(walkOld)}`);
    setRoadCacheFolder(path().join(spikeDir(), "RR1-roads-empty"));
    let emptyMessage = "";
    try {
      await findRouteOnRoads(EIFFEL, LOUVRE, "foot");
      problems.push("offline with nothing on disk, the walk was found");
    } catch (error) {
      emptyMessage = error instanceof Error ? error.message : String(error);
      if (!/not on this computer yet/.test(emptyMessage)) problems.push(`offline with nothing on disk: ${emptyMessage}`);
    }
    setRoadCacheFolder(folder);
    setNetworkBlocked(false);
    log(`RR1 offline: the drive and the walk again from the folder (${driveAgain.kept} and ${walkAgain.kept} areas), and from 40-day-old answers (${driveOld.stale} and ${walkOld.stale}); with nothing on disk: "${emptyMessage}"`, "muted");

    // 4. In After Effects, as ordinary route layers, and a camera move along each.
    const driveView = fitPoints(drive.route.points, SIZE, { bearing: 0, pitch: 30, padding: 0.15 });
    const driveMap = await createMapComp({ name: "RR1 drive", ...SIZE, duration: 8, frameRate: 25, view: driveView, newScene: true });
    const drawnDrive = await addRouteLine(driveMap.id, drive.route.points, { name: "RR1 Dhaka to Chittagong by car", startFrame: 25, endFrame: 175, rig: true, traveller: true });
    const walkView = fitPoints(walk.route.points, SIZE, { bearing: 0, pitch: 0, padding: 0.15 });
    const walkMap = await createMapComp({ name: "RR1 walk", ...SIZE, duration: 8, frameRate: 25, view: walkView, newScene: true });
    const drawnWalk = await addRouteLine(walkMap.id, walk.route.points, { name: "RR1 Eiffel Tower to the Louvre on foot", startFrame: 25, endFrame: 175, comet: true });
    for (const [what, made] of [["drive", drawnDrive], ["walk", drawnWalk]] as const) {
      if (made.expressionErrors.length) problems.push(`the ${what}'s expressions: ${made.expressionErrors.slice(0, 2).join("; ")}`);
      if (made.warnings?.length) problems.push(`the ${what}'s warnings: ${made.warnings.join("; ")}`);
    }
    const driveLayer = await routeLayer(driveMap.id);
    const walkLayer = await routeLayer(walkMap.id);
    const first = drive.route.points[0];
    if (driveLayer.count !== 1 || !driveLayer.from || Math.abs(driveLayer.from[0] - first.lng) > 1e-6 || Math.abs(driveLayer.from[1] - first.lat) > 1e-6) problems.push(`the drive's route layers: ${JSON.stringify(driveLayer)}`);
    if (!driveLayer.kinds.includes("traveller")) problems.push(`no traveller with the drive: ${driveLayer.kinds.join(", ")}`);
    if (walkLayer.count !== 1) problems.push(`the walk's route layers: ${JSON.stringify(walkLayer)}`);
    const driveCamera = cameraAlong(drive.route.points, driveView);
    const walkCamera = cameraAlong(walk.route.points, walkView);
    if (driveCamera > drive.route.km * 0.01) problems.push(`the camera strays ${driveCamera.toFixed(2)} km from the drive`);
    if (walkCamera > walk.route.km * 0.01) problems.push(`the camera strays ${(walkCamera * 1000).toFixed(0)} m from the walk`);
    log(`RR1 in After Effects: the drive as an arrow rig with a traveller (${drawnDrive.points} of ${drive.route.points.length} points), the walk with a comet (${drawnWalk.points} points); the camera along them strays at most ${driveCamera.toFixed(2)} km and ${(walkCamera * 1000).toFixed(0)} m`, "muted");

    Object.assign(results, {
      drive: { km: Math.round(drive.route.km * 10) / 10, time: durationText(drive.route.seconds), n1: Math.round(n1 * 1000) / 10, roads: mainRoads(drive.route, 5), points: drive.route.points.length, ways: drive.ways, bytes: drive.bytes, seconds: Math.round(driveSeconds * 10) / 10, snapKm: drive.route.snapKm },
      walk: { km: Math.round(walk.route.km * 100) / 100, time: durationText(walk.route.seconds), roads: mainRoads(walk.route, 5), points: walk.route.points.length, ways: walk.ways, bridges: walkRoads.bridges, bytes: walk.bytes, seconds: Math.round(walkSeconds * 10) / 10, snapKm: walk.route.snapKm },
      offline: { drive: driveAgain.kept, walk: walkAgain.kept, old: [driveOld.stale, walkOld.stale], empty: emptyMessage },
      camera: { driveKm: driveCamera, walkKm: walkCamera },
      layers: { drive: driveLayer, walk: walkLayer }
    });
  } finally {
    setNetworkBlocked(false);
    setRoadCacheFolder(null);
  }
  const passed = problems.length === 0;
  log(`RR1 routes on roads: ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, ...results, problems };
}
