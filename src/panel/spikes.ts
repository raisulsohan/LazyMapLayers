// Phase 0 spikes that must run inside After Effects' CEP runtime:
//   S1  renderer speed at 1080p and 4K (render + read + PNG encode + write)
//   S2a core camera maths vs MapLibre's own projection
//   S6  deterministic frames under a frozen clock
// Results go to %TEMP%/LazyMapLayers/spikes/results.json and frames to .../frames.

import { encodePng } from "../core/image/png.ts";
import { project, type View } from "../core/camera/camera.ts";
import { flyPath } from "../core/camera/flyPath.ts";
import { fs, hostEnvironment, os, path } from "./cep.ts";
import { naturalEarthArchivePath, regionArchivePath, registerLocalArchive } from "./basemap/maplibreSetup.ts";
import { naturalEarthStyle } from "./basemap/naturalEarthStyle.ts";
import { protomapsStyle } from "./basemap/protomapsStyle.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { runHostSmoke } from "./smoke.ts";
import { runAlignment } from "./alignment.ts";
import { runEndToEnd } from "./endToEnd.ts";
import { runCameraAlignment } from "./cameraAlignment.ts";
import { runRenderTests } from "./renderTests.ts";
import { runGlobeEndToEnd, runGlobeTests } from "./globeTests.ts";
import { runExpressionEngineTest } from "./engineTests.ts";
import { runDemoTest } from "./demoTests.ts";
import { runDiagnostics } from "./diagnostics.ts";
import { runDistrictTest } from "./districtTests.ts";
import { runTerrainSpike, runTerrainTest } from "./terrainTests.ts";
import { runRouteTests } from "./routeTests.ts";
import { runAttachTest } from "./attachTests.ts";
import { runShapeTest } from "./shapeTests.ts";
import { runDataTest } from "./dataTests.ts";
import { runFurnitureTest } from "./furnitureTests.ts";
import { runFeatureTest } from "./featureTests.ts";
import { runEarthStudioTest } from "./earthStudioTests.ts";
import { runSentinelTest } from "./sentinelTests.ts";
import { runFlowTest } from "./flowTests.ts";
import { runHeatTest } from "./heatTests.ts";
import { runLabelDesignTest } from "./labelDesignTests.ts";
import { runOwnImageryTest } from "./ownImageryTests.ts";
import { runCustomLookTest } from "./lookTests.ts";
import { runKeepOutTest, runLabelTemplateTest } from "./labelTests.ts";
import { runOsmTest } from "./osmTests.ts";
import { runStyleTest } from "./styleTests.ts";
import { runShotTests } from "./shotTests.ts";
import { runHighlightTest, runImageryDownloadTest, runLabelTimingTest, runSatelliteTest, runThemeTests } from "./themeTests.ts";
import { buildBlueMarble, buildRelief } from "./imagery/buildImagery.ts";
import { extensionRoot } from "./cep.ts";

export type SpikeLog = (line: string, kind?: "ok" | "fail" | "muted") => void;

export function spikeDir(): string {
  return path().join(os().tmpdir(), "LazyMapLayers", "spikes");
}

const europe: View = { center: { lng: 2.35, lat: 48.86 }, zoom: 4, bearing: 0, pitch: 0 };
const eastAsia: View = { center: { lng: 139.69, lat: 35.69 }, zoom: 5.5, bearing: 25, pitch: 50 };

export async function runSpikes(log: SpikeLog, only?: string[]): Promise<Record<string, unknown>> {
  const wants = (id: string) => !only || only.includes(id);
  const results: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    host: hostEnvironment(),
    userAgent: navigator.userAgent
  };
  const dir = spikeDir();
  fs().mkdirSync(path().join(dir, "frames"), { recursive: true });
  const style = naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()));

  // WebGL capabilities
  const probe = document.createElement("canvas").getContext("webgl2");
  results.webgl2 = !!probe;
  if (probe) {
    results.maxTextureSize = probe.getParameter(probe.MAX_TEXTURE_SIZE);
    results.maxRenderbufferSize = probe.getParameter(probe.MAX_RENDERBUFFER_SIZE);
    const debugInfo = probe.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) results.gpu = probe.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  }
  log(`WebGL2: ${results.webgl2} · GPU: ${results.gpu ?? "unknown"} · max texture ${results.maxTextureSize}`, results.webgl2 ? "ok" : "fail");

  for (const size of [
    { label: "1080p", width: 1920, height: 1080, frames: 50 },
    { label: "4K", width: 3840, height: 2160, frames: 20 }
  ].filter(() => wants("S1"))) {
    const renderer = new FrameRenderer({ width: size.width, height: size.height, style });
    try {
      await renderer.init();
      const viewport = { width: size.width, height: size.height };
      const path0 = flyPath(europe, eastAsia, viewport);
      const perFrame: number[] = [];
      let wait = 0;
      let draw = 0;
      let read = 0;
      let encode = 0;
      let write = 0;
      for (let i = 0; i < size.frames; i++) {
        const t = i / (size.frames - 1);
        const frameStart = performance.now();
        const frame = await renderer.renderFrame(path0.at(t), (i * 1000) / 25);
        const e0 = performance.now();
        const png = encodePng(frame.rgba, frame.width, frame.height, { level: 1, opaque: true });
        const e1 = performance.now();
        fs().writeFileSync(path().join(dir, "frames", `${size.label}_${String(i).padStart(4, "0")}.png`), png);
        const e2 = performance.now();
        wait += frame.timings.waitMs;
        draw += frame.timings.drawMs;
        read += frame.timings.readMs;
        encode += e1 - e0;
        write += e2 - e1;
        perFrame.push(e2 - frameStart);
      }
      // The first frame includes tile loading from disk; report steady state separately.
      const steady = perFrame.slice(1);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const summary = {
        frames: size.frames,
        firstFrameMs: Math.round(perFrame[0]),
        steadyAvgMs: Math.round(avg(steady)),
        steadyMaxMs: Math.round(Math.max(...steady)),
        split: {
          waitForTilesMs: Math.round(wait / size.frames),
          drawMs: Math.round(draw / size.frames),
          readAndFlipMs: Math.round(read / size.frames),
          pngEncodeMs: Math.round(encode / size.frames),
          writeMs: Math.round(write / size.frames)
        }
      };
      results[`S1_${size.label}`] = summary;
      const budget = size.label === "4K" ? 1200 : 300;
      log(`S1 ${size.label}: avg ${summary.steadyAvgMs} ms/frame (max ${summary.steadyMaxMs}, first ${summary.firstFrameMs}) · split ${JSON.stringify(summary.split)}`, summary.steadyAvgMs <= budget ? "ok" : "fail");

      if (size.label === "1080p") {
        // S2a: compare our closed-form projection with MapLibre's at random views.
        const map = renderer.maplibre;
        let worst = 0;
        let seed = 7;
        const random = () => {
          seed = (seed * 1664525 + 1013904223) % 4294967296;
          return seed / 4294967296;
        };
        for (let i = 0; i < 300; i++) {
          const view: View = {
            center: { lng: random() * 340 - 170, lat: random() * 140 - 70 },
            zoom: 2 + random() * 16,
            bearing: random() * 360 - 180,
            pitch: random() * 80
          };
          map.jumpTo({ center: [view.center.lng, view.center.lat], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
          const probePoint = map.unproject([random() * size.width, size.height * (0.55 + random() * 0.45)]);
          const theirs = map.project(probePoint);
          const ours = project(view, viewport, { lng: probePoint.lng, lat: probePoint.lat });
          const error = Math.hypot(ours.x - theirs.x, ours.y - theirs.y);
          worst = Math.max(worst, error);
        }
        results.S2a_projectionWorstErrorPx = worst;
        log(`S2a projection vs MapLibre: worst error ${worst.toFixed(4)} px over 300 random views`, worst < 0.5 ? "ok" : "fail");

        // S6: the same frame rendered twice, with other frames in between, must match.
        const view = path0.at(0.37);
        const a = await renderer.renderFrame(view, 1234);
        await renderer.renderFrame(path0.at(0.9), 5000);
        const b = await renderer.renderFrame(view, 1234);
        let differing = 0;
        for (let i = 0; i < a.rgba.length; i++) if (a.rgba[i] !== b.rgba[i]) differing++;
        results.S6_differingBytes = differing;
        log(`S6 determinism: ${differing} differing bytes between two renders of the same frame`, differing === 0 ? "ok" : "fail");
      }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      results[`S1_${size.label}_error`] = message;
      log(`S1 ${size.label} failed: ${message}`, "fail");
    } finally {
      renderer.destroy();
    }
  }

  if (wants("H1")) {
    try {
      results.H1_hostSmoke = await runHostSmoke(log);
    } catch (error) {
      results.H1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`H1 failed: ${results.H1_error}`, "fail");
    }
  }

  if (wants("P1")) {
    try {
      results.P1_alignment = await runAlignment(log);
    } catch (error) {
      results.P1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`P1 failed: ${results.P1_error}`, "fail");
    }
  }

  if (only && only.includes("W1")) {
    try {
      results.W1 = await runDiagnostics(log);
    } catch (error) {
      results.W1_error = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  if (only && (only.includes("D1") || only.includes("D1-4K"))) {
    try {
      results.D1_demo = await runDemoTest(log, only.includes("D1-4K") ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 });
    } catch (error) {
      results.D1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`D1 failed: ${results.D1_error}`, "fail");
    }
  }

  if (only && only.includes("D1L")) {
    try {
      results.D1L_demoLegacyEngine = await runDemoTest(log, { width: 1920, height: 1080, engine: "extendscript" });
    } catch (error) {
      results.D1L_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`D1L failed: ${results.D1L_error}`, "fail");
    }
  }

  if (wants("G1")) {
    try {
      results.G1_globe = await runGlobeTests(log);
    } catch (error) {
      results.G1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`G1 failed: ${results.G1_error}`, "fail");
    }
  }

  if (wants("G2")) {
    try {
      results.G2_globePins = await runGlobeEndToEnd(log);
    } catch (error) {
      results.G2_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`G2 failed: ${results.G2_error}`, "fail");
    }
  }

  if (wants("X1")) {
    try {
      results.X1_expressionEngines = await runExpressionEngineTest(log);
    } catch (error) {
      results.X1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`X1 failed: ${results.X1_error}`, "fail");
    }
  }

  if (wants("R1") || (only && only.includes("R2"))) {
    try {
      Object.assign(results, await runRenderTests(log, { r1: wants("R1"), r2: !!only && only.includes("R2") }));
    } catch (error) {
      results.R_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`render tests failed: ${results.R_error}`, "fail");
    }
  }

  // IMG1: builds the imagery packs from the sources in .cache/imagery (development machines only).
  if (only && (only.includes("IMG1") || only.includes("IMG1R"))) {
    try {
      const repo = path().join(fs().realpathSync(extensionRoot()), "..");
      const cache = path().join(repo, ".cache", "imagery");
      const started = performance.now();
      // IMG1R rebuilds the relief only.
      const satellite = only.includes("IMG1") ? await buildBlueMarble(path().join(cache, "blue-marble-pieces"), 4, 4, (line) => log(`IMG1 satellite: ${line}`, "muted")) : { file: "", bytes: 0, tiles: 0 };
      const relief = await buildRelief(path().join(cache, "sr", "SR_HR.tif"), (line) => log(`IMG1 relief: ${line}`, "muted"));
      results.IMG1_imagery = { passed: true, satellite, relief, seconds: (performance.now() - started) / 1000 };
      log(`IMG1 imagery packs: satellite ${(satellite.bytes / 1048576).toFixed(1)} MB, relief ${(relief.bytes / 1048576).toFixed(1)} MB (flat grey ${relief.flat}) in ${((performance.now() - started) / 1000).toFixed(0)} s`, "ok");
    } catch (error) {
      results.IMG1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`IMG1 failed: ${results.IMG1_error}`, "fail");
    }
  }

  if (only && only.includes("TH1")) {
    try {
      results.TH1_themes = await runThemeTests(log);
    } catch (error) {
      results.TH1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`TH1 failed: ${results.TH1_error}`, "fail");
    }
  }

  if (only && only.includes("LB1")) {
    try {
      results.LB1_labels = await runLabelTimingTest(log);
    } catch (error) {
      results.LB1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`LB1 failed: ${results.LB1_error}`, "fail");
    }
  }

  // DS1 goes online (geoBoundaries), so it runs only when asked for by name.
  if (only && only.includes("DS1")) {
    try {
      results.DS1_districts = await runDistrictTest(log);
    } catch (error) {
      results.DS1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`DS1 failed: ${results.DS1_error}`, "fail");
    }
  }

  // TR1 downloads elevation packs when they are missing, so it runs only when asked for by name.
  if (only && only.includes("TR1")) {
    try {
      results.TR1_terrain = await runTerrainTest(log);
    } catch (error) {
      results.TR1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`TR1 failed: ${results.TR1_error}`, "fail");
    }
  }

  if (only && only.includes("TS1")) {
    try {
      results.TS1_terrainSpike = await runTerrainSpike(log);
    } catch (error) {
      results.TS1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`TS1 failed: ${results.TS1_error}`, "fail");
    }
  }

  if (only && only.includes("IM1")) {
    try {
      results.IM1_imageryDownload = await runImageryDownloadTest(log);
    } catch (error) {
      results.IM1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`IM1 failed: ${results.IM1_error}`, "fail");
    }
  }

  if (wants("AT1")) {
    try {
      results.AT1_attached = await runAttachTest(log);
    } catch (error) {
      results.AT1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`AT1 failed: ${results.AT1_error}`, "fail");
    }
  }

  if (wants("LB2")) {
    try {
      results.LB2_labelTemplate = await runLabelTemplateTest(log);
    } catch (error) {
      results.LB2_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`LB2 failed: ${results.LB2_error}`, "fail");
    }
  }

  if (wants("LB3")) {
    try {
      results.LB3_keepOut = await runKeepOutTest(log);
    } catch (error) {
      results.LB3_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`LB3 failed: ${results.LB3_error}`, "fail");
    }
  }

  if (wants("FL1")) {
    try {
      results.FL1_flows = await runFlowTest(log);
    } catch (error) {
      results.FL1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`FL1 failed: ${results.FL1_error}`, "fail");
    }
  }

  if (wants("OI1")) {
    try {
      results.OI1_ownImagery = await runOwnImageryTest(log);
    } catch (error) {
      results.OI1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`OI1 failed: ${results.OI1_error}`, "fail");
    }
  }

  if (wants("HT1")) {
    try {
      results.HT1_heat = await runHeatTest(log);
    } catch (error) {
      results.HT1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`HT1 failed: ${results.HT1_error}`, "fail");
    }
  }

  if (wants("LD1")) {
    try {
      results.LD1_labelDesign = await runLabelDesignTest(log);
    } catch (error) {
      results.LD1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`LD1 failed: ${results.LD1_error}`, "fail");
    }
  }

  if (wants("ES1")) {
    try {
      results.ES1_earthStudio = await runEarthStudioTest(log);
    } catch (error) {
      results.ES1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`ES1 failed: ${results.ES1_error}`, "fail");
    }
  }

  if (wants("FB1")) {
    try {
      results.FB1_features = await runFeatureTest(log);
    } catch (error) {
      results.FB1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`FB1 failed: ${results.FB1_error}`, "fail");
    }
  }

  if (wants("MF1")) {
    try {
      results.MF1_mapFurniture = await runFurnitureTest(log);
    } catch (error) {
      results.MF1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`MF1 failed: ${results.MF1_error}`, "fail");
    }
  }

  if (wants("LK1")) {
    try {
      results.LK1_ownLook = await runCustomLookTest(log);
    } catch (error) {
      results.LK1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`LK1 failed: ${results.LK1_error}`, "fail");
    }
  }

  if (wants("DT1")) {
    try {
      results.DT1_dataOnTheMap = await runDataTest(log);
    } catch (error) {
      results.DT1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`DT1 failed: ${results.DT1_error}`, "fail");
    }
  }

  // Online: only when it is named.
  if (only && only.includes("SN1")) {
    try {
      results.SN1_satellite = await runSentinelTest(log);
    } catch (error) {
      results.SN1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`SN1 failed: ${results.SN1_error}`, "fail");
    }
  }

  if (only && only.includes("OSM1")) {
    try {
      results.OSM1_openStreetMap = await runOsmTest(log);
    } catch (error) {
      results.OSM1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`OSM1 failed: ${results.OSM1_error}`, "fail");
    }
  }

  if (wants("ST1")) {
    try {
      results.ST1_layerStyle = await runStyleTest(log);
    } catch (error) {
      results.ST1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`ST1 failed: ${results.ST1_error}`, "fail");
    }
  }

  if (wants("SL1")) {
    try {
      results.SL1_shapes = await runShapeTest(log);
    } catch (error) {
      results.SL1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`SL1 failed: ${results.SL1_error}`, "fail");
    }
  }

  if (wants("RT1")) {
    try {
      results.RT1_routes = await runRouteTests(log);
    } catch (error) {
      results.RT1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`RT1 failed: ${results.RT1_error}`, "fail");
    }
  }

  if (wants("HL1")) {
    try {
      results.HL1_highlight = await runHighlightTest(log);
    } catch (error) {
      results.HL1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`HL1 failed: ${results.HL1_error}`, "fail");
    }
  }

  if (wants("SAT1")) {
    try {
      results.SAT1_satellite = await runSatelliteTest(log);
    } catch (error) {
      results.SAT1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`SAT1 failed: ${results.SAT1_error}`, "fail");
    }
  }

  if (wants("SH1")) {
    try {
      results.SH1_shots = await runShotTests(log);
    } catch (error) {
      results.SH1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`SH1 failed: ${results.SH1_error}`, "fail");
    }
  }

  if (wants("C1")) {
    try {
      results.C1_camera = await runCameraAlignment(log);
    } catch (error) {
      results.C1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`C1 failed: ${results.C1_error}`, "fail");
    }
  }

  if (wants("E1")) {
    try {
      results.E1_endToEnd = await runEndToEnd(log);
    } catch (error) {
      results.E1_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`E1 failed: ${results.E1_error}`, "fail");
    }
  }

  // S6b: determinism without renderer labels (the plan keeps final labels out of the renderer).
  if (wants("S6b")) {
    const renderer = new FrameRenderer({ width: 1920, height: 1080, style: naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()), { labels: false }) });
    try {
      await renderer.init();
      const flight = flyPath(europe, eastAsia, { width: 1920, height: 1080 });
      const a = await renderer.renderFrame(flight.at(0.37), 1234);
      await renderer.renderFrame(flight.at(0.9), 5000);
      const b = await renderer.renderFrame(flight.at(0.37), 1234);
      let differing = 0;
      for (let i = 0; i < a.rgba.length; i++) if (a.rgba[i] !== b.rgba[i]) differing++;
      results.S6b_noLabels_differingBytes = differing;
      log(`S6b determinism without labels: ${differing} differing bytes`, differing === 0 ? "ok" : "fail");
    } catch (error) {
      results.S6b_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`S6b failed: ${results.S6b_error}`, "fail");
    } finally {
      renderer.destroy();
    }
  }

  // S4: an OpenStreetMap region downloaded from the Protomaps planet build, rendered offline with
  // 3D buildings: a 48-frame orbit around the Eiffel Tower.
  const parisFile = regionArchivePath("paris");
  if (!wants("S4")) {
    results.S4_skipped = "not requested";
  } else if (fs().existsSync(parisFile)) {
    const renderer = new FrameRenderer({ width: 1920, height: 1080, style: protomapsStyle(registerLocalArchive("paris", parisFile)) });
    try {
      await renderer.init();
      const times: number[] = [];
      for (let i = 0; i < 48; i++) {
        const t0 = performance.now();
        const frame = await renderer.renderFrame(
          { center: { lng: 2.2945, lat: 48.8584 }, zoom: 15.6 - (i / 47) * 0.8, bearing: -30 + (i / 47) * 120, pitch: 62 },
          (i * 1000) / 25
        );
        fs().writeFileSync(path().join(dir, "frames", `S4_paris_${String(i).padStart(4, "0")}.png`), encodePng(frame.rgba, frame.width, frame.height, { level: 1, opaque: true }));
        times.push(performance.now() - t0);
      }
      const steady = times.slice(1);
      results.S4_paris = {
        frames: times.length,
        firstFrameMs: Math.round(times[0]),
        steadyAvgMs: Math.round(steady.reduce((a, b) => a + b, 0) / steady.length),
        steadyMaxMs: Math.round(Math.max(...steady))
      };
      log(`S4 Paris orbit with 3D buildings: ${JSON.stringify(results.S4_paris)}`, "ok");
    } catch (error) {
      results.S4_error = error instanceof Error ? error.stack ?? error.message : String(error);
      log(`S4 failed: ${results.S4_error}`, "fail");
    } finally {
      renderer.destroy();
    }
  } else {
    results.S4_skipped = `no region archive at ${parisFile}`;
  }

  results.finishedAt = new Date().toISOString();
  fs().writeFileSync(path().join(dir, "results.json"), JSON.stringify(results, null, 2), "utf8");
  log(`results written to ${path().join(dir, "results.json")}`, "muted");
  return results;
}
