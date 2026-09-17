// One render of a map comp: read the camera for every frame and motion blur sample, work out which
// pass images are not in the cache yet, draw only those, encode them in workers, link the sequences
// and import them into After Effects in one undo step.

import type { AnimatedView } from "../../core/render/plan.ts";
import { BOUNDARY_ID_PREFIX } from "../../core/data/boundarySet.ts";
import { keyOf } from "../../core/render/frameKey.ts";
import { HIGHLIGHT_PASS, PASS_INFO, highlightPassId, isHighlightPass, rendersFor, type HighlightPassId, type PassId, type RenderId } from "../../core/render/passes.ts";
import { normaliseAreas, normaliseHighlights, type Areas, type Highlight } from "../../core/style/highlights.ts";
import { SampleAccumulator } from "../../core/render/pixels.ts";
import { frameKey, isStill, outputGeometry, sampleOffsets, type FrameKeyContext, type OutputGeometry, type RenderQuality, type RenderSettings } from "../../core/render/plan.ts";
import { callHost, callHostWithJobFile, fs } from "../cep.ts";
import { naturalEarthArchivePath, regionArchivePath } from "../basemap/maplibreSetup.ts";
import { basemapStyle, regionNames, type BasemapSource, type Marker } from "../basemap/basemapStyle.ts";
import { AREAS_SOURCE } from "../basemap/naturalEarthStyle.ts";
import type { MapProjection } from "../../core/camera/globe.ts";
import { sharedEncodePool } from "./encodePool.ts";
import { FrameRenderer, layerGroup, layerHighlight } from "./frameRenderer.ts";
import { RenderStore } from "./renderStore.ts";

export type { BasemapSource, Marker } from "../basemap/basemapStyle.ts";
export { basemapStyle } from "../basemap/basemapStyle.ts";

export type RenderJobSpec = {
  mapId: string;
  quality: RenderQuality;
  settings: RenderSettings;
  basemap: BasemapSource;
  /** The map's look (core/style/themes.ts) and whether shaded relief lies over the land. */
  theme?: string | null;
  relief?: boolean;
  /** Highlighted countries and areas: rendered as their own passes, which the job adds by itself. */
  highlights?: Highlight[];
  areas?: Areas;
  /** "each" (default): every highlight is its own pass and layer. "one": a single pass holds them all. */
  highlightLayers?: "each" | "one";
  /** Test markers drawn into the base pass as solid circles (radius in comp pixels). */
  markers?: Marker[];
};

export type RenderStage = "camera" | "planning" | "rendering" | "importing";

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
};

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
};

const OSM_CREDIT = "© OpenStreetMap contributors";
const BOUNDARIES_CREDIT = "Boundaries: geoBoundaries";

function archivesOf(basemap: BasemapSource): string[] {
  return [naturalEarthArchivePath(), ...regionNames(basemap).map((name) => regionArchivePath(name))];
}

function dataFingerprint(basemap: BasemapSource): string {
  return keyOf(
    archivesOf(basemap).map((file) => {
      const stat = fs().statSync(file);
      return { file: file.toLowerCase(), size: stat.size, modified: Math.round(stat.mtimeMs) };
    })
  );
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
  const report = (p: RenderProgress) => options.onProgress?.(p);

  const missing = archivesOf(spec.basemap).filter((file) => !fs().existsSync(file));
  if (missing.length) throw new Error(`basemap data is missing: ${missing.join(", ")}`);
  const info = await callHost<RenderInfo>("renderInfo", { mapId: spec.mapId });
  const offsets = sampleOffsets(settings, { angle: info.shutterAngle, phase: info.shutterPhase });
  report({ stage: "camera", done: 0, total: info.frames, rendered: 0, reused: 0 });
  const cameras = await readCameras(spec.mapId, info, offsets, signal, (done) => report({ stage: "camera", done, total: info.frames, rendered: 0, reused: 0 }));

  const style = basemapStyle(spec.basemap, { labels: settings.labels, markers: spec.markers, projection: info.projection, animations: info.animations, viewport: { width: info.width, height: info.height }, theme: spec.theme, relief: spec.relief, highlights: normaliseHighlights(spec.highlights), areas: normaliseAreas(spec.areas, normaliseHighlights(spec.highlights)) });
  const hasBuildings = style.layers.some((l) => layerGroup(l) === "buildings");
  const hasImagery = style.layers.some((l) => layerGroup(l) === "imagery");
  // A fully opaque background makes the base pass opaque; flattening it keeps files RGB and small.
  // On the globe, space around the planet is transparent.
  const opaqueBackground = info.projection !== "globe" && style.layers.some(
    (l) => l.type === "background" && (l.paint?.["background-opacity"] ?? 1) === 1 && !(l.layout?.visibility === "none") && !l.minzoom && !l.maxzoom
  );
  const opaquePasses: PassId[] = opaqueBackground ? ["base"] : [];
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
      else highlightPasses.push({ pass, label: `Highlight: ${shown.find((h) => h.code === code)?.name ?? code}`, layers: [layer], codes: [code] });
    }
  }
  const passes: PassId[] = [...settings.passes.filter((p) => !isHighlightPass(p)), ...highlightPasses.map((p) => p.pass)];
  const geometry = outputGeometry({ width: info.width, height: info.height }, settings.scale, settings.supersample);
  // Highlights are left out of the base pass, so changing them must not redraw it: a highlight pass
  // is keyed by its own layers and areas (one highlight changes, one pass redraws), every other pass
  // by the style without them.
  const highlightStyleKeys = new Map<PassId, string>();
  for (const entry of highlightPasses) {
    const ownAreas = Object.fromEntries(Object.entries(spec.areas ?? {}).filter(([id]) => entry.codes.includes(`area:${id}`)));
    // Layer ids count the highlights, so they change when another highlight is removed: left out of the key.
    highlightStyleKeys.set(entry.pass, keyOf({ projection: style.projection, layers: entry.layers.map((layer) => ({ ...layer, id: "" })), areas: ownAreas }));
  }
  const labelOf = (pass: PassId) => highlightPasses.find((p) => p.pass === pass)?.label ?? PASS_INFO[pass as keyof typeof PASS_INFO].label;
  const context: FrameKeyContext = {
    // Without the highlights' layers and the polygons of highlighted areas, which only they draw.
    style: keyOf({ ...style, sources: Object.fromEntries(Object.entries(style.sources).filter(([id]) => id !== AREAS_SOURCE)), layers: style.layers.filter((l) => layerGroup(l) !== "highlight") }),
    data: dataFingerprint(spec.basemap),
    width: geometry.width,
    height: geometry.height,
    supersample: geometry.supersample,
    labels: settings.labels
  };
  // The camera animation alone: equal stamps mean a preview and a final show the same move.
  const stamp = keyOf({ fps: info.frameRate, cameras: cameras.map((c) => [c[0].center.lat, c[0].center.lng, c[0].zoom, c[0].bearing, c[0].pitch]) });
  const store = RenderStore.forMap(spec.mapId, info.mapCompName, info.projectFolder);

  // Plan: the pass images each frame still needs. Frames sharing a key share one render.
  report({ stage: "planning", done: 0, total: info.frames, rendered: 0, reused: 0 });
  const keys: Record<string, string>[] = [];
  const scheduled = new Set<string>();
  const work: { frame: number; passes: PassId[] }[] = [];
  let reused = 0;
  for (let frame = 0; frame < info.frames; frame++) {
    const timeMs = (frame * 1000) / info.frameRate;
    const frameKeys: Record<string, string> = {};
    const missing: PassId[] = [];
    for (const pass of passes) {
      const ownStyle = highlightStyleKeys.get(pass);
      const key = frameKey(ownStyle ? { ...context, style: ownStyle } : context, pass, cameras[frame], timeMs);
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
  if (work.length) {
    const pool = sharedEncodePool();
    const renderer = new FrameRenderer({
      width: info.width,
      height: info.height,
      pixelRatio: geometry.pixelRatio,
      supersample: geometry.supersample,
      style,
      antialias: geometry.canvasWidth * geometry.canvasHeight <= 40_000_000
    });
    const writes: Promise<void>[] = [];
    let writeError: Error | null = null;
    const renderStarted = performance.now();
    try {
      await renderer.init();
      for (const item of work) {
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
        report({ stage: "rendering", done: rendered + reused, total: info.frames, rendered, reused });
      }
      await Promise.all(writes);
    } finally {
      renderer.destroy();
    }
    renderMs = performance.now() - renderStarted;
    if (writeError) throw writeError;
    if (signal?.aborted) throw new RenderCancelled();
  }
  reused = info.frames - rendered;

  report({ stage: "importing", done: info.frames, total: info.frames, rendered, reused });
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
    attribution: [regionNames(spec.basemap).length ? OSM_CREDIT : "", shown.some((h) => h.code.startsWith(`area:${BOUNDARY_ID_PREFIX}`)) ? BOUNDARIES_CREDIT : ""].filter(Boolean).join(" · ") || null,
    // Highlight layers of an earlier render that the map no longer has go away.
    highlightPasses: highlightPasses.map((p) => p.pass)
  });

  // Old sequence folders: keep the newest two per pass (Undo), and anything After Effects still uses.
  try {
    const listed = await callHost<{ path: string | null; proxyPath: string | null }[]>("listPasses", { mapId: spec.mapId });
    const inUse = listed.flatMap((p) => [p.path, p.proxyPath]).filter((p): p is string => !!p);
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
    storeRoot: store.root
  };
}
