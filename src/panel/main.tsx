// Panel entry point (Phase 0): offline preview map, map comp creation, and the spike runner.

import "./polyfills.ts";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as maplibregl from "maplibre-gl";
import type { View } from "../core/camera/camera.ts";
import { callHost, evalScript, fs, isInCep, path } from "./cep.ts";

let spikeRunActive = false;
import { ensureMaplibreWorker, naturalEarthArchivePath, registerLocalArchive } from "./basemap/maplibreSetup.ts";
import { naturalEarthStyle } from "./basemap/naturalEarthStyle.ts";
import { runSpikes, spikeDir, type SpikeLog } from "./spikes.ts";

type LogLine = { text: string; kind?: "ok" | "fail" | "muted" };

function viewOf(map: maplibregl.Map): View {
  const c = map.getCenter();
  return { center: { lng: c.lng, lat: c.lat }, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

function App() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);

  const log: SpikeLog = (text, kind) => setLines((previous) => [...previous.slice(-300), { text, kind }]);

  useEffect(() => {
    if (!mapNode.current) return;
    try {
      ensureMaplibreWorker();
      const url = registerLocalArchive("natural-earth", naturalEarthArchivePath());
      const map = new maplibregl.Map({
        container: mapNode.current,
        style: naturalEarthStyle(url),
        center: [10, 25],
        zoom: 1.4,
        maxPitch: 85,
        attributionControl: { compact: true }
      });
      map.on("move", () => setView(viewOf(map)));
      map.on("load", () => setView(viewOf(map)));
      map.on("error", (e) => log(`map error: ${e.error?.message ?? e}`, "fail"));
      mapRef.current = map;
    } catch (error) {
      log(`preview failed: ${error instanceof Error ? error.message : String(error)}`, "fail");
    }

    if (isInCep()) {
      callHost<{ appVersion: string; lml: string }>("ping")
        .then((info) => log(`After Effects ${info.appVersion} · host ${info.lml}`, "ok"))
        .catch((error) => log(`host not ready: ${error.message}`, "fail"));
      // Developer automation (tools/ae-spikes.mjs): heartbeat file plus polling for spike requests.
      const heartbeat = setInterval(() => {
        try {
          fs().mkdirSync(spikeDir(), { recursive: true });
          fs().writeFileSync(path().join(spikeDir(), "..", "panel-alive.json"), JSON.stringify({ time: Date.now() }), "utf8");
        } catch {
          // ignore
        }
        void maybeRunRequestedSpikes();
      }, 2000);
      return () => {
        clearInterval(heartbeat);
        mapRef.current?.remove();
      };
    }
    return () => mapRef.current?.remove();
  }, []);


  async function maybeRunRequestedSpikes() {
    const request = path().join(spikeDir(), "run-request.json");
    if (spikeRunActive || !fs().existsSync(request)) return;
    spikeRunActive = true;
    let options: { quit?: boolean; only?: string[] | null; hostScript?: string } = {};
    try {
      options = JSON.parse(fs().readFileSync(request, "utf8"));
    } catch {
      // Empty request file: run with defaults.
    }
    fs().unlinkSync(request);
    log("spike run requested by tools/ae-spikes", "muted");
    const only = options.only ?? undefined;
    if (options.hostScript && (!only || only.includes("S3") || only.includes("S5"))) {
      log("running host spikes S3 and S5", "muted");
      const scriptPath = options.hostScript.split(String.fromCharCode(92)).join("/");
      await evalScript(`$.evalFile(${JSON.stringify(scriptPath)})`).catch((error) => log(`host spikes failed: ${error.message}`, "fail"));
    }
    fs().writeFileSync(path().join(spikeDir(), "host-done.flag"), "1", "utf8");
    await spikes(only);
    if (options.quit) await callHost("devQuitAfterSpikes").catch((error) => log(`quit refused: ${error.message}`, "fail"));
    spikeRunActive = false;
  }

  async function spikes(only?: string[]) {
    setBusy(true);
    try {
      await runSpikes(log, only);
    } catch (error) {
      log(`spikes failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`, "fail");
    } finally {
      setBusy(false);
    }
  }

  async function createMapComp() {
    const map = mapRef.current;
    if (!map) return;
    setBusy(true);
    try {
      const result = await callHost<{ mapCompName: string; sceneCompName: string }>("createMapComp", { view: viewOf(map) });
      log(`created ${result.mapCompName} in ${result.sceneCompName}`, "ok");
    } catch (error) {
      log(`create map comp failed: ${error instanceof Error ? error.message : String(error)}`, "fail");
    } finally {
      setBusy(false);
    }
  }

  async function keyframeView() {
    const map = mapRef.current;
    if (!map) return;
    try {
      const maps = await callHost<{ mapId: string }[]>("listMaps");
      if (!maps.length) {
        log("no map comp yet: create one first", "muted");
        return;
      }
      await callHost("setView", { mapId: maps[0].mapId, view: viewOf(map), keyframe: true });
      log("view keyframed at the current time", "ok");
    } catch (error) {
      log(`keyframe failed: ${error instanceof Error ? error.message : String(error)}`, "fail");
    }
  }

  return (
    <>
      <div class="toolbar">
        <span class="title">LazyMapLayers</span>
        <button class="primary" disabled={busy} onClick={createMapComp}>
          Create map comp
        </button>
        <button disabled={busy} onClick={keyframeView}>
          Keyframe view
        </button>
        <button disabled={busy} onClick={() => spikes()}>
          Run spikes
        </button>
      </div>
      <div class="map-wrap">
        <div id="map" ref={mapNode} />
        {view && (
          <div class="view-readout">
            {view.center.lat.toFixed(4)}, {view.center.lng.toFixed(4)} · z {view.zoom.toFixed(2)} · b {view.bearing.toFixed(1)}° · p{" "}
            {view.pitch.toFixed(1)}°
          </div>
        )}
      </div>
      <div class="log">
        {lines.map((line, i) => (
          <div key={i} class={line.kind ?? ""}>
            {line.text}
          </div>
        ))}
      </div>
    </>
  );
}

function logToFile(text: string) {
  if (!isInCep()) return;
  try {
    const dir = path().join(spikeDir(), "..");
    fs().mkdirSync(dir, { recursive: true });
    fs().appendFileSync(path().join(dir, "panel.log"), `${new Date().toISOString()} ${text}\n`, "utf8");
  } catch {
    // Never let logging break the panel.
  }
}

window.addEventListener("error", (event) => logToFile(`error: ${event.message} at ${event.filename}:${event.lineno}`));
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  logToFile(`unhandled rejection: ${reason}`);
});
logToFile(`panel start: ${navigator.userAgent}`);

const root = document.getElementById("app");
if (root) render(<App />, root);
