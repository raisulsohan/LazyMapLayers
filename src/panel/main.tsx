// LazyMapLayers panel: pick a map, frame it in the preview, keyframe views, drop pins, render the
// basemap into After Effects, and download OpenStreetMap regions.

import "./polyfills.ts";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../core/camera/camera.ts";
import { tileCount, tileRangeForBbox, type Bbox } from "../core/tiles/tileMath.ts";
import type { ExtractPlan } from "../core/pmtiles/extract.ts";
import { callHost, fs, isInCep, path } from "./cep.ts";
import { ensureMaplibreWorker, naturalEarthArchivePath, regionArchivePath, registerLocalArchive } from "./basemap/maplibreSetup.ts";
import { naturalEarthStyle } from "./basemap/naturalEarthStyle.ts";
import { protomapsStyle } from "./basemap/protomapsStyle.ts";
import { addPin, createMapComp, setView } from "./mapApi.ts";
import { renderMap, type BasemapSource } from "./render/renderMap.ts";
import { downloadRegion, listRegions, planRegion, safeRegionName, type RegionInfo } from "./regions.ts";
import { startDevAutomation } from "./devAutomation.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

type LogKind = "ok" | "fail" | "muted";
type LogLine = { text: string; kind?: LogKind };
type MapEntry = {
  mapId: string;
  mapCompName: string;
  sceneCompName: string;
  basemap: BasemapSource | null;
  isActiveScene: boolean;
  view: View;
};
type Progress = { label: string; done: number; total: number } | null;
type RegionSheet = { name: string; maxZoom: number; bbox: Bbox; planned?: { plan: ExtractPlan; url: string; build: string } };

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

const LARGE_DOWNLOAD_BYTES = 200 * 1048576;
const MAX_DOWNLOAD_BYTES = 2048 * 1048576;
const DETAIL_ZOOMS = [10, 11, 12, 13, 14, 15];

/** Tiles from zoom 0 to maxZoom that cover the bbox (offline estimate, before asking the server). */
function tilesUpTo(bbox: Bbox, maxZoom: number): number {
  let total = 0;
  for (let z = 0; z <= maxZoom; z++) total += tileCount(tileRangeForBbox(bbox, z));
  return total;
}

const compactNumber = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

function viewOf(map: maplibregl.Map): View {
  const c = map.getCenter();
  return { center: { lng: c.lng, lat: c.lat }, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

function previewStyle(source: BasemapSource): StyleSpecification {
  if (source.kind === "region" && fs().existsSync(regionArchivePath(source.name))) {
    return protomapsStyle(registerLocalArchive(source.name, regionArchivePath(source.name)), { labels: true });
  }
  return naturalEarthStyle(registerLocalArchive("natural-earth", naturalEarthArchivePath()), { labels: true });
}

const sourceKey = (s: BasemapSource) => (s.kind === "region" ? `region:${s.name}` : "world");
const sourceFromKey = (key: string): BasemapSource => (key.startsWith("region:") ? { kind: "region", name: key.slice(7) } : { kind: "world" });

function App() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [view, setViewState] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [maps, setMaps] = useState<MapEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [basemap, setBasemap] = useState<BasemapSource>({ kind: "world" });
  const [progress, setProgress] = useState<Progress>(null);
  const [regionSheet, setRegionSheet] = useState<RegionSheet | null>(null);
  const pinCounter = useRef(1);
  const selectedRef = useRef<string>("");
  selectedRef.current = selectedId;

  const log: SpikeLog = (text, kind) => setLines((previous) => [...previous.slice(-200), { text, kind }]);
  const fail = (what: string, error: unknown) => log(`${what}: ${error instanceof Error ? error.message : String(error)}`, "fail");

  function showMap(entry: MapEntry) {
    const source = entry.basemap ?? { kind: "world" };
    setBasemap(source);
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(previewStyle(source));
    const v = entry.view;
    map.jumpTo({ center: [v.center.lng, v.center.lat], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });
  }

  async function refreshMaps(preferActive = false) {
    if (!isInCep()) return;
    try {
      const list = await callHost<MapEntry[]>("listMaps");
      setMaps(list);
      const current = list.find((m) => m.mapId === selectedRef.current);
      const active = list.find((m) => m.isActiveScene);
      const next = (preferActive && active) || current || active || list[0];
      if (next && next.mapId !== selectedRef.current) {
        selectedRef.current = next.mapId;
        setSelectedId(next.mapId);
        showMap(next);
      }
    } catch (error) {
      fail("reading maps", error);
    }
  }

  async function refreshRegions() {
    if (!isInCep()) return;
    try {
      setRegions(await listRegions());
    } catch (error) {
      fail("reading regions", error);
    }
  }

  useEffect(() => {
    if (!mapNode.current) return;
    try {
      ensureMaplibreWorker();
      const map = new maplibregl.Map({
        container: mapNode.current,
        style: previewStyle({ kind: "world" }),
        center: [10, 25],
        zoom: 1.4,
        maxPitch: 85,
        attributionControl: { compact: true }
      });
      map.on("move", () => setViewState(viewOf(map)));
      map.on("load", () => setViewState(viewOf(map)));
      map.on("error", (e) => log(`map error: ${e.error?.message ?? e}`, "fail"));
      map.on("click", (e) => {
        if (e.originalEvent.altKey) void addPinAt({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      mapRef.current = map;
    } catch (error) {
      fail("preview", error);
    }
    if (!isInCep()) return () => mapRef.current?.remove();

    callHost<{ appVersion: string; lml: string }>("ping")
      .then((info) => log(`After Effects ${info.appVersion} · LazyMapLayers ${info.lml}`, "muted"))
      .catch((error) => fail("host not ready", error));
    void refreshMaps(true);
    void refreshRegions();
    const onFocus = () => void refreshMaps();
    window.addEventListener("focus", onFocus);
    const stopAutomation = startDevAutomation(log, setBusy);
    return () => {
      stopAutomation();
      window.removeEventListener("focus", onFocus);
      mapRef.current?.remove();
    };
  }, []);

  const selected = maps.find((m) => m.mapId === selectedId) ?? null;

  // Handle for UI tests driven through DevTools (tools/ae-spikes.mjs --ui).
  (window as unknown as { lmlDebug: unknown }).lmlDebug = {
    map: () => mapRef.current,
    addPin: (lat: number, lng: number) => addPinAt({ lat, lng }),
    selectedMapId: () => selectedRef.current
  };

  async function run(label: string, task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      fail(label, error);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const newMap = () =>
    run("new map", async () => {
      const map = mapRef.current;
      if (!map) return;
      const created = await createMapComp({ view: viewOf(map) });
      await callHost("setMapSettings", { mapId: created.id, basemap });
      log(`created ${created.mapCompName} in ${created.sceneCompName}`, "ok");
      selectedRef.current = created.id;
      setSelectedId(created.id);
      await refreshMaps();
    });

  const keyframeView = () =>
    run("keyframe", async () => {
      const map = mapRef.current;
      if (!map || !selected) return;
      await setView(selected.mapId, viewOf(map), true);
      log("camera keyframed at the current time", "ok");
    });

  const matchAe = () =>
    run("match view", async () => {
      const list = await callHost<MapEntry[]>("listMaps");
      setMaps(list);
      const entry = list.find((m) => m.mapId === selectedRef.current);
      if (!entry || !mapRef.current) return;
      const v = entry.view;
      mapRef.current.jumpTo({ center: [v.center.lng, v.center.lat], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });
    });

  async function addPinAt(position: { lat: number; lng: number }) {
    const mapId = selectedRef.current;
    if (!mapId) {
      log("create or select a map first", "muted");
      return;
    }
    await run("add pin", async () => {
      const added = await addPin(mapId, position, { name: `Pin ${pinCounter.current++}` });
      if (added.expressionErrors.length) log(`pin expression problems: ${added.expressionErrors.join("; ")}`, "fail");
      else log(`added ${added.name} at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`, "ok");
    });
  }

  const changeBasemap = (key: string) =>
    run("basemap", async () => {
      const source = sourceFromKey(key);
      setBasemap(source);
      mapRef.current?.setStyle(previewStyle(source));
      const mapId = selectedRef.current;
      if (mapId) await callHost("setMapSettings", { mapId, basemap: source });
    });

  const renderBasemap = (scale: number) =>
    run("render", async () => {
      if (!selected) return;
      const label = scale < 1 ? "Rendering preview" : "Rendering";
      setProgress({ label, done: 0, total: 1 });
      const result = await renderMap(selected.mapId, {
        basemap,
        scale,
        onProgress: (done, total) => setProgress({ label, done, total })
      });
      log(`rendered ${result.frames} frames (${result.msPerFrame.toFixed(0)} ms each) into ${selected.mapCompName}`, "ok");
    });

  const regionTaken = !!regionSheet?.name && regions.some((r) => r.name === safeRegionName(regionSheet.name));

  const openRegionSheet = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const bbox = { west: Math.max(-180, b.getWest()), south: Math.max(-85, b.getSouth()), east: Math.min(180, b.getEast()), north: Math.min(85, b.getNorth()) };
    // Start with the most detail that stays around a city-sized download (a few thousand tiles).
    const maxZoom = [...DETAIL_ZOOMS].reverse().find((z) => tilesUpTo(bbox, z) <= 3000) ?? DETAIL_ZOOMS[0];
    setRegionSheet({ name: "", maxZoom, bbox });
  };

  const checkRegionSize = () =>
    run("check size", async () => {
      const sheet = regionSheet;
      if (!sheet) return;
      setProgress({ label: "Checking size", done: 0, total: 1 });
      const planned = await planRegion(sheet.bbox, sheet.maxZoom);
      setRegionSheet({ ...sheet, planned });
    });

  const startRegionDownload = () =>
    run("download", async () => {
      const sheet = regionSheet;
      if (!sheet?.planned) return;
      const name = safeRegionName(sheet.name || `region-${Date.now()}`);
      setProgress({ label: "Downloading", done: 0, total: sheet.planned.plan.tileBytes });
      await downloadRegion(name, sheet.planned, (done, total) => setProgress({ label: "Downloading", done, total }));
      log(`downloaded region "${name}" (${mb(sheet.planned.plan.tileBytes)}) · © OpenStreetMap contributors`, "ok");
      setRegionSheet(null);
      await refreshRegions();
      await changeBasemap(`region:${name}`);
    });

  return (
    <>
      <div class="toolbar">
        <span class="title">LazyMapLayers</span>
        <select
          value={selectedId}
          disabled={busy || maps.length === 0}
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value;
            selectedRef.current = id;
            setSelectedId(id);
            const entry = maps.find((m) => m.mapId === id);
            if (entry) {
              showMap(entry);
              void callHost("revealMap", { mapId: id });
            }
          }}
        >
          {maps.length === 0 && <option value="">No maps yet</option>}
          {maps.map((m) => (
            <option key={m.mapId} value={m.mapId}>
              {m.mapCompName}
            </option>
          ))}
        </select>
        <button class="primary" disabled={busy} onClick={newMap}>
          New map
        </button>
      </div>

      <div class="toolbar secondary">
        <label class="field">
          Basemap
          <select value={sourceKey(basemap)} disabled={busy} onChange={(e) => void changeBasemap((e.target as HTMLSelectElement).value)}>
            <option value="world">World (Natural Earth, offline)</option>
            {regions.map((r) => (
              <option key={r.name} value={`region:${r.name}`}>
                {r.name} ({mb(r.sizeBytes)})
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={openRegionSheet}>
          Download this area…
        </button>
      </div>

      {regionSheet && (
        <div class="sheet">
          <div class="sheet-row">
            <input
              placeholder="Region name, e.g. paris"
              value={regionSheet.name}
              onInput={(e) => setRegionSheet({ ...regionSheet, name: (e.target as HTMLInputElement).value })}
              onBlur={(e) => {
                // Show the name the file will really get ("New York" becomes "new-york").
                const typed = (e.target as HTMLInputElement).value;
                if (typed.trim()) setRegionSheet({ ...regionSheet, name: safeRegionName(typed) });
              }}
            />
            <select
              value={regionSheet.maxZoom}
              onChange={(e) => setRegionSheet({ ...regionSheet, maxZoom: Number((e.target as HTMLSelectElement).value), planned: undefined })}
            >
              {DETAIL_ZOOMS.map((z) => (
                <option key={z} value={z}>
                  Detail to zoom {z} (≈{compactNumber(tilesUpTo(regionSheet.bbox, z))} tiles)
                </option>
              ))}
            </select>
          </div>
          <div class="muted small">
            Area {regionSheet.bbox.west.toFixed(3)}, {regionSheet.bbox.south.toFixed(3)} → {regionSheet.bbox.east.toFixed(3)},{" "}
            {regionSheet.bbox.north.toFixed(3)} · OpenStreetMap data (© OpenStreetMap contributors) from the newest Protomaps planet build
          </div>
          {regionSheet.planned && (
            <div class="small">
              {regionSheet.planned.plan.tiles.length} tiles · <strong>{mb(regionSheet.planned.plan.tileBytes)}</strong> to download (build{" "}
              {regionSheet.planned.build})
            </div>
          )}
          {regionSheet.planned && regionSheet.planned.plan.tileBytes > MAX_DOWNLOAD_BYTES && (
            <div class="warning small">
              Too large to download in one go ({mb(regionSheet.planned.plan.tileBytes)}). Zoom the preview in to the area you need, or pick less detail.
            </div>
          )}
          {regionSheet.planned && regionSheet.planned.plan.tileBytes > LARGE_DOWNLOAD_BYTES && regionSheet.planned.plan.tileBytes <= MAX_DOWNLOAD_BYTES && (
            <div class="warning small">
              This is a large download ({mb(regionSheet.planned.plan.tileBytes)}). For one city, zoom the preview in until the city fills it, or pick less detail.
            </div>
          )}
          {regionTaken && (
            <div class="warning small">
              A region named "{safeRegionName(regionSheet.name)}" already exists. Downloading replaces it.
            </div>
          )}
          <div class="sheet-row">
            {!regionSheet.planned ? (
              <button disabled={busy} onClick={checkRegionSize}>
                Check size
              </button>
            ) : (
              <button
                class={regionTaken || regionSheet.planned.plan.tileBytes > LARGE_DOWNLOAD_BYTES ? "danger" : "primary"}
                disabled={busy || regionSheet.planned.plan.tileBytes > MAX_DOWNLOAD_BYTES}
                onClick={startRegionDownload}
              >
                {regionTaken ? "Replace existing region" : "Download"}
              </button>
            )}
            <button disabled={busy} onClick={() => setRegionSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div class="map-wrap">
        <div id="map" ref={mapNode} />
        {view && (
          <div class="view-readout">
            {view.center.lat.toFixed(4)}, {view.center.lng.toFixed(4)} · z {view.zoom.toFixed(2)} · b {view.bearing.toFixed(1)}° · p {view.pitch.toFixed(1)}°
          </div>
        )}
        <div class="hint">Alt+click: drop a pin · Right-drag: rotate and tilt</div>
      </div>

      <div class="toolbar">
        <button disabled={busy || !selected} onClick={keyframeView} title="Set a camera keyframe at the current AE time">
          ◆ Keyframe view
        </button>
        <button disabled={busy || !selected} onClick={matchAe} title="Show the camera at the current AE time">
          Match AE
        </button>
        <span class="spacer" />
        <button disabled={busy || !selected} onClick={() => renderBasemap(0.5)} title="Half resolution, fast">
          Render preview
        </button>
        <button class="primary" disabled={busy || !selected} onClick={() => renderBasemap(1)}>
          Render
        </button>
      </div>

      {progress && (
        <div class="progress">
          <div class="bar" style={{ width: `${Math.round((100 * progress.done) / Math.max(1, progress.total))}%` }} />
          <span>
            {progress.label} {progress.total > 1 ? `${Math.round((100 * progress.done) / progress.total)}%` : "…"}
          </span>
        </div>
      )}

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
