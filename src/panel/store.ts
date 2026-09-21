// Panel state (signals) and the actions behind the buttons. Components only read signals and call
// these functions; every talk with After Effects happens here. Nothing polls After Effects: maps are
// read when the panel gets the focus and after the panel's own actions.

import { computed, effect, signal } from "@preact/signals";
import type { View } from "../core/camera/camera.ts";
import { fitBounds, fitPoints } from "../core/camera/fit.ts";
import type { ImportedArea, ImportedLine, ImportedPlace } from "../core/data/importLines.ts";
import { simplifyPolygons } from "../core/geo/simplify.ts";
import { keyOf } from "../core/render/frameKey.ts";
import type { MapProjection } from "../core/camera/globe.ts";
import { NAME_LANGUAGES, type NameLanguage } from "../core/labels/language.ts";
import type { ExtractPlan } from "../core/pmtiles/extract.ts";
import { PASS_IDS, type PassId } from "../core/render/passes.ts";
import { DEFAULT_FINAL_SETTINGS, PREVIEW_SETTINGS, normaliseSettings, type RenderQuality, type RenderSettings } from "../core/render/plan.ts";
import { nameForView, zoomForPlace, type SearchResult } from "../core/search/placeSearch.ts";
import { AREA_MAX_POINTS, AREA_PREFIX, MAX_AREAS, areaIdOf, isAreaCode, normaliseAreas, normaliseHighlights, toggleHighlight, type Areas, type Highlight } from "../core/style/highlights.ts";
import { DEFAULT_SHADE, normaliseTerrain, type TerrainSetting } from "../core/style/terrain.ts";
import { DEFAULT_THEME_ID, themeById } from "../core/style/themes.ts";
import { tileCount, tileRangeForBbox, type Bbox } from "../core/tiles/tileMath.ts";
import { regionNames, type BasemapSource } from "./basemap/basemapStyle.ts";
import { callHost, isInCep } from "./cep.ts";
import { provinceAt, provincesOf, type Province } from "./data/admin1.ts";
import { districtAt, districtSetOf, districtsOf, findDistricts, installDistricts, installedDistricts, removeDistricts, type DistrictOffer } from "./data/districts.ts";
import { countryOutline } from "./data/countries.ts";
import { placeIndex, resetPlaceIndex } from "./data/worldLabels.ts";
import { buildWorldFlight } from "./demo/worldFlight.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { addCameraRig, addPin, attachLayers, createMapComp, detachLayers, flyTo, selectionInfo, setView, type SelectionInfo } from "./mapApi.ts";
import { importFile } from "./data/importFile.ts";
import { addCallout, addRoute, addRouteLine } from "./overlays/routeCallout.ts";
import { addFeatureShape } from "./overlays/shapeFeature.ts";
import { compSize, compView, countryAt, previewMap, setCompSize, setPreviewImport, setPreviewStyle, showCompView } from "./preview.ts";
import { downloadRegion, listRegions, planRegion, safeRegionName, type RegionInfo } from "./regions.ts";
import { downloadTerrain, listTerrainPacks, planTerrain, type TerrainPackInfo } from "./terrain.ts";
import { samplerFor } from "./elevation.ts";
import { downloadImagery, IMAGERY_INFO, type ImageryPack } from "./imagery/packs.ts";
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
  /** The map's look (core/style/themes.ts). */
  theme: string | null;
  relief: boolean;
  sky?: boolean;
  terrain?: TerrainSetting | null;
  highlightLayers?: "each" | "one";
  highlights: Highlight[];
  view: View;
  /** "javascript-1.0" or "extendscript" (the project's expression engine). */
  expressionEngine: string | null;
};

export type Progress = { label: string; done: number; total: number; cancel?: () => void } | null;
/** The download sheet, for an OpenStreetMap region or for an elevation pack of the area in the preview. */
export type RegionSheet = { kind: "region" | "terrain"; name: string; maxZoom: number; bbox: Bbox; planned?: { plan: ExtractPlan; url: string; build: string } };
export type Screen = "main" | "maps" | "newMap" | "settings";
export type Tab = "shots" | "render";
/** A tool waits for clicks on the preview: a place for a pin or a callout, two places for a route. */
export type Tool = "none" | "pin" | "pin3d" | "callout" | "route" | "highlight" | "attach";
export type ToolSheet = { kind: "callout"; place: { lat: number; lng: number }; title: string; subtitle: string; seconds: number } | { kind: "route"; from: { lat: number; lng: number }; to: { lat: number; lng: number }; seconds: number };

export const LARGE_DOWNLOAD_BYTES = 200 * 1048576;
export const MAX_DOWNLOAD_BYTES = 2048 * 1048576;
export const DETAIL_ZOOMS = [10, 11, 12, 13, 14, 15];
/** Elevation tiles are 512 px wide: zoom 12 is about 20 m per pixel, which is what the open 30 m models hold. */
export const TERRAIN_DETAIL_ZOOMS = [7, 8, 9, 10, 11, 12];

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
export const themeId = signal<string>(DEFAULT_THEME_ID);
/** Shaded relief over the land (needs the relief imagery pack). */
export const reliefOn = signal(false);
/** The sky above the horizon of a tilted flat map. */
export const skyOn = signal(true);
/** The map's elevation pack and shading, and the packs on this computer. */
export const terrain = signal<TerrainSetting | null>(null);
export const terrainPacks = signal<TerrainPackInfo[]>([]);
/** What the last imported file held (kept for this session; the layers made from it live in the project). */
export const imported = signal<{ fileName: string; lines: ImportedLine[]; places: ImportedPlace[]; areas: ImportedArea[]; skipped: number } | null>(null);
export const importSheetOpen = signal(false);

/** Highlighted countries of the selected map. */
export const highlights = signal<Highlight[]>([]);
/** Polygons of the custom areas among the highlights (stored with the map, on their own comment line). */
export const areas = signal<Areas>({});
const look = () => ({ theme: themeId.value, relief: reliefOn.value, highlights: highlights.value, areas: areas.value, sky: skyOn.value, terrain: terrain.value });
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
/** How many names Auto labels may place: the most important ones come first. */
export const LABEL_DENSITIES = { few: { label: "Few (up to 20)", max: 20 }, normal: { label: "Normal (up to 45)", max: 45 }, many: { label: "Many (up to 120)", max: 120 } } as const;
export type LabelDensity = keyof typeof LABEL_DENSITIES;
export const labelDensity = signal<LabelDensity>("normal");
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
  themeId.value = themeById(entry.theme).id;
  reliefOn.value = !!entry.relief;
  skyOn.value = entry.sky !== false;
  terrain.value = normaliseTerrain(entry.terrain);
  highlights.value = normaliseHighlights(entry.highlights);
  highlightLayers.value = entry.highlightLayers === "one" ? "one" : "each";
  areas.value = {};
  // The polygons of custom areas are read separately: they can be large, and most maps have none.
  if (highlights.value.some((h) => h.code.startsWith(AREA_PREFIX))) {
    const mapId = entry.mapId;
    callHost<Areas>("getAreas", { mapId })
      .then((stored) => {
        if (selectedId.value !== mapId) return;
        areas.value = normaliseAreas(stored, highlights.value);
        setPreviewStyle(basemap.value, projection.value, look());
      })
      .catch((error) => fail("reading highlighted areas", error));
  }
  setCompSize(entry.width, entry.height);
  setPreviewStyle(source, projection.value, look());
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
    await callHost("setMapSettings", { mapId: created.id, basemap: basemap.value, theme: themeId.value, relief: reliefOn.value, highlights: highlights.value, areas: areas.value, highlightLayers: highlightLayers.value, sky: skyOn.value, terrain: terrain.value });
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

/** The ground's elevation at places, from the selected map's elevation pack (zeros without one). */
async function groundElevations(places: { lat: number; lng: number }[]): Promise<number[]> {
  const sampler = samplerFor(terrain.value);
  if (!sampler) return places.map(() => 0);
  try {
    return await sampler.elevations(places);
  } finally {
    sampler.close();
  }
}

export async function addPinAt(position: { lat: number; lng: number }, threeD = false): Promise<void> {
  const mapId = selectedId.value;
  if (!mapId) {
    log("create or select a map first", "muted");
    return;
  }
  await run("add pin", async () => {
    if (threeD) await ensureCamera(mapId);
    const [elevation] = await groundElevations([position]);
    const added = await addPin(mapId, position, { name: threeD ? String(pinCounter++) : `Pin ${pinCounter++}`, threeD, elevation: terrain.value ? elevation : undefined });
    if (added.expressionErrors.length) log(`pin expression problems: ${added.expressionErrors.join("; ")}`, "fail");
    else log(`added ${added.name} at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`, "ok");
  });
}

export function armTool(next: Tool): void {
  tool.value = tool.value === next ? "none" : next;
  toolFirstPoint.value = null;
  toolSheet.value = null;
  if (tool.value === "attach") void refreshSelection();
}

/** What the user has selected in After Effects, for the attach tool. */
export const selection = signal<SelectionInfo | null>(null);
/** Attached layers grow and turn with the map while these are on. */
export const attachScale = signal(false);
export const attachRotate = signal(false);

export async function refreshSelection(): Promise<void> {
  if (!selectedId.value) {
    selection.value = null;
    return;
  }
  try {
    selection.value = await selectionInfo(selectedId.value);
  } catch (error) {
    selection.value = null;
    fail("reading the selection in After Effects", error);
  }
}

/** Attaches the layers selected in After Effects to a place, so they stay on it while the camera moves. */
export const attachAt = (position: { lat: number; lng: number }) =>
  run("attach layers", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const [elevation] = await groundElevations([position]);
    const made = await attachLayers(mapId, position, { elevation: terrain.value ? elevation : 0, scaleWithMap: attachScale.value, rotateWithMap: attachRotate.value });
    await refreshSelection();
    if (made.expressionErrors.length) log(`attach problems: ${made.expressionErrors.slice(0, 3).join("; ")}`, "fail");
    else log(`${made.layers.length} ${made.layers.length === 1 ? "layer" : "layers"} attached at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}: ${made.layers.slice(0, 3).join(", ")}${made.layers.length > 3 ? "…" : ""}. Move them with their Latitude and Longitude sliders`, "ok");
  });

/** Puts the selected attached layers back as they were. */
export const detachSelected = () =>
  run("unlink layers", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const undone = await detachLayers(mapId);
    await refreshSelection();
    log(undone.layers.length ? `${undone.layers.length} ${undone.layers.length === 1 ? "layer is" : "layers are"} back as they were: ${undone.layers.slice(0, 3).join(", ")}` : "none of the selected layers is attached to this map", undone.layers.length ? "ok" : "muted");
  });

/** A click on the preview: Alt+click pins as before; otherwise the armed tool gets the place. */
export function previewClicked(position: { lat: number; lng: number }, event: MouseEvent, point: { x: number; y: number }): void {
  if (event.altKey) {
    void addPinAt(position, event.shiftKey);
    return;
  }
  const active = tool.value;
  if (active === "none") return;
  if (active === "highlight") {
    // The tool stays on, so several countries can be clicked in a row (Esc ends it).
    const country = countryAt(point);
    if (!country) log("no country there (click on land)", "muted");
    else if (highlightLevel.value === "province") {
      const province = provinceAt(country.code, position);
      if (province) toggleProvinceHighlight(province);
      else log(`no province of ${country.name} there`, "muted");
    } else if (highlightLevel.value === "district") {
      const set = districtSetOf(country.code);
      if (!set) void offerDistricts(country);
      else {
        districtPrompt.value = null;
        const unit = districtAt(country.code, position);
        if (unit) toggleProvinceHighlight(unit);
        else log(`no ${set.unit} of ${country.name} there`, "muted");
      }
    } else toggleCountryHighlight(country.code, country.name);
    return;
  }
  if (!selectedId.value) {
    log("create or select a map first", "muted");
    tool.value = "none";
    return;
  }
  if (active === "attach") {
    tool.value = "none";
    void attachAt(position);
  } else if (active === "pin" || active === "pin3d") {
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
      const made = await addCallout(entry.mapId, sheet.place, sheet.title.trim(), sheet.subtitle.trim(), { inFrame: start, outFrame: start + frames, terrain: terrain.value });
      log(`added a callout "${sheet.title.trim()}" from ${entry.time.toFixed(2)} s for ${sheet.seconds} s`, made.expressionErrors.length ? "fail" : "ok");
    } else {
      const made = await addRoute(entry.mapId, sheet.from, sheet.to, { name: `Route ${pinCounter++}`, startFrame: start, endFrame: start + frames, terrain: terrain.value });
      log(`added a route that draws on from ${entry.time.toFixed(2)} s over ${sheet.seconds} s`, made.expressionErrors.length ? "fail" : "ok");
    }
    toolSheet.value = null;
  });

export const importPicked = (file: File) =>
  run("import", async () => {
    progress.value = { label: `Reading ${file.name}`, done: 0, total: 1 };
    const result = await importFile(file);
    imported.value = result;
    importSheetOpen.value = true;
    const first = result.lines[0];
    if (first) fitLine(first.points);
    else if (result.places.length) showCompView(fitPoints(result.places, compSize(), { padding: 0.15, maxZoom: 12 + Math.log2(compSize().height / 1080) }), true);
    log(`${file.name}: ${result.lines.length} ${result.lines.length === 1 ? "line" : "lines"}, ${result.areas.length} ${result.areas.length === 1 ? "area" : "areas"}, ${result.places.length} ${result.places.length === 1 ? "place" : "places"}${result.skipped ? `, ${result.skipped} skipped` : ""}`, "ok");
  });

/** Frames a line in the preview, at the current bearing and pitch. */
export function fitLine(points: { lat: number; lng: number }[]): void {
  const current = compView();
  showCompView(fitPoints(points, compSize(), { bearing: current?.bearing ?? 0, pitch: current?.pitch ?? 0, padding: 0.12, maxZoom: 16 + Math.log2(compSize().height / 1080) }), true);
}

/** Draws an imported line as a route layer from the current time, with or without a traveller. */
export const drawImportedLine = (line: ImportedLine, seconds: number, traveller: boolean, recordedPace = false) =>
  run("draw route", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) {
      log("create or select a map first", "muted");
      return;
    }
    const start = currentMapFrame(entry);
    const frames = Math.max(1, Math.round(seconds * entry.frameRate));
    const pace = recordedPace && line.times ? { points: line.points, times: line.times, leaves: line.leaves } : undefined;
    const made = await addRouteLine(entry.mapId, line.points, { name: `Route: ${line.name}`, startFrame: start, endFrame: start + frames, traveller, outline: line.closed, pace, terrain: terrain.value });
    const thinned = made.points < line.points.length ? ` (${line.points.length} points thinned to ${made.points})` : "";
    const paced = pace ? ` at its recorded pace (${made.keys} keys, long stops shortened)` : "";
    log(`"${line.name}" draws on from ${entry.time.toFixed(2)} s over ${seconds} s${paced}${traveller ? ", with an arrow travelling along it (parent your own artwork to the Traveller layer)" : ""}${thinned}`, made.expressionErrors.length ? "fail" : "ok");
  });

export const pinImportedPlaces = (places: ImportedPlace[]) =>
  run("add pins", async () => {
    const mapId = selectedId.value;
    if (!mapId) {
      log("create or select a map first", "muted");
      return;
    }
    const some = places.slice(0, 40);
    const elevations = await groundElevations(some);
    let done = 0;
    for (const place of some) {
      progress.value = { label: "Adding pins", done, total: some.length };
      await addPin(mapId, place, { name: place.name, elevation: terrain.value ? elevations[done] : undefined });
      done++;
    }
    log(`added ${done} pins${places.length > some.length ? ` (the first ${some.length} of ${places.length})` : ""}`, "ok");
  });

export const changeBasemap = (key: string) =>
  run("basemap", async () => {
    const source = sourceFromKey(key);
    basemap.value = source;
    setPreviewStyle(source, projection.value);
    if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, basemap: source });
  });

export const changeTheme = (next: string) =>
  run("look", async () => {
    themeId.value = themeById(next).id;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, theme: themeId.value });
      await readMaps();
    }
  });

/** Replaces the map's highlights: the preview shows them at once, the next render draws their pass. */
export async function setHighlights(next: Highlight[], nextAreas: Areas = areas.value): Promise<void> {
  highlights.value = normaliseHighlights(next);
  // Geometry of areas that are no longer highlighted goes with them.
  areas.value = normaliseAreas(nextAreas, highlights.value);
  setPreviewStyle(basemap.value, projection.value, look());
  if (!selectedId.value) return;
  try {
    await callHost("setMapSettings", { mapId: selectedId.value, highlights: highlights.value, areas: areas.value });
    maps.value = maps.value.map((m) => (m.mapId === selectedId.value ? { ...m, highlights: highlights.value } : m));
  } catch (error) {
    fail("saving highlights", error);
  }
}

/** The highlight code an imported area gets: the same area always gets the same code. */
export const areaCode = (area: ImportedArea) => `${AREA_PREFIX}${keyOf([area.name, area.points, area.bbox]).slice(0, 12)}`;

/** Highlights an imported area (or removes it again). Its polygons are thinned and saved with the map. */
export function toggleAreaHighlight(area: ImportedArea): void {
  const code = areaCode(area);
  const had = highlights.value.some((h) => h.code === code);
  if (!had && Object.keys(areas.value).length >= MAX_AREAS) {
    log(`a map can highlight up to ${MAX_AREAS} custom areas`, "muted");
    return;
  }
  const geometry = simplifyPolygons(area.polygons, AREA_MAX_POINTS);
  if (!had && !geometry.length) {
    log(`"${area.name}" has no usable outline`, "fail");
    return;
  }
  void setHighlights(toggleHighlight(highlights.value, code, area.name), had ? areas.value : { ...areas.value, [code.slice(AREA_PREFIX.length)]: geometry });
  log(had ? `${area.name} is no longer highlighted` : `${area.name} highlighted: render to get it as its own layer above the basemap`, "ok");
}

/** "each": every highlight renders as its own After Effects layer. "one": a single layer holds them all. */
export const highlightLayers = signal<"each" | "one">("each");

export const changeHighlightLayers = (next: "each" | "one") =>
  run("highlight layers", async () => {
    highlightLayers.value = next;
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, highlightLayers: next });
      await readMaps();
    }
  });

/** What a click of the highlight tool picks: whole countries, their provinces, or their districts (a download per country). */
export const highlightLevel = signal<"country" | "province" | "district">("country");

/** The country whose districts the user asked for, and what geoBoundaries offers for it. */
export type DistrictPrompt = { country: { code: string; name: string; iso: string }; state: "looking" | "offer" | "none" | "failed"; offer?: DistrictOffer; message?: string };
export const districtPrompt = signal<DistrictPrompt | null>(null);
/** Bumped when district sets are installed or removed, so lists of them redraw. */
export const districtSets = signal(0);
export const listDistrictSets = () => (districtSets.value, installedDistricts());

/** Looks up what can be downloaded for a country (a few kilobytes); nothing large moves before the user presses Download. */
export async function offerDistricts(country: { code: string; name: string; iso: string }): Promise<void> {
  districtPrompt.value = { country, state: "looking" };
  try {
    const offer = await findDistricts(country.iso);
    if (districtPrompt.value?.country.code !== country.code) return;
    districtPrompt.value = offer ? { country, state: "offer", offer } : { country, state: "none" };
  } catch (error) {
    if (districtPrompt.value?.country.code === country.code) districtPrompt.value = { country, state: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

export const downloadDistricts = () =>
  run("download districts", async () => {
    const prompt = districtPrompt.value;
    if (!prompt?.offer) return;
    const stopper = new AbortController();
    const cancel = () => stopper.abort();
    const label = `Downloading the ${prompt.offer.unit} boundaries of ${prompt.country.name}`;
    progress.value = { label, done: 0, total: 1, cancel };
    const started = performance.now();
    const set = await installDistricts(prompt.offer, prompt.country, {
      signal: stopper.signal,
      onProgress: (done, total) => (progress.value = { label, done, total: total ?? Math.max(done, prompt.offer?.sizeBytes ?? 1), cancel })
    });
    resetPlaceIndex();
    districtSets.value++;
    districtPrompt.value = null;
    log(`${set.units.length} ${set.unit} boundaries of ${set.countryName} installed in ${((performance.now() - started) / 1000).toFixed(1)} s (${set.source}; ${set.license}). Click one on the map, or search its name`, "ok");
  });

/** While on, a shape layer's outline draws on over four seconds from the current time. */
export const shapeDrawOn = signal(false);

/** The outline of a highlight: a country from the bundled outlines, anything else from the map's own areas. */
function outlineFor(code: string): number[][][][] | null {
  if (isAreaCode(code)) return areas.value[areaIdOf(code)] ?? null;
  return countryOutline(code)?.polygons ?? null;
}

/** Adds a highlighted country, province, district or area as an editable After Effects shape layer. */
export const addHighlightShape = (highlight: Highlight) =>
  run("shape layer", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) {
      log("create or select a map first", "muted");
      return;
    }
    const polygons = outlineFor(highlight.code);
    if (!polygons) {
      log(`no outline for "${highlight.name}" in this build`, "fail");
      return;
    }
    const made = await addFeatureShape(
      entry.mapId,
      { name: highlight.name, polygons, code: highlight.code },
      {
        color: highlight.color,
        fill: highlight.fill,
        outline: highlight.outline,
        startFrame: currentMapFrame(entry),
        drawFrames: shapeDrawOn.value ? Math.round(4 * entry.frameRate) : 0,
        terrain: terrain.value
      }
    );
    const drawn = shapeDrawOn.value ? ` and draws on from ${entry.time.toFixed(2)} s over 4 s` : "";
    log(`"${highlight.name}" added as a shape layer (${made.rings} ${made.rings === 1 ? "path" : "paths"}, ${made.points} points)${drawn}. It follows the map; restyle it like any shape layer`, made.expressionErrors.length ? "fail" : "ok");
  });

export function removeDistrictSet(iso: string): void {
  try {
    removeDistricts(iso);
    resetPlaceIndex();
    districtSets.value++;
  } catch (error) {
    fail("removing districts", error);
  }
}

/** A district from a search result (its country and id). */
export function toggleDistrictById(country: string, id: string): void {
  const unit = districtsOf(country).find((u) => u.id === id);
  if (unit) toggleProvinceHighlight(unit);
  else log("that district's boundaries are no longer installed", "fail");
}

/** Highlights a province (or removes it again): its polygons come from the bundled province data. */
export function toggleProvinceHighlight(province: Province): void {
  const code = `${AREA_PREFIX}${province.id}`;
  const had = highlights.value.some((h) => h.code === code);
  if (!had && Object.keys(areas.value).length >= MAX_AREAS) {
    log(`a map can highlight up to ${MAX_AREAS} provinces and custom areas`, "muted");
    return;
  }
  const geometry = simplifyPolygons(province.polygons, AREA_MAX_POINTS);
  void setHighlights(toggleHighlight(highlights.value, code, province.name), had ? areas.value : { ...areas.value, [province.id]: geometry });
  log(had ? `${province.name} is no longer highlighted` : `${province.name} highlighted: render to get it as its own layer above the basemap`, "ok");
}

/** A province from a search result (its country and id). */
export function toggleProvinceById(country: string, id: string): void {
  const province = provincesOf(country).find((p) => p.id === id);
  if (province) toggleProvinceHighlight(province);
  else log("the province data for that country is missing from this build", "fail");
}

export function toggleCountryHighlight(code: string, name: string): void {
  const had = highlights.value.some((h) => h.code === code);
  void setHighlights(toggleHighlight(highlights.value, code, name));
  log(had ? `${name} is no longer highlighted` : `${name} highlighted: render to get it as its own layer above the basemap`, "ok");
}

export const changeRelief = (on: boolean) =>
  run("relief", async () => {
    reliefOn.value = on;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, relief: on });
      await readMaps();
    }
  });

/** Bumped when an imagery pack arrives, so the Look sheet redraws. */
export const imageryVersion = signal(0);

/** Downloads a satellite or relief pack from the project's GitHub release into the user data folder. */
export const downloadImageryPack = (pack: ImageryPack) =>
  run("download imagery", async () => {
    const info = IMAGERY_INFO[pack];
    const stopper = new AbortController();
    const cancel = () => stopper.abort();
    const label = `Downloading ${info.label}`;
    progress.value = { label, done: 0, total: info.bytes, cancel };
    const started = performance.now();
    await downloadImagery(pack, { signal: stopper.signal, onProgress: (done, total) => (progress.value = { label, done, total, cancel }) });
    imageryVersion.value++;
    setPreviewStyle(basemap.value, projection.value, look());
    log(`${info.label} installed (${mb(info.bytes)} in ${((performance.now() - started) / 1000).toFixed(1)} s) · ${info.attribution}`, "ok");
  });

export const changeSky = (on: boolean) =>
  run("sky", async () => {
    skyOn.value = on;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, sky: on });
      await readMaps();
    }
  });

/** The ground's elevation at the map's centre, rounded to 10 m (the level a 3D map's camera counts from). */
export async function groundAtCentre(): Promise<number> {
  const centre = compView()?.center;
  if (!centre) return 0;
  const [elevation] = await groundElevations([centre]).catch(() => [0]);
  return Math.round(elevation / 10) * 10;
}

/** Picks the map's elevation pack (null for a flat map), the strength of its shading, or the 3D height and ground level. */
export const changeTerrain = (next: TerrainSetting | null) =>
  run("terrain", async () => {
    const before = terrain.value;
    let wanted = normaliseTerrain(next);
    // Switching 3D on: the ground level starts at the map centre's elevation, so the camera keeps its height above the ground there.
    if (wanted && wanted.height > 0 && !(before && before.height > 0) && wanted.ground === 0) {
      terrain.value = { ...wanted, height: 0 };
      wanted = { ...wanted, ground: await groundAtCentre() };
    }
    terrain.value = wanted;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, terrain: terrain.value });
      await readMaps();
    }
  });

export async function refreshTerrainPacks(): Promise<void> {
  try {
    terrainPacks.value = await listTerrainPacks();
  } catch (error) {
    fail("listing elevation packs", error);
  }
}

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
    const stopper = new AbortController();
    const cancel = () => stopper.abort();
    progress.value = { label: "Choosing names for the whole timeline", done: 0, total: 1, cancel };
    const choice = labelLanguage.value;
    const fixed = choice !== "local" && choice !== "local+en";
    const result = await autoLabels(mapId, {
      language: fixed ? { kind: "fixed", language: choice as NameLanguage } : { kind: "local" },
      english: choice === "local+en",
      theme: themeId.value,
      maxLabels: LABEL_DENSITIES[labelDensity.value].max,
      terrain: terrain.value,
      signal: stopper.signal,
      // Names arrive in After Effects a few at a time, so it stays responsive and can be cancelled.
      onProgress: (done, total) => (progress.value = { label: "Adding names", done, total, cancel })
    });
    const summary = `${result.labels} of ${result.planned} names added (${result.layers} layers, ${result.removed} old layers replaced) in ${result.seconds.toFixed(1)} s`;
    if (result.cancelled) log(`labels cancelled: ${summary}. The names added so far stay; Remove labels takes them away`, "muted");
    else log(`labels: ${summary}`, result.expressionErrors.length ? "fail" : "ok");
  });

export const removeLabels = () =>
  run("remove labels", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const result = await callHost<{ removed: number }>("removeLabels", { mapId });
    log(result.removed ? `removed ${result.removed} label layers (one undo step)` : "this map has no labels from Auto labels", result.removed ? "ok" : "muted");
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
  renderQueue.add({ mapId: entry.mapId, quality, settings, basemap: basemap.value, theme: themeId.value, relief: reliefOn.value, highlights: highlights.value, areas: areas.value, highlightLayers: highlightLayers.value, sky: skyOn.value, terrain: terrain.value }, entry.mapCompName);
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
  regionSheet.value = { kind: "region", name: safeRegionName(suggestName() ?? ""), maxZoom, bbox };
}

/** The same sheet for an elevation pack of the area in the preview. */
export function openTerrainSheet(): void {
  const map = previewMap();
  if (!map) return;
  const b = map.getBounds();
  const bbox = { west: Math.max(-180, b.getWest()), south: Math.max(-85, b.getSouth()), east: Math.min(180, b.getEast()), north: Math.min(85, b.getNorth()) };
  // Elevation tiles are heavy (about 150 KB each): start where the download stays around 50 MB.
  const maxZoom = [...TERRAIN_DETAIL_ZOOMS].reverse().find((z) => tilesUpTo(bbox, z) <= 350) ?? TERRAIN_DETAIL_ZOOMS[0];
  regionSheet.value = { kind: "terrain", name: safeRegionName(suggestName() ?? ""), maxZoom, bbox };
}

export const checkRegionSize = () =>
  run("check size", async () => {
    const sheet = regionSheet.value;
    if (!sheet) return;
    progress.value = { label: "Checking size", done: 0, total: 1 };
    const planned = sheet.kind === "terrain" ? { ...(await planTerrain(sheet.bbox, sheet.maxZoom)), build: "Mapterhorn" } : await planRegion(sheet.bbox, sheet.maxZoom);
    regionSheet.value = { ...sheet, planned };
  });

export const startRegionDownload = () =>
  run("download", async () => {
    const sheet = regionSheet.value;
    if (!sheet?.planned) return;
    const name = safeRegionName(sheet.name || `region-${Date.now()}`);
    if (sheet.kind === "terrain") {
      progress.value = { label: "Downloading elevation", done: 0, total: sheet.planned.plan.tileBytes };
      await downloadTerrain(name, sheet.planned, (done, total) => (progress.value = { label: "Downloading elevation", done, total }));
      log(`downloaded elevation pack "${name}" (${mb(sheet.planned.plan.tileBytes)}) · © Mapterhorn (open elevation data)`, "ok");
      regionSheet.value = null;
      await refreshTerrainPacks();
      terrain.value = normaliseTerrain({ pack: name, shade: terrain.value?.shade ?? DEFAULT_SHADE });
      setPreviewStyle(basemap.value, projection.value, look());
      if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, terrain: terrain.value });
      return;
    }
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
  void refreshTerrainPacks();
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
  const onFocus = () => {
    void refreshMaps();
    if (tool.value === "attach") void refreshSelection();
  };
  window.addEventListener("focus", onFocus);
  // The file listed in the Import sheet is drawn over the preview while the sheet is open.
  const stopImportOverlay = effect(() => setPreviewImport(importSheetOpen.value ? imported.value : null));
  return () => {
    stopQueue();
    stopImportOverlay();
    window.removeEventListener("focus", onFocus);
  };
}
