// SL1: map features as editable After Effects shape layers. A country is added as a shape layer and
// After Effects' own frame is compared with the country the renderer draws: the two outlines must
// cover the same pixels. A country with a hole (South Africa around Lesotho) checks the even-odd fill,
// and the layer itself must be a plain shape layer with paths, a fill and a stroke.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { evalScript, fs, path } from "./cep.ts";
import { countryOutline } from "./data/countries.ts";
import { createMapComp } from "./mapApi.ts";
import { addFeatureShape } from "./overlays/shapeFeature.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 1280, height: 720 };

/** Switches the rendered basemap layers off, so a saved frame holds the shape layers alone. */
const hideBasemap = (mapId: string) =>
  evalScript(
    `(function () { var c = LML.pins.findMapLayer(${JSON.stringify(mapId)}).source, n = 0; for (var i = 1; i <= c.numLayers; i++) { var t = LML.tag.read(c.layer(i)); if (!t || t.kind !== "basemap") continue; LML.basemap.withUnlocked(c.layer(i), function () { c.layer(i).enabled = false; }); n++; } return String(n); })()`
  );

/** The scene's own frame, as After Effects renders it. */
async function sceneFrame(mapId: string, name: string): Promise<{ rgba: Uint8Array; width: number }> {
  const file = path().join(spikeDir(), `${name}.png`).split(String.fromCharCode(92)).join("/");
  fs().rmSync(file, { force: true });
  await evalScript(`(function () { LML.pins.findMapLayer(${JSON.stringify(mapId)}).containingComp.saveFrameToPng(0, new File(${JSON.stringify(file)})); return "1"; })()`);
  // After Effects writes the file while we watch, so wait until it stops growing.
  let size = -1;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (!fs().existsSync(file)) continue;
    const now = fs().statSync(file).size;
    if (now > 0 && now === size) break;
    size = now;
  }
  if (!fs().existsSync(file) || size <= 0) throw new Error(`After Effects did not save ${name}.png`);
  const decoded = decodePng(new Uint8Array(fs().readFileSync(file)));
  return { rgba: decoded.rgba, width: decoded.width };
}

export async function runShapeTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);

  // Bangladesh: the shape layer and the rendered highlight must cover the same pixels.
  const outline = countryOutline("BGD");
  if (!outline) throw new Error("the bundled country outlines are missing");
  const view: View = { center: { lat: 23.7, lng: 90.4 }, zoom: 6.4, bearing: 0, pitch: 0 };
  const map = await createMapComp({ name: "SL1 shapes", ...SIZE, duration: 1, frameRate: 25, view, newScene: true });
  const job = await runRenderJob({
    mapId: map.id,
    quality: "final",
    settings,
    basemap: { kind: "world" },
    theme: "midnight",
    highlights: [{ code: "BGD", name: "Bangladesh", color: "#ffffff", fill: 1, outline: 0 }]
  });
  const sequence = job.sequences.find((s) => s.pass === "highlight-BGD");
  if (!sequence) throw new Error(`the highlight pass is missing: ${job.passes.join(",")}`);
  const rendered = decodePng(new Uint8Array(fs().readFileSync(path().join(sequence.folder, sequenceFileName(0))))).rgba;

  const started = performance.now();
  const made = await addFeatureShape(map.id, { name: outline.name, polygons: outline.polygons, code: "BGD" }, { color: "#ffffff", fill: 1, outline: 0 });
  const buildMs = performance.now() - started;
  if (made.expressionErrors.length) problems.push(`shape expressions: ${made.expressionErrors.slice(0, 3).join("; ")}`);
  if (made.rings < 2 || made.points > 900) problems.push(`the shape has ${made.rings} rings and ${made.points} points`);

  // What After Effects itself draws, with the rendered basemap switched off.
  await hideBasemap(map.id);
  const frame = await sceneFrame(map.id, "sl1-bangladesh");
  if (frame.width !== SIZE.width) problems.push(`the saved frame is ${frame.width} px wide`);
  let both = 0;
  let onlyRendered = 0;
  let onlyShape = 0;
  for (let p = 0; p < SIZE.width * SIZE.height; p++) {
    const inRender = rendered[p * 4 + 3] > 128;
    const inShape = frame.rgba[p * 4] > 128 && frame.rgba[p * 4 + 1] > 128 && frame.rgba[p * 4 + 2] > 128 && frame.rgba[p * 4 + 3] > 128;
    if (inRender && inShape) both++;
    else if (inRender) onlyRendered++;
    else if (inShape) onlyShape++;
  }
  const overlap = both / Math.max(1, both + onlyRendered + onlyShape);
  if (both < 20000) problems.push(`the shape and the render share only ${both} pixels`);
  if (overlap < 0.9) problems.push(`the shape layer covers the rendered country to ${(overlap * 100).toFixed(1)} % (${onlyRendered} px only rendered, ${onlyShape} px only drawn)`);

  // A layer people can work with: paths, a fill with the even-odd rule, a stroke, above the map layer.
  const layer = JSON.parse(
    await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, shape = null, index = 0;
      for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "feature") { shape = scene.layer(i); index = i; } }
      if (!shape) return "null";
      var group = shape.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
      var paths = 0, fillRule = 0, stroke = 0, errors = 0;
      for (var k = 1; k <= group.numProperties; k++) {
        var item = group.property(k);
        if (item.matchName === "ADBE Vector Shape - Group") { paths++; if (item.property("ADBE Vector Shape").expressionError) errors++; }
        if (item.matchName === "ADBE Vector Graphic - Fill") fillRule = item.property("ADBE Vector Fill Rule").value;
        if (item.matchName === "ADBE Vector Graphic - Stroke") stroke = item.property("ADBE Vector Stroke Width").value;
      }
      var tag = LML.tag.read(shape);
      return LML.json.stringify({ name: shape.name, index: index, paths: paths, fillRule: fillRule, stroke: stroke, errors: errors, code: tag.data ? tag.data.code : null, mapIndex: LML.pins.findMapLayer(${JSON.stringify(map.id)}).index, threeD: shape.threeDLayer });
    })()`)
  ) as { name: string; index: number; paths: number; fillRule: number; stroke: number; errors: number; code: string; mapIndex: number } | null;
  if (!layer) problems.push("no shape layer was tagged in the scene");
  else {
    if (layer.name !== "Shape: Bangladesh" || layer.code !== "BGD") problems.push(`the layer is "${layer.name}" with code ${layer.code}`);
    if (layer.paths !== made.rings) problems.push(`the layer holds ${layer.paths} paths, the outline has ${made.rings} rings`);
    if (layer.fillRule !== 2) problems.push(`the fill rule is ${layer.fillRule}, expected even-odd (2)`);
    if (layer.stroke !== 0 || layer.errors) problems.push(`stroke width ${layer.stroke}, ${layer.errors} expression errors`);
    if (layer.index >= layer.mapIndex) problems.push(`the shape layer sits below the map layer (${layer.index} of ${layer.mapIndex})`);
  }

  // What one shape layer costs After Effects: the same frame rendered with the layer on and off.
  const frameMs = async (on: boolean) =>
    Number(
      await evalScript(`(function () {
      var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp, shape = null;
      for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "feature") shape = scene.layer(i); }
      shape.enabled = ${on ? "true" : "false"};
      var file = new File(${JSON.stringify(path().join(spikeDir(), "sl1-timing.png").split(String.fromCharCode(92)).join("/"))}), best = 0;
      for (var n = 0; n < 3; n++) {
        var started = new Date().getTime();
        scene.saveFrameToPng(n / 25 + 0.0001, file);
        var took = new Date().getTime() - started;
        if (!best || took < best) best = took;
      }
      shape.enabled = true;
      return String(best);
    })()`)
    );
  const evaluateMs = Math.max(0, (await frameMs(true)) - (await frameMs(false)));
  if (evaluateMs > 40) problems.push(`one shape layer adds ${evaluateMs.toFixed(0)} ms to a frame in After Effects`);

  // South Africa: Lesotho is a hole in its outline, so the even-odd fill must leave it empty.
  const zaf = countryOutline("ZAF");
  let holeAlpha = -1;
  if (!zaf) problems.push("no outline for South Africa");
  else {
    const zafView: View = { center: { lat: -29, lng: 25 }, zoom: 4.6, bearing: 0, pitch: 0 };
    const zafMap = await createMapComp({ name: "SL1 hole", ...SIZE, duration: 1, frameRate: 25, view: zafView, newScene: true });
    const zafMade = await addFeatureShape(zafMap.id, { name: zaf.name, polygons: zaf.polygons, code: "ZAF" }, { color: "#ffffff", fill: 1, outline: 0 });
    if (zafMade.expressionErrors.length) problems.push(`South Africa: ${zafMade.expressionErrors.slice(0, 2).join("; ")}`);
    const zafFrame = await sceneFrame(zafMap.id, "sl1-south-africa");
    const bright = (place: { lat: number; lng: number }) => {
      const p = project(zafView, SIZE, place);
      const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
      return zafFrame.rgba[i] > 128 && zafFrame.rgba[i + 3] > 128;
    };
    holeAlpha = bright({ lat: -29.6, lng: 28.2 }) ? 1 : 0;
    if (holeAlpha === 1) problems.push("Lesotho is filled: the hole in South Africa's outline did not stay a hole");
    if (!bright({ lat: -29, lng: 24 })) problems.push("South Africa itself is not filled");
    if (bright({ lat: -20, lng: 24 })) problems.push("the fill reaches Botswana");
  }

  // A picture for people: the rendered map with three neighbours as coloured shape layers.
  try {
    const nordicView: View = { center: { lat: 62, lng: 15 }, zoom: 3.9, bearing: 0, pitch: 0 };
    const picture = await createMapComp({ name: "SL1 picture", width: 1600, height: 900, duration: 1, frameRate: 25, view: nordicView, newScene: true });
    await runRenderJob({ mapId: picture.id, quality: "final", settings, basemap: { kind: "world" }, theme: "midnight" });
    for (const [code, color] of [
      ["NOR", "#ff9d2e"],
      ["SWE", "#36b3ff"],
      ["FIN", "#5fd38d"]
    ] as const) {
      const country = countryOutline(code);
      if (country) await addFeatureShape(picture.id, { name: country.name, polygons: country.polygons, code }, { color, fill: 0.45, outline: 3 });
    }
    await sceneFrame(picture.id, "shape-sample");
  } catch (error) {
    problems.push(`the sample picture failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = problems.length === 0;
  log(`SL1 shape layers: ${made.rings} paths and ${made.points} points in ${buildMs.toFixed(0)} ms (${evaluateMs.toFixed(1)} ms per frame), ${(overlap * 100).toFixed(1)} % of the rendered country covered, hole ${holeAlpha === 0 ? "kept" : "lost"}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, rings: made.rings, points: made.points, buildMs, evaluateMs, overlap, both, onlyRendered, onlyShape, problems };
}
