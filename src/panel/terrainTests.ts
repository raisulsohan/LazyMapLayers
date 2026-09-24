// TR1: elevation packs, shaded slopes and the sky. Downloads the Everest pack (about 20 MB) and a Paris
// pack (about 3 MB) when they are missing, so it runs only when asked for by name. Then: the shading
// changes the picture and is deterministic; it reaches the land pass but not the mattes; the sky fills
// the top of a tilted frame in the base pass alone and can be switched off; on the globe the atmosphere
// stays out of the highlight pass; and renders that use a pack carry the terrain credit.

import type { View } from "../core/camera/camera.ts";
import { projectPoint } from "../core/camera/globe.ts";
import { registerLocalArchive } from "./basemap/maplibreSetup.ts";
import { terrainArchivePath } from "./terrain.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { meanAbsDifference } from "../core/render/temporal.ts";
import { hexToRgb, themeById } from "../core/style/themes.ts";
import { basemapStyle } from "./basemap/basemapStyle.ts";
import { callHost, evalScript, fs, path } from "./cep.ts";
import { ElevationSampler } from "./elevation.ts";
import { addPin } from "./mapApi.ts";
import { createMapComp } from "./mapApi.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";
import { downloadTerrain, hasTerrainPack, planTerrain } from "./terrain.ts";

const PACKS = {
  everest: { west: 86.5, south: 27.6, east: 87.3, north: 28.3, maxZoom: 12 },
  paris: { west: 2.2, south: 48.8, east: 2.48, north: 48.92, maxZoom: 12 }
};

export async function runTerrainTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const downloads: Record<string, number> = {};
  for (const [name, area] of Object.entries(PACKS)) {
    if (hasTerrainPack(name)) continue;
    const started = performance.now();
    const planned = await planTerrain(area, area.maxZoom);
    await downloadTerrain(name, planned, () => undefined);
    downloads[name] = planned.plan.tileBytes;
    log(`TR1: downloaded the ${name} elevation pack, ${(planned.plan.tileBytes / 1048576).toFixed(1)} MB in ${((performance.now() - started) / 1000).toFixed(1)} s`, "muted");
  }
  if (!hasTerrainPack("everest") || !hasTerrainPack("paris")) throw new Error("the elevation packs are missing");

  const size = { width: 1280, height: 720 };
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base", "land", "water", "roads", "landMatte"] }, DEFAULT_FINAL_SETTINGS);
  const read = (result: Awaited<ReturnType<typeof runRenderJob>>, pass: string) => {
    const sequence = result.sequences.find((s) => s.pass === pass);
    if (!sequence) throw new Error(`no ${pass} sequence`);
    return decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;
  };
  const alphaAt = (rgba: Uint8Array, x: number, y: number) => rgba[(y * size.width + x) * 4 + 3];

  // Shaded slopes over Everest: a different picture, deterministic, in the land pass, not in the mattes.
  const everest: View = { center: { lat: 27.95, lng: 86.9 }, zoom: 10.2, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "TR1 terrain", ...size, duration: 1, frameRate: 25, view: everest, newScene: true });
  const flat = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "daylight" });
  const shaded = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "daylight", terrain: { pack: "everest", shade: 0.7, height: 0, ground: 0 } });
  const change = meanAbsDifference(read(flat, "base"), read(shaded, "base"));
  if (change < 4) problems.push(`shaded slopes change the base pass by only ${change.toFixed(2)} per channel`);
  const landChange = meanAbsDifference(read(flat, "land"), read(shaded, "land"));
  if (landChange < 4) problems.push(`the land pass is not shaded (${landChange.toFixed(2)})`);
  if (Buffer.compare(fs().readFileSync(flat.sequences.find((s) => s.pass === "landMatte")!.firstFramePath), fs().readFileSync(shaded.sequences.find((s) => s.pass === "landMatte")!.firstFramePath)) !== 0) problems.push("the land matte changed with the shading");
  if (!shaded.passes.includes("base") || shaded.rendered !== 1) problems.push(`the shaded render drew ${shaded.rendered} frames`);
  const credit = await evalScript(
    `(function () { var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp; for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "attribution") return String(scene.layer(i).property("ADBE Text Properties").property("ADBE Text Document").value.text); } return ""; })()`
  );
  if (credit !== "Terrain: © Mapterhorn") problems.push(`the data credit reads "${credit}"`);

  // The shaded slopes as their own pass: a layer of shadows and highlights with alpha, to grade or
  // switch off in After Effects. Without an elevation pack the pass would be empty, so it is dropped.
  const withTerrainPass = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base", "terrain"] }, DEFAULT_FINAL_SETTINGS);
  const shadedPass = await runRenderJob({ mapId: map.id, quality: "final", settings: withTerrainPass, basemap: { kind: "world" }, theme: "daylight", terrain: { pack: "everest", shade: 0.7, height: 0, ground: 0 } });
  const flatPass = await runRenderJob({ mapId: map.id, quality: "final", settings: withTerrainPass, basemap: { kind: "world" }, theme: "daylight" });
  if (!shadedPass.passes.includes("terrain")) problems.push(`with a pack the passes are ${shadedPass.passes.join(",")}`);
  if (flatPass.passes.includes("terrain")) problems.push(`without a pack the terrain pass was rendered anyway: ${flatPass.passes.join(",")}`);
  const terrainPixels = read(shadedPass, "terrain");
  let shadedPixels = 0;
  let darkest = 255;
  let brightest = 0;
  for (let i = 0; i < terrainPixels.length; i += 4) {
    if (terrainPixels[i + 3] === 0) continue;
    shadedPixels++;
    darkest = Math.min(darkest, terrainPixels[i]);
    brightest = Math.max(brightest, terrainPixels[i]);
  }
  const shadedShare = shadedPixels / (terrainPixels.length / 4);
  if (shadedShare < 0.2) problems.push(`the terrain pass covers ${(shadedShare * 100).toFixed(1)} % of the frame`);
  if (brightest - darkest < 30) problems.push(`the terrain pass is flat: ${darkest} to ${brightest}`);

  const style = basemapStyle({ kind: "world" }, { labels: false, theme: "daylight", viewport: size, terrain: { pack: "everest", shade: 0.7, height: 0, ground: 0 } });
  const renderer = new FrameRenderer({ width: size.width, height: size.height, style, antialias: false });
  let sameTwice = false;
  try {
    await renderer.init();
    await renderer.setView(everest, 0);
    const first = renderer.draw("base").pixels.slice();
    await renderer.setView({ ...everest, bearing: 40 }, 40);
    renderer.draw("base");
    await renderer.setView(everest, 80);
    const again = renderer.draw("base").pixels;
    sameTwice = Buffer.compare(first, again) === 0;
    if (!sameTwice) problems.push(`the shaded frame differs when drawn again (${meanAbsDifference(first, again).toFixed(3)} per channel)`);
  } finally {
    renderer.destroy();
  }

  // The sky: a tilted flat map has the look's sky at the top of the base pass, nothing there in the roads pass.
  const tilted: View = { center: { lat: 27.9, lng: 86.9 }, zoom: 9.5, bearing: 20, pitch: 80 };
  const skyMap = await createMapComp({ name: "TR1 sky", ...size, duration: 1, frameRate: 25, view: tilted, newScene: true });
  const withSky = await runRenderJob({ mapId: skyMap.id, quality: "final", settings, basemap: { kind: "world" }, theme: "midnight", terrain: { pack: "everest", shade: 0.6, height: 0, ground: 0 } });
  const base = read(withSky, "base");
  const roads = read(withSky, "roads");
  const water = read(withSky, "water");
  const skyColour = hexToRgb(themeById("midnight").sky.sky);
  const top = (rgba: Uint8Array) => [rgba[(4 * size.width + 640) * 4], rgba[(4 * size.width + 640) * 4 + 1], rgba[(4 * size.width + 640) * 4 + 2], rgba[(4 * size.width + 640) * 4 + 3]];
  const topBase = top(base);
  if (topBase[3] !== 255 || Math.abs(topBase[0] - skyColour[0] * 255) > 40 || Math.abs(topBase[2] - skyColour[2] * 255) > 40) problems.push(`the top of the tilted base pass is ${topBase}, the sky colour ${skyColour.map((c) => Math.round(c * 255))}`);
  if (alphaAt(roads, 640, 4) !== 0) problems.push(`the roads pass carries the sky (alpha ${alphaAt(roads, 640, 4)})`);
  if (alphaAt(water, 640, 4) === 0) problems.push("the water pass lost the sky (it holds the background)");
  const noSky = await runRenderJob({ mapId: skyMap.id, quality: "final", settings, basemap: { kind: "world" }, theme: "midnight", terrain: { pack: "everest", shade: 0.6, height: 0, ground: 0 }, sky: false });
  const bare = read(noSky, "base");
  if (alphaAt(bare, 640, 4) !== 0 || alphaAt(bare, 640, 700) !== 255) problems.push(`without a sky the base pass is ${top(bare)} at the top and alpha ${alphaAt(bare, 640, 700)} at the bottom`);

  // On the globe the atmosphere belongs to the base pass; a highlight pass shows nothing in space.
  const globeView: View = { center: { lat: 28, lng: 86 }, zoom: 1.6, bearing: 0, pitch: 0 };
  const globeMap = await createMapComp({ name: "TR1 globe", ...size, duration: 1, frameRate: 25, view: globeView, projection: "globe", newScene: true });
  const globe = await runRenderJob({ mapId: globeMap.id, quality: "final", settings: normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base", "roads"] }, DEFAULT_FINAL_SETTINGS), basemap: { kind: "world" }, theme: "midnight", highlights: [{ code: "NPL", name: "Nepal", color: "#36b3ff", fill: 0.5, outline: 3 }] });
  const globeBase = read(globe, "base");
  const globeHighlight = read(globe, "highlight-NPL");
  const globeRoads = read(globe, "roads");
  // Along the equator from the left: the haze begins before the planet does, in the base pass alone.
  const row = size.height / 2;
  let haze = -1;
  let planet = -1;
  for (let x = 0; x < size.width / 2; x++) {
    const alpha = alphaAt(globeBase, x, row);
    if (haze < 0 && alpha > 0) haze = x;
    if (alpha === 255) {
      planet = x;
      break;
    }
  }
  if (haze < 0 || planet < 0 || planet - haze < 3) problems.push(`the globe's base pass: haze starts at ${haze}, the planet at ${planet}`);
  const outside = Math.max(0, planet - 2);
  if (haze >= 0 && (alphaAt(globeHighlight, outside, row) !== 0 || alphaAt(globeRoads, outside, row) !== 0)) problems.push(`the atmosphere leaks into other passes at x=${outside}: highlight ${alphaAt(globeHighlight, outside, row)}, roads ${alphaAt(globeRoads, outside, row)}`);
  for (let x = haze; haze >= 0 && x < planet; x++) if (alphaAt(globeHighlight, x, row) !== 0) problems.push(`the highlight pass shows something in the haze at x=${x}`);

  // 3D terrain: the ground rises, a pin made with the pack sits on the peak in After Effects exactly where
  // the renderer draws a marker there, the camera stays where the maths expects it, and a keyed Terrain
  // Height slider makes the mountains rise frame by frame.
  const peak = { lat: 27.9881, lng: 86.925 };
  const view3d: View = { center: { lat: 27.95, lng: 86.9 }, zoom: 10.6, bearing: 30, pitch: 55 };
  const map3d = await createMapComp({ name: "TR1 3D", ...size, duration: 5 / 25, frameRate: 25, view: view3d, newScene: true });
  const terrain3d = { pack: "everest", shade: 0.5, height: 1.5, ground: 4000 };
  await callHost("setMapSettings", { mapId: map3d.id, terrain: terrain3d });
  const sampler = new ElevationSampler("everest");
  const peakElevation = await sampler.elevationAt(peak);
  const centreElevation = await sampler.elevationAt(view3d.center);
  sampler.close();
  if (peakElevation < 8400 || peakElevation > 8900) problems.push(`the pack puts Everest's peak at ${peakElevation} m`);
  if (centreElevation < 2000 || centreElevation > 7000) problems.push(`the pack puts the map centre at ${centreElevation} m`);
  const pin = await addPin(map3d.id, peak, { name: "Peak", elevation: peakElevation });
  if (pin.expressionErrors.length) problems.push(`pin on terrain: ${pin.expressionErrors.join("; ")}`);
  const threeD = await runRenderJob({ mapId: map3d.id, quality: "final", settings: normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS), basemap: { kind: "world" }, theme: "daylight", terrain: terrain3d, markers: [{ ...peak, radius: 5, color: "#ff0000" }] });
  if (threeD.cameraLifted) problems.push(`the camera was lifted in ${threeD.cameraLifted} frames`);
  const frame3d = read(threeD, "base");
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < frame3d.length; i += 4) {
    if (frame3d[i] > 200 && frame3d[i + 1] < 80 && frame3d[i + 2] < 80) {
      sx += (i / 4) % size.width;
      sy += Math.floor(i / 4 / size.width);
      n++;
    }
  }
  const marker = n ? { x: sx / n, y: sy / n } : null;
  const aePin = JSON.parse(
    await evalScript(`(function () { var scene = LML.pins.findMapLayer(${JSON.stringify(map3d.id)}).containingComp; for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "pin") { var p = scene.layer(i).property("ADBE Transform Group").property("ADBE Position"); var v = p.valueAtTime(0, false); return LML.json.stringify({ x: v[0], y: v[1], error: p.expressionError || "" }); } } return "null"; })()`)
  ) as { x: number; y: number; error: string } | null;
  const off3d = marker && aePin ? Math.hypot(marker.x - aePin.x, marker.y - aePin.y) : Infinity;
  if (!marker) problems.push("the peak marker is not in the 3D frame");
  if (!aePin || aePin.error) problems.push(`the pin in After Effects: ${JSON.stringify(aePin)}`);
  if (off3d > 2.5) problems.push(`on 3D terrain the pin sits ${off3d.toFixed(1)} px from the rendered peak (marker ${marker?.x.toFixed(1)}, ${marker?.y.toFixed(1)}; pin ${aePin?.x.toFixed(1)}, ${aePin?.y.toFixed(1)})`);
  // Flat against 3D: the map layer's Terrain Height slider is what counts (it may be keyed), so the flat
  // render sets it to 0 rather than asking the job for 0.
  await callHost("setControlKeys", { mapId: map3d.id, name: "Terrain Height", times: [0], values: [0] });
  const flat3d = await runRenderJob({ mapId: map3d.id, quality: "final", settings: normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS), basemap: { kind: "world" }, theme: "daylight", terrain: { ...terrain3d, height: 0 }, markers: [{ ...peak, radius: 5, color: "#ff0000" }] });
  const rise = meanAbsDifference(read(flat3d, "base"), frame3d);
  if (rise < 8) problems.push(`3D terrain changes the frame by only ${rise.toFixed(1)} per channel`);

  // A keyed Terrain Height: frame 0 flat, the last frame lifted, both drawn from the same cache keys as their plain counterparts.
  await callHost("setControlKeys", { mapId: map3d.id, name: "Terrain Height", times: [0, 4 / 25], values: [0, 1.5] });
  const keyed = await runRenderJob({ mapId: map3d.id, quality: "final", settings: normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS), basemap: { kind: "world" }, theme: "daylight", terrain: terrain3d, markers: [{ ...peak, radius: 5, color: "#ff0000" }] });
  const keyedFolder = keyed.sequences.find((q) => q.pass === "base")!.folder;
  const keyedFirst = decodePng(new Uint8Array(fs().readFileSync(path().join(keyedFolder, sequenceFileName(0))))).rgba;
  const keyedLast = decodePng(new Uint8Array(fs().readFileSync(path().join(keyedFolder, sequenceFileName(4))))).rgba;
  // Frame 0 is drawn through the terrain at height 0: MapLibre resamples the map onto its mesh, so it
  // is a little softer than a render without terrain, but it is the flat picture, not the lifted one.
  const flatDiff = meanAbsDifference(keyedFirst, read(flat3d, "base"));
  const liftedDiff = meanAbsDifference(keyedLast, frame3d);
  if (flatDiff > 8 || flatDiff * 3 > meanAbsDifference(keyedFirst, frame3d) || liftedDiff > 0.5) problems.push(`keyed height: frame 0 differs from flat by ${flatDiff.toFixed(2)} (from lifted by ${meanAbsDifference(keyedFirst, frame3d).toFixed(2)}), the last frame from 1.5× by ${liftedDiff.toFixed(2)}`);
  if (keyed.frames !== 5) problems.push(`the keyed comp has ${keyed.frames} frames`);

  // A picture for people: Everest in 3D, shaded, tilted, with the sky.
  try {
    const file = path().join(spikeDir(), "terrain-sample.png");
    const tall = await createMapComp({ name: "TR1 picture", ...size, duration: 1, frameRate: 25, view: { center: { lat: 27.93, lng: 86.88 }, zoom: 10.8, bearing: 20, pitch: 72 }, newScene: true });
    await callHost("setMapSettings", { mapId: tall.id, terrain: { ...terrain3d, height: 1.3, ground: 5000 } });
    const picture = await runRenderJob({ mapId: tall.id, quality: "final", settings: normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 2, passes: ["base"] }, DEFAULT_FINAL_SETTINGS), basemap: { kind: "world" }, theme: "midnight", terrain: { ...terrain3d, height: 1.3, ground: 5000 } });
    fs().copyFileSync(picture.sequences.find((q) => q.pass === "base")!.firstFramePath, file);
  } catch (error) {
    problems.push(`the sample picture failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = problems.length === 0;
  log(`TR1 terrain: shading changes the base by ${change.toFixed(1)} per channel, ${sameTwice ? "deterministic" : "NOT deterministic"}, sky ${topBase.join(",")}, 3D pin ${off3d.toFixed(2)} px off the rendered peak, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, change, landChange, sameTwice, topBase, off3d, peakElevation, centreElevation, terrainPass: { share: +shadedShare.toFixed(3), darkest, brightest }, downloads, problems };
}

/** TS1: how MapLibre's 3D terrain places things against the core camera maths (a spike, not a test of the product). */
export async function runTerrainSpike(log: SpikeLog): Promise<Record<string, unknown>> {
  const size = { width: 1280, height: 720 };
  const peak = { lat: 27.9881, lng: 86.925 };
  const out: Record<string, unknown> = {};
  for (const centerElevation of [0, 3000]) {
    for (const view of [
      { center: { lat: 27.95, lng: 86.9 }, zoom: 11.5, bearing: 0, pitch: 0 },
      { center: { lat: 27.95, lng: 86.9 }, zoom: 11.5, bearing: 30, pitch: 60 },
      { center: { lat: 27.99, lng: 86.93 }, zoom: 12.5, bearing: -20, pitch: 45 },
      { center: { lat: 27.95, lng: 86.9 }, zoom: 9.2, bearing: 120, pitch: 75 }
    ] as View[]) {
      for (const exaggeration of [1, 1.8]) {
        const base = basemapStyle({ kind: "world" }, { labels: false, theme: "daylight", viewport: size, markers: [{ ...peak, radius: 6, color: "#ff0000" }] });
        const url = registerLocalArchive("lml-terrain-everest", terrainArchivePath("everest"));
        const style = { ...base, sources: { ...base.sources, "lml-3d": { type: "raster-dem" as const, url, encoding: "terrarium" as const, tileSize: 512 } }, terrain: { source: "lml-3d", exaggeration } };
        const renderer = new FrameRenderer({ width: size.width, height: size.height, style, antialias: false, terrain: { ground: centerElevation / exaggeration, height: exaggeration } });
        try {
          await renderer.init();
          await renderer.setView(view, 0);
          const frame = await renderer.renderFrame(view, 0);
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (let i = 0; i < frame.rgba.length; i += 4) {
            if (frame.rgba[i] > 200 && frame.rgba[i + 1] < 80 && frame.rgba[i + 2] < 80) {
              sx += (i / 4) % size.width;
              sy += Math.floor(i / 4 / size.width);
              n++;
            }
          }
          const drawn = n ? { x: sx / n, y: sy / n } : null;
          const m = renderer.maplibre;
          const surface = m.queryTerrainElevation([peak.lng, peak.lat]) ?? 0;
          const lifted = projectPoint(view, size, peak, { altitudeMeters: surface - centerElevation });
          const naive = projectPoint(view, size, peak, { altitudeMeters: 8849 * exaggeration - centerElevation });
          const state = { center: m.getCenter().toArray(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), elevation: m.getCenterElevation(), surface };
          const key = `e${centerElevation} z${view.zoom} p${view.pitch} ex${exaggeration}`;
          const offLifted = drawn ? Math.hypot(drawn.x - lifted.x, drawn.y - lifted.y) : null;
          const offNaive = drawn ? Math.hypot(drawn.x - naive.x, drawn.y - naive.y) : null;
          out[key] = { drawn, lifted: [lifted.x, lifted.y], offLifted, offNaive, pixels: n, state };
          log(`TS1 ${key}: marker ${drawn ? `${drawn.x.toFixed(1)},${drawn.y.toFixed(1)}` : "not found"} | off ${offLifted?.toFixed(2)} (naive ${offNaive?.toFixed(1)}) | surface ${surface.toFixed(0)} m | zoom ${state.zoom.toFixed(3)} pitch ${state.pitch} elev ${state.elevation}`, "muted");
        } finally {
          renderer.destroy();
        }
      }
    }
  }
  return out;
}
