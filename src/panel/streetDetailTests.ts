// SD1: street detail on demand on a light install (DECISIONS D101). Goes online: only when named.
//
// The light pack (the world to zoom 6, from tools/build-offline-pack.ts --light) and an empty tile cache
// in a test folder stand in for a fresh Light install. A fly-to from Bangladesh into Dhaka's streets with
// an orbit at street level, made with the shot list, then:
//   1. rendered online with nothing downloaded: the tiles its frames need are fetched, no frame lacks
//      any, MapLibre asks for nothing the plan did not foresee, and the streets are there (the last frame
//      differs from the light pack alone over most of the picture);
//   2. a region of the same streets is downloaded and the map rendered from it: every frame where that
//      region is fully in and holds the whole frame matches the street detail frame;
//   3. offline (every request fails as without a connection), the same move on a second map renders
//      from the cache alone: nothing fetched, nothing lacking, every frame equal to the online one up to
//      the antialiasing noise of two renderers (S6: a few pixels a few levels apart; here at most one
//      pixel in 10,000 beyond 2/255 and no step over 8/255);
//   4. offline with an empty cache: the frames past zoom 7 are named as lacking street detail and drawn
//      with the light pack, and the summary says so;
//   5. offline with only the world's zooms 7 to 9 in the cache: the frames past zoom 10 are named, and
//      drawn with that world detail rather than the light pack.

import type { View } from "../core/camera/camera.ts";
import { unproject } from "../core/camera/camera.ts";
import { normaliseShotList, bakeShots, type Shot } from "../core/camera/shots.ts";
import { keyOf } from "../core/render/frameKey.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, sequenceFileName, type RenderSettings } from "../core/render/plan.ts";
import { regionFadeZooms } from "../core/tiles/regionFade.ts";
import type { Bbox } from "../core/tiles/tileMath.ts";
import { callHost, callHostWithJobFile, extensionRoot, fs, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { setNetworkBlocked } from "./net.ts";
import { installedWorld, osmBuild, resetOsmOffline, setOsmTileOverrides, setStreetDetailOverride } from "./osmTiles.ts";
import { downloadRegion, planRegion } from "./regions.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { regionHeader } from "./basemap/basemapStyle.ts";
import { runRenderJob, type RenderJobResult } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 960, height: 540 };
const FPS = 25;
const SETTINGS: RenderSettings = { ...DEFAULT_FINAL_SETTINGS, scale: 1, supersample: 1, motionBlur: false, passes: ["base"], labels: false };
const REGION = "sd1-dhaka";

const bangladesh: View = { center: { lng: 90.35, lat: 23.7 }, zoom: 5.5, bearing: 0, pitch: 0 };
const streets: View = { center: { lng: 90.4125, lat: 23.7925 }, zoom: 15.2, bearing: 20, pitch: 45 };

const shotList = () =>
  normaliseShotList({
    v: 1,
    start: 0,
    shots: [
      { id: "a", name: "Bangladesh", view: bangladesh, hold: 0.5, move: { kind: "cut", seconds: 0, easing: { id: "linear" } } },
      { id: "b", name: "Dhaka", view: streets, hold: 2, orbit: 15, move: { kind: "fly", seconds: 6, easing: { id: "smooth" }, height: "normal", pitchDip: true } }
    ] as Shot[]
  });

/** The light pack built by tools/build-offline-pack.ts --light next to the development build. */
function lightWorld(): string | null {
  try {
    const repo = path().dirname(fs().realpathSync(extensionRoot()));
    const file = path().join(repo, ".cache", "offline", "light", "offline", "world.pmtiles");
    return fs().existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

async function makeMap(name: string): Promise<string> {
  const list = shotList();
  const baked = bakeShots(list, SIZE, FPS);
  const map = await createMapComp({ name, ...SIZE, duration: baked.endTime + 1 / FPS, frameRate: FPS, view: bangladesh, newScene: true });
  await callHost("extendDuration", { mapId: map.id, duration: baked.endTime + 1 / FPS });
  await callHostWithJobFile("applyShots", { mapId: map.id, list, hash: keyOf(list), baked: { startTime: baked.startTime, endTime: baked.endTime, controls: baked.controls, holdTimes: baked.holdTimes, markers: baked.markers } });
  return map.id;
}

async function views(mapId: string, frames: number): Promise<View[]> {
  const sampled = await callHost<{ views: number[][][] }>("sampleViews", { mapId, firstFrame: 0, lastFrame: frames - 1, offsets: [0], compact: true });
  return sampled.views.map(([v]) => ({ center: { lat: v[0], lng: v[1] }, zoom: v[2], bearing: v[3], pitch: v[4] }));
}

function frameOf(result: RenderJobResult, frame: number): Uint8Array {
  const folder = result.sequences.find((s) => s.pass === "base")!.folder;
  return decodePng(new Uint8Array(fs().readFileSync(path().join(folder, sequenceFileName(frame))))).rgba;
}

/** Distinct colours in a frame (every 97th pixel), to tell a drawn map from a flat one. */
function colours(rgba: Uint8Array): number {
  const seen = new Set<number>();
  for (let at = 0; at < rgba.length; at += 4 * 97) seen.add((rgba[at] << 16) | (rgba[at + 1] << 8) | rgba[at + 2]);
  return seen.size;
}

/** Copies the tiles of some zooms from one tile cache to another. */
function copyZooms(from: string, to: string, zooms: number[]): number {
  let files = 0;
  const copy = (a: string, b: string) => {
    fs().mkdirSync(b, { recursive: true });
    for (const entry of fs().readdirSync(a, { withFileTypes: true })) {
      if (entry.isDirectory()) copy(path().join(a, entry.name), path().join(b, entry.name));
      else if (entry.name.endsWith(".mvt")) {
        fs().copyFileSync(path().join(a, entry.name), path().join(b, entry.name));
        files++;
      }
    }
  };
  for (const z of zooms) if (fs().existsSync(path().join(from, String(z)))) copy(path().join(from, String(z)), path().join(to, String(z)));
  return files;
}

/** Share of pixels (in %) whose colour differs by more than `tolerance` in any channel. */
function differing(a: Uint8Array, b: Uint8Array, tolerance = 2): number {
  let n = 0;
  for (let at = 0; at < a.length; at += 4) {
    if (Math.abs(a[at] - b[at]) > tolerance || Math.abs(a[at + 1] - b[at + 1]) > tolerance || Math.abs(a[at + 2] - b[at + 2]) > tolerance) n++;
  }
  return (n / (a.length / 4)) * 100;
}

/** The ground a view shows (its four corners, which lie below the horizon at these pitches). */
function footprint(view: View): Bbox | null {
  const corners = [
    { x: 0, y: 0 },
    { x: SIZE.width, y: 0 },
    { x: SIZE.width, y: SIZE.height },
    { x: 0, y: SIZE.height }
  ].map((p) => unproject(view, SIZE, p));
  if (corners.some((c) => !c)) return null;
  const lngs = corners.map((c) => c!.lng);
  const lats = corners.map((c) => c!.lat);
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

const inside = (inner: Bbox, outer: Bbox) => inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;

export async function runStreetDetailTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const light = lightWorld();
  if (!light) return { passed: false, problems: ["no light pack next to the development build: node tools/build-offline-pack.ts --light"] };
  const folder = path().join(spikeDir(), "SD1");
  fs().rmSync(folder, { recursive: true, force: true });
  fs().mkdirSync(folder, { recursive: true });
  const cache = path().join(folder, "osm-cache");
  const results: Record<string, unknown> = {};

  // A light install: the light pack, an empty cache, and no downloaded regions in the tile chain.
  setOsmTileOverrides({ world: light, cache, regions: false });
  setStreetDetailOverride(true);
  resetOsmOffline();
  setNetworkBlocked(false);
  try {
    check(installedWorld()?.maxZoom === 6, `the light pack reaches zoom ${installedWorld()?.maxZoom}, not 6`);

    // 1. Online, nothing downloaded.
    const mapId = await makeMap("SD1 streets");
    let started = performance.now();
    const online = await runRenderJob({ mapId, quality: "final", settings: SETTINGS, basemap: { kind: "world" }, theme: "daylight" });
    const frames = online.frames;
    const cameras = await views(mapId, frames);
    const detail = online.streetDetail;
    results.online = { frames, seconds: Math.round(performance.now() - started) / 1000, tiles: detail?.tiles, fetched: detail?.fetched, megabytes: Math.round(((detail?.bytes ?? 0) / 1048576) * 10) / 10, lacking: detail?.lacking.length, unforeseen: detail?.unforeseen, build: await osmBuild() };
    log(`SD1 online: ${frames} frames, ${detail?.tiles} tiles needed past the light pack, ${detail?.fetched} fetched (${((detail?.bytes ?? 0) / 1048576).toFixed(1)} MB) in ${((performance.now() - started) / 1000).toFixed(1)} s`, "muted");
    check(!!detail && detail.fetched > 0, "nothing was fetched");
    check(!!detail && detail.lacking.length === 0, `frames lack detail online: ${detail?.lackingText}`);
    check(!!detail && detail.unforeseen === 0, `${detail?.unforeseen} tiles MapLibre asked for were not foreseen`);
    // The streets are there: the last frame against the light pack alone.
    const lightOnly = await runRenderJob({ mapId, quality: "preview", settings: SETTINGS, basemap: { kind: "world" }, theme: "daylight", streetDetail: false });
    const last = frames - 1;
    const streetsShare = differing(frameOf(online, last), frameOf(lightOnly, last));
    results.streetsShare = Math.round(streetsShare * 10) / 10;
    check(streetsShare > 25, `the last frame differs from the light pack alone on only ${streetsShare.toFixed(1)} % of the picture`);

    // 2. A downloaded region of the same streets.
    let box: Bbox | null = null;
    for (const view of cameras.filter((v) => v.zoom >= 13)) {
      const f = footprint(view);
      if (f) box = box ? { west: Math.min(box.west, f.west), south: Math.min(box.south, f.south), east: Math.max(box.east, f.east), north: Math.max(box.north, f.north) } : f;
    }
    if (!box) throw new Error("no frame of the move is at street level");
    // A margin of half the street-level area on each side, so the region also holds the tiles MapLibre
    // loads just outside a frame.
    const marginX = (box.east - box.west) * 0.5;
    const marginY = (box.north - box.south) * 0.5;
    const bbox = { west: box.west - marginX, south: box.south - marginY, east: box.east + marginX, north: box.north + marginY };
    const planned = await planRegion(bbox, 15);
    results.region = { bbox, tiles: planned.plan.tiles.length, megabytes: Math.round((planned.plan.tileBytes / 1048576) * 10) / 10, build: planned.build };
    check(planned.build === (await osmBuild()), `the region comes from build ${planned.build}, the cache from ${await osmBuild()}`);
    started = performance.now();
    await downloadRegion(REGION, planned, () => undefined);
    log(`SD1 region: ${planned.plan.tiles.length} tiles (${(planned.plan.tileBytes / 1048576).toFixed(1)} MB) in ${((performance.now() - started) / 1000).toFixed(1)} s`, "muted");
    const fromRegion = await runRenderJob({ mapId, quality: "preview", settings: SETTINGS, basemap: { kind: "region", name: REGION }, theme: "daylight" });
    const header = regionHeader(REGION)!;
    const fadeIn = regionFadeZooms(header.bounds, SIZE);
    let compared = 0;
    let worst = 0;
    let worstFrame = -1;
    for (let frame = 0; frame < frames; frame++) {
      const view = cameras[frame];
      const f = footprint(view);
      if (view.zoom < fadeIn.to || !f || !inside(f, header.bounds)) continue;
      compared++;
      const share = differing(frameOf(online, frame), frameOf(fromRegion, frame));
      if (share > worst) {
        worst = share;
        worstFrame = frame;
      }
    }
    results.regionMatch = { fadeIn, compared, worstShare: Math.round(worst * 1000) / 1000, worstFrame };
    log(`SD1 region match: ${compared} frames compared from zoom ${fadeIn.to.toFixed(2)}, worst ${worst.toFixed(3)} % of pixels apart (frame ${worstFrame + 1})`, "muted");
    check(compared >= 25, `only ${compared} frames could be compared with the region`);
    check(worst <= 0.05, `frame ${worstFrame + 1} differs from the region's on ${worst.toFixed(3)} % of the picture`);

    // 3. Offline, from the cache.
    setNetworkBlocked(true);
    resetOsmOffline();
    const offlineId = await makeMap("SD1 offline");
    const offline = await runRenderJob({ mapId: offlineId, quality: "final", settings: SETTINGS, basemap: { kind: "world" }, theme: "daylight" });
    const again = offline.streetDetail;
    // Two renderers differ by a few pixels of a few levels where glowing coast lines meet (S6: the coast
    // glow with multisampling, frames with no street detail at all show it too): equal means within that.
    let noisy = 0;
    let worstPixels = 0;
    let worstStep = 0;
    for (let frame = 0; frame < frames; frame++) {
      const a = frameOf(online, frame);
      const b = frameOf(offline, frame);
      let pixels = 0;
      for (let at = 0; at < a.length; at += 4) {
        const step = Math.max(Math.abs(a[at] - b[at]), Math.abs(a[at + 1] - b[at + 1]), Math.abs(a[at + 2] - b[at + 2]));
        if (step > 2) pixels++;
        worstStep = Math.max(worstStep, step);
      }
      if (pixels) noisy++;
      worstPixels = Math.max(worstPixels, pixels);
    }
    const unequal = worstPixels > (SIZE.width * SIZE.height) / 10000 || worstStep > 8 ? noisy : 0;
    results.offline = { rendered: offline.rendered, onlineRendered: online.rendered, fetched: again?.fetched, lacking: again?.lacking.length, unforeseen: again?.unforeseen, framesWithNoise: noisy, worstPixelsBeyond2: worstPixels, worstStep };
    log(`SD1 offline: ${offline.rendered} frames rendered from the cache; ${noisy} differ from the online render in at most ${worstPixels} pixels by at most ${worstStep}/255`, "muted");
    // Held frames share one render, so both renders draw the same number of unique frames.
    check(offline.rendered === online.rendered, `offline rendered ${offline.rendered} frames, online ${online.rendered}`);
    check(!!again && again.fetched === 0 && again.lacking.length === 0 && again.unforeseen === 0, `offline: ${JSON.stringify(again)}`);
    check(unequal === 0, `frames rendered offline differ from the online ones beyond the renderer's noise: up to ${worstPixels} pixels, ${worstStep}/255`);

    // 4. Offline with an empty cache: the frames are named, and drawn with the light pack.
    setOsmTileOverrides({ world: light, cache: path().join(folder, "empty-cache"), regions: false });
    resetOsmOffline();
    const bare = await runRenderJob({ mapId: offlineId, quality: "preview", settings: SETTINGS, basemap: { kind: "world" }, theme: "daylight" });
    const lacking = bare.streetDetail?.lacking ?? [];
    const firstLacking = lacking.length ? Math.min(...lacking) : -1;
    const firstPastSeven = cameras.findIndex((v) => v.zoom >= 7);
    // Out at zoom 8 the light pack still draws a country: a lacking frame there is not empty.
    const nearEight = cameras.findIndex((v) => v.zoom >= 8);
    const eightColours = colours(frameOf(bare, nearEight));
    results.emptyCache = { lacking: lacking.length, worldOnly: bare.streetDetail?.worldOnly.length, firstLacking, firstPastSeven, why: bare.streetDetail?.why, text: bare.streetDetail?.lackingText, coloursAtZoom8: eightColours };
    log(`SD1 offline, empty cache: ${bare.streetDetail?.lackingText} lack street detail (${bare.streetDetail?.why})`, "muted");
    check(lacking.length > 0 && firstLacking <= firstPastSeven + 1 && firstLacking >= firstPastSeven - 1, `lacking frames start at ${firstLacking + 1}, the move passes zoom 7 at frame ${firstPastSeven + 1}`);
    check(lacking.every((frame) => cameras[frame].zoom >= 6.9), "a frame below zoom 7 is said to lack detail");
    check(bare.streetDetail?.why === "offline", `the reason is ${bare.streetDetail?.why}, not offline`);
    check(/^frames? \d+/.test(bare.streetDetail?.lackingText ?? ""), `the frames are not named: ${bare.streetDetail?.lackingText}`);
    check((bare.streetDetail?.worldOnly.length ?? 0) === 0, "with an empty cache a frame was drawn with world detail");
    check(eightColours > 3, `the frame at zoom 8 drawn with the light pack has ${eightColours} colours: empty`);

    // 5. Offline with the world's zooms 7 to 9 kept, but no streets.
    const worldCache = path().join(folder, "world-cache");
    const copied = copyZooms(cache, worldCache, [7, 8, 9]);
    setOsmTileOverrides({ world: light, cache: worldCache, regions: false });
    resetOsmOffline();
    const worldOnly = await runRenderJob({ mapId: offlineId, quality: "preview", settings: SETTINGS, basemap: { kind: "world" }, theme: "daylight" });
    const partly = worldOnly.streetDetail;
    const firstPastTen = cameras.findIndex((v) => v.zoom >= 10);
    const nearEleven = cameras.findIndex((v) => v.zoom >= 11);
    const elevenWorld = frameOf(worldOnly, nearEleven);
    const elevenBare = frameOf(bare, nearEleven);
    results.worldCache = { copied, lacking: partly?.lacking.length, worldOnly: partly?.worldOnly.length, firstLacking: partly?.lacking.length ? Math.min(...partly.lacking) : -1, firstPastTen, coloursAtZoom11: colours(elevenWorld), apartFromLightPackAtZoom11: Math.round(differing(elevenWorld, elevenBare) * 10) / 10 };
    log(`SD1 offline, world kept: ${partly?.lackingText} lack street detail, ${partly?.worldOnly.length} of them drawn with the world detail kept`, "muted");
    check(!!partly && partly.lacking.length > 0 && partly.lacking.length === partly.worldOnly.length, `with the world kept, ${partly?.lacking.length} frames lack detail and ${partly?.worldOnly.length} keep the world`);
    check(!!partly && Math.abs(Math.min(...partly.lacking) - firstPastTen) <= 1, `lacking frames start at ${partly && Math.min(...partly.lacking) + 1}, the move passes zoom 10 at frame ${firstPastTen + 1}`);
    check(colours(elevenWorld) > 3 && differing(elevenWorld, elevenBare) > 5, "at zoom 11 the world detail kept draws nothing more than the light pack");
  } finally {
    setNetworkBlocked(false);
    setOsmTileOverrides(null);
    setStreetDetailOverride(false);
    resetOsmOffline();
    fs().rmSync(regionArchivePath(REGION), { force: true });
  }
  return { passed: problems.length === 0, problems, ...results };
}
