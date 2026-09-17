// Panel state (signals) and the actions behind the buttons. Components only read signals and call
// these functions; every talk with After Effects happens here. Nothing polls After Effects: maps are
// read when the panel gets the focus and after the panel's own actions.

import { computed, signal } from "@preact/signals";
import type { View } from "../core/camera/camera.ts";
import { fitBounds } from "../core/camera/fit.ts";
import type { MapProjection } from "../core/camera/globe.ts";
import { NAME_LANGUAGES, type NameLanguage } from "../core/labels/language.ts";
import type { ExtractPlan } from "../core/pmtiles/extract.ts";
import { PASS_IDS, type PassId } from "../core/render/passes.ts";
import { DEFAULT_FINAL_SETTINGS, PREVIEW_SETTINGS, normaliseSettings, type RenderQuality, type RenderSettings } from "../core/render/plan.ts";
import { nameForView, zoomForPlace, type SearchResult } from "../core/search/placeSearch.ts";
import { tileCount, tileRangeForBbox, type Bbox } from "../core/tiles/tileMath.ts";
import { regionNames, type BasemapSource } from "./basemap/basemapStyle.ts";
import { callHost, isInCep } from "./cep.ts";
import { placeIndex } from "./data/worldLabels.ts";
import { buildWorldFlight } from "./demo/worldFlight.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { addCameraRig, addPin, createMapComp, flyTo, setView } from "./mapApi.ts";
import { addCallout, addRoute } from "./overlays/routeCallout.ts";
import { compSize, compView, previewMap, setCompSize, setPreviewStyle, showCompView } from "./preview.ts";
import { downloadRegion, listRegions, planRegion, safeRegionName, type RegionInfo } from "./regions.ts";
import { describeSpec, renderQueue, type QueueJob } from "./render/renderQueue.ts";

export type LogKind = "ok" | "fail" | "muted";
export type LogLine = { text: string; kind?: LogKind };

export type MapEntry = {
  mapId: string;
  mapCompName: string;
  sceneCompName: string;
  basemap: BasemapSource | null;
  isActiveScene: boolean;
  hasCamera: boolean;
  hasShots: boolean;
  projection: MapProjection;
  time: number;
  duration: number;
  layerStart: number;
  frameRate: number;
  width: number;
  height: number;
  render: Partial<RenderSettings> | null;
  view: View;
  /** "javascript-1.0" or "extendscript" (the project's expression engine). */
  expressionEngine: string | null;
};

export type Progress = { label: string; done: number; total: number } | null;
export type RegionSheet = { name: string; maxZoom: number; bbox: Bbox; planned?: { plan: ExtractPlan; url: string; build: string } };
export type Screen = "main" | "maps" | "newMap" | "settings";
export type Tab = "shots" | "render";
/** A tool waits for clicks on the preview: a place for a pin or a callout, two places for a route. */
export type Tool = "none" | "pin" | "pin3d" | "callout" | "route";
export type ToolSheet = { kind: "callout"; place: { lat: number; lng: number }; title: string; subtitle: string; seconds: number } | { kind: "route"; from: { lat: number; lng: number }; to: { lat: number; lng: number }; seconds: number };

export const LARGE_DOWNLOAD_BYTES = 200 * 1048576;
export const MAX_DOWNLOAD_BYTES = 2048 * 1048576;
export const DETAIL_ZOOMS = [10, 11, 12, 13, 14, 15];

export const LABEL_LANGUAGES: { value: string; label: string }[] = [
  { value: "local+en", label: "Local language + English" },
  { value: "local", label: "Local language only" },
  ...NAME_LANGUAGES.map((code) => ({ value: code, label: `All in ${code}` }))
];

export const logLines = signal<LogLine[]>([]);
export const logOpen = signal(false);
export const busy = signal(false);
export const progress = signal<Progress>(null);
export const maps = signal<MapEntry[]>([]);
export const selectedId = signal("");
export const regions = signal<RegionInfo[]>([]);
export const basemap = signal<BasemapSource>({ kind: "world" });
export const projection = signal<MapProjection>("mercator");
export const view = signal<View | null>(null);
export const screen = signal<Screen>("main");
export const tab = signal<Tab>("shots");
export const tool = signal<Tool>("none");
export const toolFirstPoint = signal<{ lat: number; lng: number } | null>(null);
export const toolSheet = signal<ToolSheet | null>(null);
export const regionSheet = signal<RegionSheet | null>(null);
export const jobs = signal<QueueJob[]>([]);
export const flightSeconds = signal(6);
export const labelLanguage = signal("local+en");
export const liveLink = signal(false);
/** Preview names and lines at their rendered size instead of enlarged to stay readable. */
export const exactLook = signal(false);
export const hostInfo = signal<string>("");
/** The name of the last search result the user went to, used to name new maps and shots. */
export const lastPlaceName = signal<string | null>(null);

export const selected = computed(() => maps.value.find((m) => m.mapId === selectedId.value) ?? null);
export const renderSettings = computed(() => normaliseSettings(selected.value?.render ?? null, DEFAULT_FINAL_SETTINGS));

let pinCounter = 1;
let legacyEngineNoted = false;
/** Listeners told when the selected map changes or is read again (the shot list reloads then). */
const mapListeners = new Set<(entry: MapEntry | null) => void>();

export function onSelectedMap(listener: (entry: MapEntry | null) => void): () => void {
  mapListeners.add(listener);
  return () => mapListeners.delete(listener);
}

export const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
export const compactNumber = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

export function log(text: string, kind?: LogKind): void {
  logLines.value = [...logLines.value.slice(-200), { text, kind }];
}

export function fail(what: string, error: unknown): void {
  log(`${what}: ${error instanceof Error ? error.message : String(error)}`, "fail");
}

/** Runs one action at a time with the busy state; errors go to the status line. */
export async function run(label: string, task: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
  } catch (error) {
    fail(label, error);
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

/** Tiles from zoom 0 to maxZoom that cover the bbox (offline estimate, before asking the server). */
export function tilesUpTo(bbox: Bbox, maxZoom: number): number {
  let total = 0;
  for (let z = 0; z <= maxZoom; z++) total += tileCount(tileRangeForBbox(bbox, z));
  return total;
}

export const sourceKey = (s: BasemapSource) => (s.kind === "region" ? `region:${s.name}` : s.kind === "regions" ? `regions:${s.names.join("+")}` : "world");
export const sourceFromKey = (key: string): BasemapSource =>
  key.startsWith("regions:") ? { kind: "regions", names: key.slice(8).split("+") } : key.startsWith("region:") ? { kind: "region", name: key.slice(7) } : { kind: "world" };

/** Every downloaded region, wide ones (fewer zoom levels) first so detailed ones draw on top. */
export const allRegions = (list: RegionInfo[]): BasemapSource => ({
  kind: "regions",
  names: [...list].sort((a, b) => (a.maxZoom ?? 15) - (b.maxZoom ?? 15) || a.name.localeCompare(b.name)).map((r) => r.name)
});

export function basemapLabel(source: BasemapSource): string {
  if (source.kind === "world") return "World";
  const names = regionNames(source);
  return names.length === 1 ? names[0] : `${names.length} regions`;
}

function showMap(entry: MapEntry): void {
  const source = entry.basemap ?? { kind: "world" };
  basemap.value = source;
  projection.value = entry.projection ?? "mercator";
  setCompSize(entry.width, entry.height);
  setPreviewStyle(source, projection.value);
  showCompView(entry.view);
}

export async function readMaps(): Promise<MapEntry[]> {
  const list = await callHost<MapEntry[]>("listMaps");
  maps.value = list;
  return list;
}

export async function refreshMaps(preferActive = false): Promise<void> {
  if (!isInCep()) return;
  try {
    const list = await readMaps();
    if (list.some((m) => m.expressionEngine === "extendscript") && !legacyEngineNoted) {
      legacyEngineNoted = true;
      log("this project uses the Legacy ExtendScript expression engine. Map layers work with it, but play back faster with File > Project Settings > Expressions > JavaScript", "muted");
    }
    const current = list.find((m) => m.mapId === selectedId.value);
    const active = list.find((m) => m.isActiveScene);
    const next = (preferActive && active) || current || active || list[0] || null;
    if (next && next.mapId !== selectedId.value) {
      selectedId.value = next.mapId;
      showMap(next);
    } else if (!next && selectedId.value) {
      selectedId.value = "";
    }
    for (const listener of mapListeners) listener(next);
  } catch (error) {
    fail("reading maps", error);
  }
}

export async function refreshRegions(): Promise<void> {
  if (!isInCep()) return;
  try {
    regions.value = await listRegions();
  } catch (error) {
    fail("reading regions", error);
  }
}

export function selectMap(id: string): void {
  const entry = maps.value.find((m) => m.mapId === id);
  if (!entry) return;
  selectedId.value = id;
  showMap(entry);
  for (const listener of mapListeners) listener(entry);
  void callHost("revealMap", { mapId: id }).catch((error) => fail("showing the map", error));
}

/** A name for a new map or shot: the last place searched for, or what the preview shows. */
export function suggestName(): string | null {
  const v = compView();
  if (!v) return lastPlaceName.value;
  if (lastPlaceName.value) return lastPlaceName.value;
  try {
    // Names are framed for 1080 lines; taller comps sit at a higher zoom for the same picture.
    return nameForView(placeIndex(), v.center, v.zoom - Math.log2(compSize().height / 1080));
  } catch {
    return null;
  }
}

export type NewMapOptions = { name: string; width?: number; height?: number; frameRate?: number; duration?: number; newScene: boolean };

export const createMap = (options: NewMapOptions) =>
  run("new map", async () => {
    const v = compView();
    if (!v) return;
    // A different comp size shows the same picture at a different zoom.
    const height = options.height ?? compSize().height;
    const created = await createMapComp({
      name: options.name,
      width: options.width,
      height: options.height,
      frameRate: options.frameRate,
      duration: options.duration,
      newScene: options.newScene,
      view: { ...v, zoom: v.zoom + Math.log2(height / compSize().height) },
      projection: projection.value
    });
    await callHost("setMapSettings", { mapId: created.id, basemap: basemap.value });
    log(`created ${created.mapCompName} in ${created.sceneCompName}`, "ok");
    selectedId.value = created.id;
    screen.value = "main";
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === created.id) ?? null;
    if (entry) showMap(entry);
    for (const listener of mapListeners) listener(entry);
  });

export const renameMap = (name: string) =>
  run("rename", async () => {
    if (!selected.value || !name.trim()) return;
    await callHost("renameMap", { mapId: selected.value.mapId, name: name.trim() });
    await readMaps();
  });

export const keyframeView = () =>
  run("keyframe", async () => {
    const v = compView();
    if (!v || !selected.value) return;
    await setView(selected.value.mapId, v, true);
    log("camera keyframed at the current time", "ok");
  });

export const flyHere = () =>
  run("fly", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    const v = compView();
    if (!v || !entry) return;
    const flight = await flyTo(entry, v, flightSeconds.value);
    log(`flight of ${flightSeconds.value} s keyed from ${entry.time.toFixed(2)} s (${flight.keys} keys, widest zoom ${flight.topZoom.toFixed(1)}); the time indicator is at its end`, "ok");
  });

export const matchAe = () =>
  run("match view", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (entry) showCompView(entry.view);
  });

/** Live link: the preview drives the camera at the current time (called when a move by hand ends). */
let liveTimer: ReturnType<typeof setTimeout> | null = null;
export function previewMoved(v: View, byUser: boolean): void {
  if (!byUser || !liveLink.value || !selected.value || busy.value) return;
  if (liveTimer) clearTimeout(liveTimer);
  const mapId = selected.value.mapId;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (busy.value || !liveLink.value) return;
    setView(mapId, v, false).catch((error) => fail("live link", error));
  }, 250);
}

/** Adds the matched 3D camera unless the map has one; uses the map's view at the current AE time. */
async function ensureCamera(mapId: string): Promise<void> {
  const list = await readMaps();
  const entry = list.find((m) => m.mapId === mapId);
  if (!entry) throw new Error("the selected map is gone");
  if (entry.hasCamera) return;
  const rig = await addCameraRig(mapId, entry.view);
  if (rig.expressionErrors.length) log(`3D camera expression problems: ${rig.expressionErrors.join("; ")}`, "fail");
  else log(`added ${rig.cameraName} (ground scale of zoom ${rig.referenceZoom})`, "ok");
  for (const warning of rig.warnings) log(warning, "fail");
  await readMaps();
}

export const addCamera = () =>
  run("3D camera", async () => {
    if (selectedId.value) await ensureCamera(selectedId.value);
  });

export async function addPinAt(position: { lat: number; lng: number }, threeD = false): Promise<void> {
  const mapId = selectedId.value;
  if (!mapId) {
    log("create or select a map first", "muted");
    return;
  }
  await run("add pin", async () => {
    if (threeD) await ensureCamera(mapId);
    const added = await addPin(mapId, position, { name: threeD ? String(pinCounter++) : `Pin ${pinCounter++}`, threeD });
    if (added.expressionErrors.length) log(`pin expression problems: ${added.expressionErrors.join("; ")}`, "fail");
    else log(`added ${added.name} at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`, "ok");
  });
}

export function armTool(next: Tool): void {
  tool.value = tool.value === next ? "none" : next;
  toolFirstPoint.value = null;
  toolSheet.value = null;
}

/** A click on the preview: Alt+click pins as before; otherwise the armed tool gets the place. */
export function previewClicked(position: { lat: number; lng: number }, event: MouseEvent): void {
  if (event.altKey) {
    void addPinAt(position, event.shiftKey);
    return;
  }
  const active = tool.value;
  if (active === "none") return;
  if (!selectedId.value) {
    log("create or select a map first", "muted");
    tool.value = "none";
    return;
  }
  if (active === "pin" || active === "pin3d") {
    tool.value = "none";
    void addPinAt(position, active === "pin3d");
  } else if (active === "callout") {
    tool.value = "none";
    toolSheet.value = { kind: "callout", place: position, title: suggestName() ?? "", subtitle: "", seconds: 5 };
  } else if (active === "route") {
    if (!toolFirstPoint.value) toolFirstPoint.value = position;
    else {
      toolSheet.value = { kind: "route", from: toolFirstPoint.value, to: position, seconds: 4 };
      toolFirstPoint.value = null;
      tool.value = "none";
    }
  }
}

/** Frame of the map comp at the scene's current time. */
function currentMapFrame(entry: MapEntry): number {
  return Math.max(0, Math.round((entry.time - entry.layerStart) * entry.frameRate));
}

export const confirmToolSheet = () =>
  run("add layer", async () => {
    const sheet = toolSheet.value;
    if (!sheet) return;
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) return;
    const start = currentMapFrame(entry);
    const frames = Math.max(1, Math.round(sheet.seconds * entry.frameRate));
    if (sheet.kind === "callout") {
      if (!sheet.title.trim()) {
        log("a callout needs a title", "muted");
        return;
      }
      const made = await addCallout(entry.mapId, sheet.place, sheet.title.trim(), sheet.subtitle.trim(), { inFrame: start, outFrame: start + frames });
      log(`added a callout "${sheet.title.trim()}" from ${entry.time.toFixed(2)} s for ${sheet.seconds} s`, made.expressionErrors.length ? "fail" : "ok");
    } else {
      const made = await addRoute(entry.mapId, sheet.from, sheet.to, { name: `Route ${pinCounter++}`, startFrame: start, endFrame: start + frames });
      log(`added a route that draws on from ${entry.time.toFixed(2)} s over ${sheet.seconds} s`, made.expressionErrors.length ? "fail" : "ok");
    }
    toolSheet.value = null;
  });

export const changeBasemap = (key: string) =>
  run("basemap", async () => {
    const source = sourceFromKey(key);
    basemap.value = source;
    setPreviewStyle(source, projection.value);
    if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, basemap: source });
  });

export const changeProjection = (next: MapProjection) =>
  run("projection", async () => {
    projection.value = next;
    setPreviewStyle(basemap.value, next);
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, projection: next });
      await readMaps();
    }
  });

export const runAutoLabels = () =>
  run("labels", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    progress.value = { label: "Placing labels over the timeline", done: 0, total: 1 };
    const choice = labelLanguage.value;
    const fixed = choice !== "local" && choice !== "local+en";
    const result = await autoLabels(mapId, { language: fixed ? { kind: "fixed", language: choice as NameLanguage } : { kind: "local" }, english: choice === "local+en" });
    log(`labels: ${result.labels} placed over the timeline (${result.layers} layers, ${result.removed} old layers replaced) in ${result.seconds.toFixed(1)} s`, result.expressionErrors.length ? "fail" : "ok");
  });

export const animateBorders = () =>
  run("borders", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) return;
    await callHost("setControlKeys", { mapId: entry.mapId, name: "Borders Draw-on", times: [entry.time, entry.time + 4], values: [0, 100] });
    log(`borders draw on from ${entry.time.toFixed(2)} s over 4 s (the "Borders Draw-on" slider on the map layer; render to see it)`, "ok");
  });

export const buildSample = () =>
  run("sample", async () => {
    const wanted = ["paris-wide", "paris", "tokyo-wide", "tokyo"].filter((name) => regions.value.some((r) => r.name === name));
    progress.value = { label: "Building the world flight sample", done: 0, total: 1 };
    const demo = await buildWorldFlight(
      {
        basemap: wanted.length ? { kind: "regions", names: wanted } : { kind: "world" },
        firstZoom: wanted.includes("paris") ? undefined : 5.2,
        secondZoom: wanted.includes("tokyo") ? undefined : 5.2
      },
      (line) => log(`sample: ${line}`, "muted")
    );
    const missing = ["paris", "tokyo"].filter((name) => !wanted.includes(name));
    if (missing.length) log(`sample: download regions named ${missing.join(" and ")} (Download this area) and build it again to fly down to street level`, "muted");
    log(`world flight sample built in "${demo.sceneName}": render it to see the basemap`, demo.expressionErrors.length ? "fail" : "ok");
    screen.value = "main";
    await refreshMaps(true);
  });

export function renderBasemap(quality: RenderQuality): void {
  const entry = selected.value;
  if (!entry) return;
  const settings = quality === "preview" ? PREVIEW_SETTINGS : renderSettings.value;
  renderQueue.add({ mapId: entry.mapId, quality, settings, basemap: basemap.value }, entry.mapCompName);
  tab.value = "render";
}

export async function updateRenderSettings(change: Partial<RenderSettings>): Promise<void> {
  const entry = maps.value.find((m) => m.mapId === selectedId.value);
  if (!entry) return;
  const next = normaliseSettings({ ...normaliseSettings(entry.render, DEFAULT_FINAL_SETTINGS), ...change }, DEFAULT_FINAL_SETTINGS);
  maps.value = maps.value.map((m) => (m.mapId === entry.mapId ? { ...m, render: next } : m));
  try {
    await callHost("setMapSettings", { mapId: entry.mapId, render: next });
  } catch (error) {
    fail("saving render settings", error);
  }
}

export function togglePass(pass: PassId, on: boolean): void {
  const passes = new Set(renderSettings.value.passes);
  if (on) passes.add(pass);
  else passes.delete(pass);
  void updateRenderSettings({ passes: PASS_IDS.filter((p) => passes.has(p)) });
}

export function openRegionSheet(): void {
  const map = previewMap();
  if (!map) return;
  const b = map.getBounds();
  const bbox = { west: Math.max(-180, b.getWest()), south: Math.max(-85, b.getSouth()), east: Math.min(180, b.getEast()), north: Math.min(85, b.getNorth()) };
  // Start with the most detail that stays around a city-sized download (a few thousand tiles).
  const maxZoom = [...DETAIL_ZOOMS].reverse().find((z) => tilesUpTo(bbox, z) <= 3000) ?? DETAIL_ZOOMS[0];
  regionSheet.value = { name: safeRegionName(suggestName() ?? ""), maxZoom, bbox };
}

export const checkRegionSize = () =>
  run("check size", async () => {
    const sheet = regionSheet.value;
    if (!sheet) return;
    progress.value = { label: "Checking size", done: 0, total: 1 };
    const planned = await planRegion(sheet.bbox, sheet.maxZoom);
    regionSheet.value = { ...sheet, planned };
  });

export const startRegionDownload = () =>
  run("download", async () => {
    const sheet = regionSheet.value;
    if (!sheet?.planned) return;
    const name = safeRegionName(sheet.name || `region-${Date.now()}`);
    progress.value = { label: "Downloading", done: 0, total: sheet.planned.plan.tileBytes };
    await downloadRegion(name, sheet.planned, (done, total) => (progress.value = { label: "Downloading", done, total }));
    log(`downloaded region "${name}" (${mb(sheet.planned.plan.tileBytes)}) · © OpenStreetMap contributors`, "ok");
    regionSheet.value = null;
    await refreshRegions();
    const source: BasemapSource = { kind: "region", name };
    basemap.value = source;
    setPreviewStyle(source, projection.value);
    if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, basemap: source });
  });

/** Goes to a search result: a country is framed whole, a place at a zoom that suits its size. */
export function goToResult(result: SearchResult): void {
  const size = compSize();
  const current = compView();
  const bearing = current?.bearing ?? 0;
  let target: View;
  if (result.bbox) target = fitBounds(result.bbox, size, { bearing, pitch: 0, padding: 0.08, maxZoom: 12 });
  else {
    const zoom = result.kind === "coordinates" ? Math.max(current?.zoom ?? 0, 11 + Math.log2(size.height / 1080)) : zoomForPlace(result.population) + Math.log2(size.height / 1080);
    target = { center: { lat: result.lat, lng: result.lng }, zoom, bearing, pitch: current?.pitch ?? 0 };
  }
  lastPlaceName.value = result.kind === "coordinates" ? null : result.name;
  showCompView(target, true);
}

export function startStore(): () => void {
  if (!isInCep()) return () => undefined;
  callHost<{ appVersion: string; lml: string }>("ping")
    .then((info) => {
      hostInfo.value = `After Effects ${info.appVersion} · LazyMapLayers ${info.lml}`;
      log(hostInfo.value, "muted");
    })
    .catch((error) => fail("host not ready", error));
  void refreshMaps(true);
  void refreshRegions();
  renderQueue.load();
  jobs.value = [...renderQueue.jobs];
  const stopQueue = renderQueue.subscribe((event) => {
    jobs.value = [...renderQueue.jobs];
    if (!event) return;
    const { job, result } = event;
    if (job.status === "done" && result) {
      log(`${job.mapName}: ${describeSpec(job.spec)} · ${job.summary}`, "ok");
      if (result.imported.attribution.state === "added") log("added a data credit layer (© OpenStreetMap contributors) to the scene; keep it, or credit OpenStreetMap in your video", "muted");
      void refreshMaps();
    } else if (job.status === "failed") log(`${job.mapName}: render failed: ${job.error}`, "fail");
    else if (job.status === "cancelled") log(`${job.mapName}: render cancelled (rendered frames are kept; Resume continues)`, "muted");
  });
  const onFocus = () => void refreshMaps();
  window.addEventListener("focus", onFocus);
  return () => {
    stopQueue();
    window.removeEventListener("focus", onFocus);
  };
}
