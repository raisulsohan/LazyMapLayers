// One render of a map comp: read the camera for every frame and motion blur sample, work out which
// pass images are not in the cache yet, draw only those, encode them in workers, link the sequences
// and import them into After Effects in one undo step.

import type { AnimatedView } from "../../core/render/plan.ts";
import { BOUNDARY_ID_PREFIX } from "../../core/data/boundarySet.ts";
import { keyOf } from "../../core/render/frameKey.ts";
import { HIGHLIGHT_PASS, PASS_INFO, highlightPassId, isHighlightPass, rendersFor, type HighlightPassId, type PassId, type RenderId } from "../../core/render/passes.ts";
import { DATA_CODE, normaliseDataFill, type DataFill } from "../../core/style/dataFill.ts";
import { HEAT_CODE, normaliseHeat, type HeatSetting } from "../../core/style/heat.ts";
import { applyLookDetails, normaliseDetails, type LookDetails } from "../../core/style/lookDetails.ts";
import { localPathOf, normaliseOwnImagery, type OwnImagery } from "../../core/style/ownImagery.ts";
import { localStamp } from "../imagery/localTiles.ts";
import { normaliseAreas, normaliseHighlights, type Areas, type Highlight } from "../../core/style/highlights.ts";
import { SampleAccumulator } from "../../core/render/pixels.ts";
import { frameKey, isStill, outputGeometry, sampleOffsets, type FrameKeyContext, type OutputGeometry, type RenderQuality, type RenderSettings } from "../../core/render/plan.ts";
import { callHost, callHostWithJobFile, fs } from "../cep.ts";
import { naturalEarthArchivePath, regionArchivePath } from "../basemap/maplibreSetup.ts";
import { basemapStyle, regionNames, STREETS_SOURCE, terrainUsable, WORLD_DETAIL_FADE, type BasemapSource, type Marker } from "../basemap/basemapStyle.ts";
import { OSM_PROTOCOL, fetchOsmTiles, hasOsmTile, installedWorld, streetDetailAllowed, takeOsmMisses, tileSource } from "../osmTiles.ts";
import { isOfflineError } from "../net.ts";
import { allNeeds, describeFrames, detailLevels, framesNeeds, sourceZooms, type DetailLevel, type DetailSource } from "../../core/tiles/streetDetail.ts";
import type { StyleSpecification } from "maplibre-gl";
import type { ThemeLike } from "../../core/style/themes.ts";
import { normaliseTerrain, type TerrainSetting } from "../../core/style/terrain.ts";
import { TERRAIN_CREDIT, terrainArchivePath } from "../terrain.ts";
import { AREAS_SOURCE, DATA_SOURCE, HEAT_SOURCE } from "../basemap/naturalEarthStyle.ts";
import type { MapProjection } from "../../core/camera/globe.ts";
import { sharedEncodePool } from "./encodePool.ts";
import { FrameRenderer, layerGroup, layerHighlight } from "./frameRenderer.ts";
import { RenderStore } from "./renderStore.ts";
import { normaliseHistory, yearsForRange, type HistorySetting } from "../../core/history/historyStyle.ts";
import { HISTORY_CREDIT, HISTORY_ID_PREFIX } from "../../core/history/historyPack.ts";
import { hasHistoryPack, historyManifest } from "../data/history.ts";

export type { BasemapSource, Marker } from "../basemap/basemapStyle.ts";
export { basemapStyle } from "../basemap/basemapStyle.ts";

export type RenderJobSpec = {
  mapId: string;
  quality: RenderQuality;
  settings: RenderSettings;
  basemap: BasemapSource;
  /** The map's look (core/style/themes.ts) and whether shaded relief lies over the land. */
  theme?: ThemeLike;
  relief?: boolean;
  /** Highlighted countries and areas: rendered as their own passes, which the job adds by itself. */
  highlights?: Highlight[];
  areas?: Areas;
  /** "each" (default): every highlight is its own pass and layer. "one": a single pass holds them all. */
  highlightLayers?: "each" | "one";
  /** The sky above the horizon of a tilted flat map (default on). */
  sky?: boolean;
  /** The world of another year instead of today's countries (D92). */
  history?: HistorySetting | null;
  /** The elevation pack and the strength of the shaded slopes. */
  terrain?: TerrainSetting | null;
  /** Whether features from OpenStreetMap were brought into this map: they carry their own credit. */
  osmData?: boolean;
  /** Numbers on the map: a colour per country, rendered as its own layer. */
  dataFill?: DataFill | null;
  /** Heat: points that warm the map around them, rendered as its own layer. */
  heat?: HeatSetting | null;
  /** The look's smaller details: line and road widths, how many names. */
  lookDetails?: LookDetails | null;
  /** Tiles of the user's own, fetched from their address while rendering. */
  own?: OwnImagery | null;
  /** Test markers drawn into the base pass as solid circles (radius in comp pixels). */
  markers?: Marker[];
  /** Street detail on demand (D101): on unless false; false draws only what is installed, as before. */
  streetDetail?: boolean;
};

export type RenderStage = "camera" | "detail" | "planning" | "rendering" | "importing";

export type RenderProgress = {
  stage: RenderStage;
  done: number;
  total: number;
  /** Unique frames drawn so far in this job. */
  rendered: number;
  /** Frames whose images were already cached (or shared with an earlier frame of this job). */
  reused: number;
};

export type RenderJobResult = {
  frames: number;
  rendered: number;
  reused: number;
  msPerRenderedFrame: number;
  totalMs: number;
  geometry: OutputGeometry;
  samples: number;
  passes: PassId[];
  sequences: { pass: PassId; folder: string; firstFramePath: string }[];
  imported: { passes: { pass: string; layerName: string; main: string; hasProxy: boolean; useProxy: boolean; created: boolean }[]; attribution: { state: string } };
  stamp: string;
  storeRoot: string;
  /** Frames in which the camera was inside the mountains and MapLibre lifted it: linked layers drift there. */
  cameraLifted: number;
  /** The map's old length in seconds, when the scene had been made longer and the map grew to reach its end. */
  grewFrom?: number;
  /** Street detail on demand (D101): what the frames needed, what was fetched, and the frames that lack some. */
  streetDetail?: StreetDetailReport;
};

export type StreetDetailReport = {
  /** OpenStreetMap tiles the frames draw past what is installed. */
  tiles: number;
  /** Tiles fetched for this render (before it, and while MapLibre asked), and their bytes. */
  fetched: number;
  bytes: number;
  /** Frames (0-based) drawn without their detail, with what the computer holds, and those frames in words. */
  lacking: number[];
  /** Those of them that still show the world's detail kept on this computer (only their streets lack). */
  worldOnly: number[];
  lackingText: string | null;
  /** Why they lack it: "offline", "off" (About), or what went wrong. */
  why: string | null;
  /** Tiles MapLibre asked for that the plan had not foreseen and that could not be had. */
  unforeseen: number;
};

/** The map of a render is gone: the project was closed, or the map layer was deleted. */
export const MAP_GONE = "The map this render belongs to is not in the project that is open now";

export class RenderCancelled extends Error {
  constructor() {
    super("render cancelled");
    this.name = "RenderCancelled";
  }
}

export type RenderInfo = {
  mapCompName: string;
  width: number;
  height: number;
  frameRate: number;
  frames: number;
  shutterAngle: number;
  shutterPhase: number;
  animated: boolean;
  projection: MapProjection;
  animations: string[];
  projectFolder: string | null;
  projectFile: string | null;
};

const OSM_CREDIT = "© OpenStreetMap contributors";
const BOUNDARIES_CREDIT = "Boundaries: geoBoundaries";

function archivesOf(basemap: BasemapSource): string[] {
  const world = installedWorld();
  return [naturalEarthArchivePath(), ...(world ? [world.file] : []), ...regionNames(basemap).map((name) => regionArchivePath(name))];
}

/** The sources of a style that read tiles on demand, with the zooms their layers show at (D101). */
export function onDemandSources(style: StyleSpecification): DetailSource[] {
  const out: DetailSource[] = [];
  for (const [id, source] of Object.entries(style.sources)) {
    const tiles = (source as { tiles?: string[]; maxzoom?: number }).tiles;
    if (!tiles?.[0]?.startsWith(`${OSM_PROTOCOL}://`)) continue;
    const zooms = sourceZooms(style.layers as { source?: unknown; minzoom?: number; maxzoom?: number }[], id);
    if (zooms) out.push({ id, ...zooms, maxZoom: (source as { maxzoom?: number }).maxzoom ?? 14 });
  }
  return out;
}

function dataFingerprint(basemap: BasemapSource, terrain: TerrainSetting | null, own: OwnImagery | null): string {
  const files = [...archivesOf(basemap), ...(terrain ? [terrainArchivePath(terrain.pack)] : [])].map((file) => {
    const stat = fs().statSync(file);
    return { file: file.toLowerCase(), size: stat.size, modified: Math.round(stat.mtimeMs) };
  });
  // Imagery from a folder or an MBTiles file on this computer: a changed source draws again (D103).
  const local = own && localPathOf(own.url) ? localStamp(own.url) : null;
  return keyOf(local === null ? files : [...files, { own: local }]);
}

function toView(a: number[], animations: string[]): AnimatedView {
  const view: AnimatedView = { center: { lat: a[0], lng: a[1] }, zoom: a[2], bearing: a[3], pitch: a[4] };
  if (animations.length) view.animation = Object.fromEntries(animations.map((key, i) => [key, a[5 + i]]));
  return view;
}

export async function readCameras(mapId: string, info: RenderInfo, offsets: number[], signal: AbortSignal | undefined, progress: (done: number) => void): Promise<AnimatedView[][]> {
  if (!info.animated) {
    const one = await callHost<{ views: number[][][] }>("sampleViews", { mapId, firstFrame: 0, lastFrame: 0, offsets: [0], compact: true });
    const view = toView(one.views[0][0], info.animations);
    return Array.from({ length: info.frames }, () => [view]);
  }
  const perCall = Math.max(1, Math.floor(1500 / offsets.length));
  const views: AnimatedView[][] = [];
  for (let first = 0; first < info.frames; first += perCall) {
    if (signal?.aborted) throw new RenderCancelled();
    const last = Math.min(info.frames - 1, first + perCall - 1);
    const chunk = await callHost<{ views: number[][][] }>("sampleViews", { mapId, firstFrame: first, lastFrame: last, offsets, compact: true });
    for (const samples of chunk.views) views.push(samples.map((sample) => toView(sample, info.animations)));
    progress(views.length);
  }
  return views;
}

export async function runRenderJob(spec: RenderJobSpec, options: { signal?: AbortSignal; onProgress?: (p: RenderProgress) => void } = {}): Promise<RenderJobResult> {
  const { signal } = options;
  const started = performance.now();
  const settings = spec.settings;
  const reportProgress = (p: RenderProgress) => options.onProgress?.(p);

  const missing = archivesOf(spec.basemap).filter((file) => !fs().existsSync(file));
  if (missing.length) throw new Error(`basemap data is missing: ${missing.join(", ")}`);
  // A scene made longer after its map: the map grows to its end first, so those seconds render too.
  const fitted = await callHost<{ grown: boolean; from?: number }>("fitMapToScene", { mapId: spec.mapId });
  const info = await callHost<RenderInfo>("renderInfo", { mapId: spec.mapId });
  const offsets = sampleOffsets(settings, { angle: info.shutterAngle, phase: info.shutterPhase });
  reportProgress({ stage: "camera", done: 0, total: info.frames, rendered: 0, reused: 0 });
  const cameras = await readCameras(spec.mapId, info, offsets, signal, (done) => reportProgress({ stage: "camera", done, total: info.frames, rendered: 0, reused: 0 }));

  // A pack that is not on this computer renders flat rather than failing the job. With keyed terrain
  // sliders the style needs the terrain as soon as any frame lifts the ground.
  let terrain = terrainUsable(normaliseTerrain(spec.terrain)) ? normaliseTerrain(spec.terrain) : null;
  if (terrain && cameras.some((samples) => samples.some((v) => (v.animation?.terrainHeight ?? 0) > 0))) terrain = { ...terrain, height: Math.max(terrain.height, 0.01) };
  // The History Year slider decides the years: every year of the pack it passes through is drawn, and
  // the renderer cross-fades between them per frame.
  const history = normaliseHistory(spec.history);
  let historyYears: number[] | undefined;
  if (history && info.animations.includes("historyYear")) {
    const values = cameras.flatMap((samples) => samples.map((view) => view.animation?.historyYear)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const pack = historyManifest()?.years.map((y) => y.year) ?? [];
    if (values.length && pack.length) historyYears = yearsForRange(pack, values.reduce((a, b) => Math.min(a, b)), values.reduce((a, b) => Math.max(a, b)));
  }
  const styleWith = (onDemand: boolean, streets = true) => applyLookDetails(basemapStyle(spec.basemap, { labels: settings.labels, markers: spec.markers, projection: info.projection, animations: info.animations, viewport: { width: info.width, height: info.height }, theme: spec.theme, relief: spec.relief, highlights: normaliseHighlights(spec.highlights), areas: normaliseAreas(spec.areas, normaliseHighlights(spec.highlights)), data: normaliseDataFill(spec.dataFill), heat: normaliseHeat(spec.heat), own: normaliseOwnImagery(spec.own), sky: spec.sky, terrain, history, historyYears, onDemand, streets }), normaliseDetails(spec.lookDetails));
  // Street detail on demand (D101): core lists the tiles every frame draws past what is installed, the
  // missing ones are fetched, and a frame that still lacks any draws with what this computer holds:
  // the world's detail without the streets when that is here, else only what is installed.
  const style = styleWith(spec.streetDetail !== false);
  const detailSources = onDemandSources(style);
  let needs: string[][] = [];
  let worldNeeds: string[][] = [];
  let levels: DetailLevel[] = [];
  let report: StreetDetailReport | undefined;
  const levelStyles: Record<DetailLevel, StyleSpecification | null> = { full: style, world: null, installed: null };
  if (detailSources.length) {
    const terrainOf = (view: AnimatedView) => (terrain ? (view.animation?.groundLevel ?? terrain.ground) * (view.animation?.terrainHeight ?? terrain.height) : 0);
    const needsOf = (sources: DetailSource[]) => framesNeeds(cameras, { width: info.width, height: info.height }, sources, { projection: info.projection, terrain: !!terrain && terrain.height > 0, elevationOf: terrainOf });
    worldNeeds = needsOf(detailSources.filter((s) => s.id !== STREETS_SOURCE));
    const streetNeeds = needsOf(detailSources.filter((s) => s.id === STREETS_SOURCE));
    needs = worldNeeds.map((keys, frame) => [...new Set([...keys, ...streetNeeds[frame]])].sort());
    const all = allNeeds(needs);
    const missing = all.filter((key) => !hasOsmTile(key));
    report = { tiles: all.length, fetched: 0, bytes: 0, lacking: [], worldOnly: [], lackingText: null, why: null, unforeseen: 0 };
    if (missing.length) {
      // A render is asked for, so it tries the connection even if a request failed a moment ago.
      if (!streetDetailAllowed()) report.why = "off";
      else {
        reportProgress({ stage: "detail", done: 0, total: 1, rendered: 0, reused: 0 });
        try {
          const fetched = await fetchOsmTiles(missing, { signal, onProgress: (done, total) => reportProgress({ stage: "detail", done, total, rendered: 0, reused: 0 }) });
          report.fetched = fetched.fetched;
          report.bytes = fetched.bytes;
        } catch (error) {
          if (signal?.aborted) throw new RenderCancelled();
          report.why = isOfflineError(error) ? "offline" : error instanceof Error ? error.message : String(error);
        }
      }
    }
    levels = detailLevels(worldNeeds, streetNeeds, hasOsmTile);
    if (levels.includes("world")) {
      // With the full pack installed the world without streets is just what is installed.
      const worldStyle = styleWith(true, false);
      if (onDemandSources(worldStyle).length) levelStyles.world = worldStyle;
      else levels = levels.map((level) => (level === "world" ? "installed" : level));
    }
    if (levels.includes("installed")) levelStyles.installed = styleWith(false);
    report.lacking = levels.flatMap((level, frame) => (level === "full" ? [] : [frame]));
    report.worldOnly = levels.flatMap((level, frame) => (level === "world" ? [frame] : []));
    if (report.lacking.length) {
      report.lackingText = describeFrames(report.lacking, info.frameRate);
      report.why ??= "missing";
    }
  }
  const levelOf = (frame: number): DetailLevel => levels[frame] ?? "full";
  const hasBuildings = style.layers.some((l) => layerGroup(l) === "buildings");
  const hasImagery = style.layers.some((l) => layerGroup(l) === "imagery");
  // A fully opaque background makes the base pass opaque; flattening it keeps files RGB and small.
  // On the globe, space around the planet is transparent.
  const opaqueBackground = info.projection !== "globe" && style.layers.some(
    (l) => l.type === "background" && (l.paint?.["background-opacity"] ?? 1) === 1 && !(l.layout?.visibility === "none") && !l.minzoom && !l.maxzoom
  );
  // Without a sky, what lies above the horizon of a tilted view is transparent, so the base pass keeps its alpha.
  const horizonMayShow = spec.sky === false && cameras.some((samples) => samples.some((view) => view.pitch > 55));
  const opaquePasses: PassId[] = opaqueBackground && !horizonMayShow ? ["base"] : [];
  // Highlight passes follow the map's highlights: present while there are any, dropped when not. In
  // style order (countries, then areas), which is also their stacking order in After Effects.
  const highlightLayers = style.layers.filter((l) => layerGroup(l) === "highlight");
  const shown = normaliseHighlights(spec.highlights);
  const highlightPasses: { pass: HighlightPassId; label: string; layers: typeof highlightLayers; codes: string[] }[] = [];
  if (spec.highlightLayers === "one") {
    if (highlightLayers.length) highlightPasses.push({ pass: HIGHLIGHT_PASS, label: PASS_INFO.highlight.label, layers: highlightLayers, codes: shown.map((h) => h.code) });
  } else {
    for (const layer of highlightLayers) {
      const code = layerHighlight(layer);
      if (!code) continue;
      const pass = highlightPassId(code);
      const entry = highlightPasses.find((p) => p.pass === pass);
      if (entry) entry.layers.push(layer);
      else highlightPasses.push({ pass, label: code === DATA_CODE ? `Data: ${normaliseDataFill(spec.dataFill)?.column ?? "values"}` : code === HEAT_CODE ? `Heat: ${normaliseHeat(spec.heat)?.column ?? "points"}` : `Highlight: ${shown.find((h) => h.code === code)?.name ?? code}`, layers: [layer], codes: [code] });
    }
  }
  // A terrain pass without an elevation pack would be an empty layer: it is left out instead.
  const hasTerrain = style.layers.some((l) => layerGroup(l) === "terrain");
  const passes: PassId[] = [...settings.passes.filter((p) => !isHighlightPass(p) && (p !== "terrain" || hasTerrain)), ...highlightPasses.map((p) => p.pass)];
  const geometry = outputGeometry({ width: info.width, height: info.height }, settings.scale, settings.supersample);
  // Highlights are left out of the base pass, so changing them must not redraw it: a highlight pass
  // is keyed by its own layers and areas (one highlight changes, one pass redraws), every other pass
  // by the style without them.
  const highlightStyleKeys = new Map<PassId, string>();
  for (const entry of highlightPasses) {
    const ownAreas = Object.fromEntries(Object.entries(spec.areas ?? {}).filter(([id]) => entry.codes.includes(`area:${id}`)));
    // Layer ids count the highlights, so they change when another highlight is removed: left out of the key.
    highlightStyleKeys.set(entry.pass, keyOf({ projection: style.projection, layers: entry.layers.map((layer) => ({ ...layer, id: "" })), areas: ownAreas, heat: entry.codes.includes(HEAT_CODE) ? normaliseHeat(spec.heat) : null }));
  }
  const labelOf = (pass: PassId) => highlightPasses.find((p) => p.pass === pass)?.label ?? PASS_INFO[pass as keyof typeof PASS_INFO].label;
  // Without the highlights' layers, the polygons of highlighted areas, the provinces a data fill
  // colours and the points of a heat map, which only the highlight passes draw.
  const styleKey = (s: StyleSpecification) => keyOf({ ...s, sources: Object.fromEntries(Object.entries(s.sources).filter(([id]) => id !== AREAS_SOURCE && id !== DATA_SOURCE && id !== HEAT_SOURCE)), layers: s.layers.filter((l) => layerGroup(l) !== "highlight") });
  const context: FrameKeyContext = {
    style: styleKey(style),
    data: dataFingerprint(spec.basemap, terrain, normaliseOwnImagery(spec.own)),
    width: geometry.width,
    height: geometry.height,
    supersample: geometry.supersample,
    labels: settings.labels
  };
  // A frame drawn with street detail is keyed by the tiles it draws and where each was read from, so the
  // frames that lacked a tile are drawn again once it is here, and only those.
  const sourceOf = new Map<string, string | null>();
  const levelContexts: Record<DetailLevel, FrameKeyContext | null> = {
    full: context,
    world: levelStyles.world ? { ...context, style: styleKey(levelStyles.world) } : null,
    installed: levelStyles.installed ? { ...context, style: styleKey(levelStyles.installed) } : null
  };
  const contextOf = (frame: number): FrameKeyContext => {
    const level = levelOf(frame);
    const base = levelContexts[level]!;
    const keys = level === "full" ? needs[frame] : level === "world" ? worldNeeds[frame] : [];
    if (!keys?.length) return base;
    const tiles = keys.map((key) => {
      if (!sourceOf.has(key)) sourceOf.set(key, tileSource(key));
      return `${key}=${sourceOf.get(key)}`;
    });
    return { ...base, data: keyOf({ data: context.data, tiles }) };
  };
  // The camera animation alone: equal stamps mean a preview and a final show the same move.
  const stamp = keyOf({ fps: info.frameRate, cameras: cameras.map((c) => [c[0].center.lat, c[0].center.lng, c[0].zoom, c[0].bearing, c[0].pitch]) });
  const store = RenderStore.forMap(spec.mapId, info.mapCompName, info.projectFolder);
  // Renders of a project that has been saved are never orphans, wherever they sit (renderDisk.ts).
  store.claimFor(info.projectFile ?? null);

  // Plan: the pass images each frame still needs. Frames sharing a key share one render.
  reportProgress({ stage: "planning", done: 0, total: info.frames, rendered: 0, reused: 0 });
  const keys: Record<string, string>[] = [];
  const scheduled = new Set<string>();
  const work: { frame: number; passes: PassId[] }[] = [];
  let reused = 0;
  for (let frame = 0; frame < info.frames; frame++) {
    const timeMs = (frame * 1000) / info.frameRate;
    const frameKeys: Record<string, string> = {};
    const missing: PassId[] = [];
    const frameContext = contextOf(frame);
    for (const pass of passes) {
      const ownStyle = highlightStyleKeys.get(pass);
      const key = frameKey(ownStyle ? { ...frameContext, style: ownStyle } : frameContext, pass, cameras[frame], timeMs);
      frameKeys[pass] = key;
      const id = `${pass}:${key}`;
      if (!scheduled.has(id) && !store.has(pass, key)) {
        scheduled.add(id);
        missing.push(pass);
      }
    }
    keys.push(frameKeys);
    if (missing.length) work.push({ frame, passes: missing });
    else reused++;
  }

  let rendered = 0;
  let renderMs = 0;
  let cameraLifted = 0;
  // What MapLibre asks for from here on is counted: tiles the plan had not foreseen.
  takeOsmMisses();
  // Frames with their detail first, then those drawn with what this computer holds, each level with its own map.
  for (const level of ["full", "world", "installed"] as const) {
    const group = work.filter((item) => levelOf(item.frame) === level);
    if (!group.length) continue;
    const pool = sharedEncodePool();
    const renderer = new FrameRenderer({
      width: info.width,
      height: info.height,
      pixelRatio: geometry.pixelRatio,
      supersample: geometry.supersample,
      style: levelStyles[level]!,
      antialias: geometry.canvasWidth * geometry.canvasHeight <= 40_000_000,
      terrain: terrain ? { ground: terrain.ground, height: terrain.height } : undefined
    });
    const writes: Promise<void>[] = [];
    let writeError: Error | null = null;
    const renderStarted = performance.now();
    try {
      await renderer.init();
      for (const item of group) {
        if (signal?.aborted || writeError) break;
        const renders = rendersFor(item.passes, hasBuildings, hasImagery);
        const samples = isStill(cameras[item.frame]) ? [cameras[item.frame][0]] : cameras[item.frame];
        const timeMs = (item.frame * 1000) / info.frameRate;
        const images: Partial<Record<RenderId, Uint8Array>> = {};
        if (samples.length === 1) {
          await renderer.setView(samples[0], timeMs);
          for (const render of renders) images[render] = renderer.draw(render, settings.labels).pixels;
        } else {
          const sums: Partial<Record<RenderId, SampleAccumulator>> = {};
          for (let s = 0; s < samples.length; s++) {
            await renderer.setView(samples[s], timeMs + (offsets[s] * 1000) / info.frameRate);
            for (const render of renders) {
              const pixels = renderer.draw(render, settings.labels).pixels;
              (sums[render] ??= new SampleAccumulator(pixels.length)).add(pixels);
            }
          }
          for (const render of renders) images[render] = sums[render]!.mean();
        }
        await pool.whenReady();
        const frameKeys = keys[item.frame];
        writes.push(
          pool.encode(geometry.width, geometry.height, images, item.passes, opaquePasses).then(
            (pngs) => {
              for (const pass of item.passes) store.write(pass, frameKeys[pass], pngs[pass]!);
            },
            (error: Error) => {
              writeError = error;
            }
          )
        );
        rendered++;
        reportProgress({ stage: "rendering", done: rendered + reused, total: info.frames, rendered, reused });
      }
      await Promise.all(writes);
    } finally {
      cameraLifted += renderer.cameraLifted;
      renderer.destroy();
    }
    renderMs += performance.now() - renderStarted;
    if (writeError) throw writeError;
    if (signal?.aborted) throw new RenderCancelled();
  }
  reused = info.frames - rendered;
  // Every tile the plan listed for the frames drawn through lmlosm:// was here: what is missing now was
  // not foreseen.
  const unforeseen = takeOsmMisses();
  if (report) {
    report.fetched += unforeseen.fetched;
    report.unforeseen = unforeseen.missing.length;
  }

  reportProgress({ stage: "importing", done: info.frames, total: info.frames, rendered, reused });
  const sequences = passes.map((pass) => ({
    pass,
    ...store.createSequence(
      pass,
      spec.quality,
      keys.map((k, frame) => ({ frame, key: k[pass] }))
    )
  }));
  const imported = await callHostWithJobFile<RenderJobResult["imported"]>("importPasses", {
    mapId: spec.mapId,
    quality: spec.quality,
    stamp,
    sequences: sequences.map((s) => ({ pass: s.pass, label: labelOf(s.pass), kind: isHighlightPass(s.pass) ? "highlight" : PASS_INFO[s.pass as keyof typeof PASS_INFO].kind, firstFramePath: s.firstFramePath })),
    // The offline world is OpenStreetMap data too, once a frame comes close enough for it to show.
    attribution: [regionNames(spec.basemap).length || spec.osmData || ((installedWorld() || detailSources.length) && cameras.some((samples) => samples.some((v) => v.zoom >= WORLD_DETAIL_FADE.from - 1))) ? OSM_CREDIT : "", shown.some((h) => h.code.startsWith(`area:${BOUNDARY_ID_PREFIX}`)) ? BOUNDARIES_CREDIT : "", terrain ? TERRAIN_CREDIT : "", (history && hasHistoryPack()) || shown.some((h) => h.code.startsWith(`area:${HISTORY_ID_PREFIX}`)) ? HISTORY_CREDIT : "", normaliseOwnImagery(spec.own)?.attribution ?? ""].filter(Boolean).join(" · ") || null,
    // Highlight layers of an earlier render that the map no longer has go away.
    highlightPasses: highlightPasses.map((p) => p.pass)
  });

  // Old sequence folders: keep the newest two per pass (Undo), and anything After Effects still uses -
  // by any map, since a copied map shows its original's frames until it is rendered itself.
  try {
    const inUse = await callHost<string[]>("footageInUse");
    for (const pass of passes) store.pruneSequences(pass, spec.quality, 2, inUse);
    store.pruneStaleHighlights(passes, inUse);
  } catch {
    // Pruning is housekeeping; never fail a finished render over it.
  }

  return {
    frames: info.frames,
    rendered,
    reused,
    msPerRenderedFrame: rendered ? renderMs / rendered : 0,
    totalMs: performance.now() - started,
    geometry,
    samples: offsets.length,
    passes,
    sequences,
    imported,
    stamp,
    storeRoot: store.root,
    cameraLifted,
    ...(fitted.grown ? { grewFrom: fitted.from } : {}),
    ...(report ? { streetDetail: report } : {})
  };
}
