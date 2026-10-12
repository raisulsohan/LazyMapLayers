// The Self-test (DECISIONS D104): the facts of a short run in the user's own After Effects - the host's
// answer, one frame drawn by the panel's renderer, a map comp made and removed in one undo group with
// a pin and a 3D pin read where they stand, and the offline data on disk. Core (support/selfTest.ts)
// judges them and writes the report; this file only gathers. Nothing leaves the computer.

import { cameraRigExpressions, groundFrameFor, pin3dPositionExpression } from "../core/ae/cameraRig.ts";
import { pinExpressions } from "../core/ae/pinExpressions.ts";
import { encodePng, flipAndUnpremultiply } from "../core/image/png.ts";
import {
  checkHost, checkMapComp, checkOffline, checkPins, checkRender, chromiumOf, countColours, flatSpot, installKindOf, isPmtilesHead, promisedFiles,
  SELF_TEST_PIN, SELF_TEST_SIZE, SELF_TEST_VIEW, selfTestReport, systemName, verdictLine, withoutHome,
  type FileState, type HostAnswer, type MapCompFacts, type OfflineFacts, type RenderFacts, type SelfTestCheck
} from "../core/support/selfTest.ts";
import { basemapStyle } from "./basemap/basemapStyle.ts";
import { naturalEarthArchivePath } from "./basemap/maplibreSetup.ts";
import { callHost, callHostWithJobFile, extensionRoot, fs, os, path, userDataDir } from "./cep.ts";
import { installedWorld } from "./osmTiles.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";

export type SelfTestRun = { checks: SelfTestCheck[]; report: string; verdict: string; file: string; at: string; system: string };

export const selfTestDir = () => path().join(userDataDir(), "self-test");

/** The version the panel itself was built as, from its manifest (the host script says its own). */
export function panelBuildVersion(): string {
  try {
    const manifest = fs().readFileSync(path().join(extensionRoot(), "CSXS", "manifest.xml"), "utf8");
    return /ExtensionBundleVersion="([^"]+)"/.exec(manifest)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const thisSystem = () => systemName(process.platform, os().release(), os().arch());

type Frame = { facts: RenderFacts; rgba: Uint8Array };

/** One frame of the world map by the panel's own renderer, written as a PNG; a grey frame when it cannot draw, so the host part still runs. */
async function renderFrame(file: string): Promise<Frame> {
  const { width, height } = SELF_TEST_SIZE;
  const probe = document.createElement("canvas").getContext("webgl2");
  const debug = probe?.getExtension("WEBGL_debug_renderer_info");
  const gpu = probe && debug ? String(probe.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null;
  probe?.getExtension("WEBGL_lose_context")?.loseContext();
  let facts: RenderFacts = { ok: false, webgl2: !!probe, gpu };
  let rgba: Uint8Array = new Uint8Array(width * height * 4).fill(128);
  if (probe) {
    const style = basemapStyle({ kind: "world" }, { labels: false, projection: "mercator", viewport: SELF_TEST_SIZE });
    const renderer = new FrameRenderer({ width, height, style, antialias: true });
    try {
      const started = performance.now();
      await renderer.init();
      await renderer.setView(SELF_TEST_VIEW, 0);
      const frame = renderer.draw("base");
      rgba = flipAndUnpremultiply(frame.pixels, frame.width, frame.height);
      facts = { ok: true, webgl2: true, gpu, width: frame.width, height: frame.height, ms: performance.now() - started, colours: countColours(rgba) };
    } catch (error) {
      facts = { ok: false, webgl2: true, gpu, error: error instanceof Error ? error.message : String(error) };
      rgba = new Uint8Array(width * height * 4).fill(128);
    } finally {
      renderer.destroy();
    }
  }
  fs().writeFileSync(file, encodePng(rgba, width, height, { level: 1 }));
  return { facts: { ...facts, file }, rgba };
}

/** The host part, in one call and one undo group (host 80-selftest.jsx). */
async function hostPart(framePath: string, spot: { x: number; y: number }): Promise<MapCompFacts & { pin?: number[] | null; pin3d?: number[] | null; errors?: string[] }> {
  const frame = groundFrameFor(SELF_TEST_VIEW, { width: 0, height: 0 });
  try {
    return await callHostWithJobFile("selfTest", {
      width: SELF_TEST_SIZE.width,
      height: SELF_TEST_SIZE.height,
      view: SELF_TEST_VIEW,
      framePath,
      spot,
      rig: { originLat: frame.origin.lat, originLng: frame.origin.lng, referenceZoom: frame.referenceZoom, expressions: cameraRigExpressions() },
      pin: { lat: SELF_TEST_PIN.lat, lng: SELF_TEST_PIN.lng, expressions: pinExpressions(SELF_TEST_PIN.lat, SELF_TEST_PIN.lng), position3d: pin3dPositionExpression(SELF_TEST_PIN.lat, SELF_TEST_PIN.lng) }
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function fileState(file: string): FileState {
  const nodeFs = fs();
  if (!nodeFs.existsSync(file)) return "missing";
  try {
    if (file.endsWith(".pmtiles")) {
      const head = new Uint8Array(8);
      const fd = nodeFs.openSync(file, "r");
      try {
        nodeFs.readSync(fd, head, 0, 8, 0);
      } finally {
        nodeFs.closeSync(fd);
      }
      return isPmtilesHead(head) ? "ok" : "unreadable";
    }
    if (file.endsWith(".json")) JSON.parse(nodeFs.readFileSync(file, "utf8"));
    else if (nodeFs.statSync(file).size === 0) return "unreadable";
    return "ok";
  } catch {
    return "unreadable";
  }
}

/** What the installer left in the user data folder, the world inside the panel, and whether the folder takes files. */
function offlineFacts(): OfflineFacts {
  const data = userDataDir();
  const packFile = path().join(data, "offline", "pack.json");
  let pack: unknown = null;
  if (fs().existsSync(packFile)) {
    try {
      pack = JSON.parse(fs().readFileSync(packFile, "utf8"));
    } catch {
      pack = "unreadable";
    }
  }
  const files: Record<string, FileState> = {};
  for (const file of promisedFiles(installKindOf(pack) ?? "full")) files[file] = fileState(path().join(data, ...file.split("/")));
  let writable = false;
  try {
    const probe = path().join(selfTestDir(), "write-test.tmp");
    fs().writeFileSync(probe, "LazyMapLayers");
    fs().unlinkSync(probe);
    writable = true;
  } catch {
    writable = false;
  }
  return { pack, files, naturalEarth: fileState(naturalEarthArchivePath()), writable, worldMaxZoom: installedWorld()?.maxZoom ?? null };
}

/** Runs every check, writes the report next to the panel's data and returns it. */
export async function runSelfTest(onStep: (label: string, done: number) => void = () => undefined): Promise<SelfTestRun> {
  const started = performance.now();
  const dir = selfTestDir();
  fs().mkdirSync(dir, { recursive: true });
  const panelVersion = panelBuildVersion();

  onStep("asking After Effects", 0);
  let answer: HostAnswer | null = null;
  let hostError: string | undefined;
  try {
    answer = await callHost<HostAnswer>("ping");
  } catch (error) {
    hostError = error instanceof Error ? error.message : String(error);
  }

  onStep("drawing one frame", 1);
  const framePath = path().join(dir, "frame.png");
  const frame = await renderFrame(framePath);
  const spot = flatSpot(frame.rgba, SELF_TEST_SIZE.width, SELF_TEST_SIZE.height);

  onStep("making a map comp", 2);
  const host = answer ? await hostPart(framePath, spot ?? { x: SELF_TEST_SIZE.width / 2, y: SELF_TEST_SIZE.height / 2 }) : { error: "skipped: the host script did not answer" };

  onStep("looking at the offline data", 3);
  const offline = offlineFacts();

  const checks = [
    checkHost(answer, panelVersion, hostError),
    checkRender(frame.facts),
    checkMapComp(host, spot),
    checkPins(host),
    checkOffline(offline)
  ];
  const kind = installKindOf(offline.pack);
  const at = new Date().toISOString();
  const system = thisSystem();
  const report = withoutHome(
    selfTestReport({
      checks,
      written: at,
      panelVersion,
      ae: answer?.appVersion ?? null,
      system,
      cep: chromiumOf(navigator.userAgent),
      gpu: frame.facts.gpu ?? null,
      install: kind ? `${kind[0].toUpperCase()}${kind.slice(1)}${offline.worldMaxZoom ? ` (the world to zoom ${offline.worldMaxZoom})` : ""}` : "unknown",
      seconds: (performance.now() - started) / 1000
    }),
    os().homedir()
  );
  const file = path().join(dir, "self-test-report.txt");
  fs().writeFileSync(file, report, "utf8");
  onStep("done", 4);
  return { checks, report, verdict: verdictLine(checks), file, at, system };
}
