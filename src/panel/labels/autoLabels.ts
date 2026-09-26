// Auto labels: the names of countries, cities and the natural world (oceans and seas, rivers and
// lakes, ranges, deserts, islands, peaks) from Natural Earth, in the local language with an English
// subtitle, placed over the whole timeline of a map and built as After Effects text layers.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { labelText, type LabelLanguageMode, type LabelNames } from "../../core/labels/language.ts";
import { zoneBoxes, zonesOnFrame, type KeepOutZone } from "../../core/labels/keepOut.ts";
import { resolveLabelTemplate, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { dotStyle } from "../../core/labels/restyle.ts";
import { formatElevation, NATURE_STYLES, natureGroup } from "../../core/labels/nature.ts";
import { labelStrength, measureLabel, zoomBand, type MeasuredLabel } from "./candidate.ts";
import { designValues, type LabelDesign } from "./labelDesigns.ts";
import { opacityKeys, placeLabels, type Box } from "../../core/labels/placement.ts";
import { projectPoint } from "../../core/camera/globe.ts";
import { themeFrom, type ThemeLike } from "../../core/style/themes.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";
import { loadWorldLabels, type WorldLabel } from "../data/worldLabels.ts";
import { readCameras, type RenderInfo } from "../render/renderJob.ts";

type LabelRecord = WorldLabel & { names: LabelNames };

export type AutoLabelOptions = {
  language?: LabelLanguageMode;
  english?: boolean;
  countries?: boolean;
  places?: boolean;
  /** Oceans, seas, rivers, lakes and waterfalls. */
  water?: boolean;
  /** Continents, mountain ranges, deserts, islands, regions and peaks. */
  land?: boolean;
  /** Most label layers to create (lowest priority dropped first). */
  maxLabels?: number;
  /** The map's look: labels take their colours from it (light text on dark maps, dark on light ones). */
  theme?: ThemeLike;
  /** Called after every batch of labels built in After Effects. */
  onProgress?: (done: number, total: number) => void;
  /** Stops after the batch in progress; the labels built so far stay. */
  signal?: AbortSignal;
  /** Place labels fade away above this zoom, where the map shows the city itself. */
  placeMaxZoom?: number;
  /** The map's terrain: labels made with an elevation pack sit on the ground of 3D terrain. */
  terrain?: TerrainSetting | null;
  /** How the names look; without one they follow the map's look. */
  template?: LabelTemplate;
  /** A comp of the user's own, put on every place instead of a plain name. */
  design?: LabelDesign | null;
  /**
   * Areas labels must avoid, such as pins and callouts: a box relative to a place (map comp pixels),
   * between two frames.
   */
  keepOut?: { lat: number; lng: number; fromFrame: number; toFrame: number; dx: number; dy: number; width: number; height: number }[];
  /** Parts of the frame names must stay out of, such as the band a lower third sits in. */
  zones?: KeepOutZone[];
};

export type AutoLabelResult = {
  candidates: number;
  labels: number;
  layers: number;
  removed: number;
  expressionErrors: string[];
  seconds: number;
  timings: Record<string, number>;
  hostTimings: Record<string, number>;
  /** Labels the placement chose; fewer were built when the build was cancelled. */
  planned: number;
  cancelled: boolean;
  /** The longest single call into After Effects, in milliseconds (how long it was busy at most). */
  longestCallMs: number;
};

/** Labels per call into After Effects: small enough that it never blocks for more than a second or two. */
export const LABEL_BATCH = 8;


const loadRecords = () => loadWorldLabels() as { countries: LabelRecord[]; places: LabelRecord[]; nature: LabelRecord[] };

// Kept here as well, where the label tests have always found it.
export { measure } from "./measure.ts";

export async function autoLabels(mapId: string, options: AutoLabelOptions = {}): Promise<AutoLabelResult> {
  const started = performance.now();
  const info = await callHost<RenderInfo>("renderInfo", { mapId });
  const timings: Record<string, number> = {};
  let mark = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = Math.round(now - mark);
    mark = now;
  };
  const cameras = (await readCameras(mapId, info, [0], undefined, () => undefined)).map((samples) => samples[0]);
  lap("cameras");
  const data = loadRecords();
  const scale = info.height / 1080;
  const language = options.language ?? { kind: "local" };
  const english = options.english ?? true;
  const placeMaxZoom = options.placeMaxZoom ?? 10;
  const theme = themeFrom(options.theme);
  const template = options.template ?? resolveLabelTemplate(theme);
  const lowestZoom = Math.min(...cameras.map((c) => c.zoom));
  const highestZoom = Math.max(...cameras.map((c) => c.zoom));

  const design = options.design ?? null;
  type Prepared = MeasuredLabel & { record: LabelRecord; raw: string; subtitle: string | null };
  const prepared: Prepared[] = [];
  const add = (record: LabelRecord) => {
    const band = zoomBand(record, record.id, placeMaxZoom);
    if (band.minZoom > highestZoom || band.maxZoom < lowestZoom) return;
    const named = labelText(record.names, record.country, record.region, language, english);
    const raw = named.text;
    if (!raw) return;
    const nature = record.kind === "nature" && record.nature ? record.nature : null;
    // A peak says how high it is under its name, after its English name when that line is asked for.
    const subtitle = nature === "peak" && record.elevation ? [named.subtitle, formatElevation(record.elevation)].filter(Boolean).join(" · ") : named.subtitle;
    const measured = measureLabel({ record, labelId: record.id, raw, subtitle, template, scale, design: design ? { width: design.width, height: design.height } : null, dot: template.dots, placeMaxZoom });
    prepared.push({ ...measured, record, raw, subtitle });
  };
  if (options.countries ?? true) data.countries.forEach(add);
  if (options.places ?? true) data.places.forEach(add);
  const water = options.water ?? true;
  const land = options.land ?? true;
  for (const record of data.nature ?? []) {
    if (!record.nature) continue;
    const group = natureGroup(record.nature);
    if ((group === "water" && water) || (group === "land" && land)) add(record);
  }

  lap("prepare");
  const frameZones = zoneBoxes(options.zones ?? [], { width: info.width, height: info.height }, info.frameRate, cameras.length);
  const tracks = placeLabels(
    prepared.map((p) => p.candidate),
    cameras,
    {
      viewport: { width: info.width, height: info.height },
      projection: info.projection,
      margin: 24 * scale,
      padding: 6 * scale,
      minFrames: Math.round(info.frameRate * 0.8),
      keepOut: (frame) => {
        const boxes: Box[] = zonesOnFrame(frameZones, frame).slice();
        for (const area of options.keepOut ?? []) {
          if (frame < area.fromFrame || frame >= area.toFrame) continue;
          const p = projectPoint(cameras[frame], { width: info.width, height: info.height }, area, { projection: info.projection });
          if (p.visible) boxes.push({ x: p.x + area.dx, y: p.y + area.dy, width: area.width, height: area.height });
        }
        return boxes;
      }
    }
  );
  lap("place");
  const byId = new Map(prepared.map((p) => [p.record.id, p]));
  const kept = tracks
    .map((track) => ({ track, label: byId.get(track.id)! }))
    .sort((a, b) => a.label.candidate.priority - b.label.candidate.priority)
    .slice(0, options.maxLabels ?? 150);
  const fade = Math.round(info.frameRate * 0.4);

  const sampler = samplerFor(options.terrain);
  const elevations = sampler ? await sampler.elevations(kept.map(({ label }) => label.record)) : kept.map(() => 0);
  sampler?.close();
  lap("elevation");
  const labels = kept.map(({ track, label }, index) => {
    const { record } = label;
    const elevation = elevations[index];
    const nature = record.kind === "nature" && record.nature ? record.nature : null;
    const designed = nature ? null : design;
    const strength = labelStrength(record.id);
    const keys = opacityKeys(track, fade, cameras.length).map(([frame, value]) => [frame, (value * strength) / 100]);
    return {
      id: record.id,
      name: record.names.en ?? label.text,
      text: label.text,
      raw: label.raw,
      subtitle: designed ? null : label.subtitle,
      keys,
      dot: nature ? NATURE_STYLES[nature].marker !== "none" : !designed && record.kind === "place" && template.dots,
      main: label.main,
      sub: label.sub,
      // A design of the user's own: a copy of their comp per place, with its fields filled in.
      design: designed ? { compId: designed.compId, anchorX: designed.anchorX, anchorY: designed.anchorY, width: designed.width, height: designed.height, scale: Math.round(scale * 100), values: designValues(label.record, label.text, label.subtitle) } : null,
      dotStyle: dotStyle(template, scale, nature),
      expressions: {
        main: anchoredPositionExpression(record.lat, record.lng, label.dx, label.mainDy, undefined, elevation),
        sub: label.subtitle && !designed ? anchoredPositionExpression(record.lat, record.lng, label.dx, label.subDy, undefined, elevation) : null,
        dot: anchoredPositionExpression(record.lat, record.lng, 0, 0, undefined, elevation)
      }
    };
  });
  // Built in small batches, so After Effects stays responsive and the build can be cancelled.
  type Batch = { labels: number; layers: number; removed: number; expressionErrors: string[]; timings?: Record<string, number> };
  const total = { labels: 0, layers: 0, removed: 0, expressionErrors: [] as string[], hostTimings: {} as Record<string, number> };
  const batches = Math.max(1, Math.ceil(labels.length / LABEL_BATCH));
  let cancelled = false;
  let longestCallMs = 0;
  try {
    for (let b = 0; b < batches; b++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      const callStarted = performance.now();
      const part = await callHostWithJobFile<Batch>("addLabels", {
        mapId,
        labels: labels.slice(b * LABEL_BATCH, (b + 1) * LABEL_BATCH),
        first: b === 0,
        last: b === batches - 1,
        undoName: batches > 1 ? `Auto labels (${b + 1} of ${batches})` : "Auto labels"
      });
      longestCallMs = Math.max(longestCallMs, performance.now() - callStarted);
      total.labels += part.labels;
      total.layers += part.layers;
      total.removed += part.removed;
      total.expressionErrors.push(...part.expressionErrors);
      for (const [step, ms] of Object.entries(part.timings ?? {})) total.hostTimings[step] = (total.hostTimings[step] ?? 0) + ms;
      options.onProgress?.(total.labels, labels.length);
    }
  } finally {
    // A cancelled or failed build still brings the scene back into the viewer.
    if (cancelled || total.labels < labels.length) await callHost("finishLabels").catch(() => undefined);
  }
  lap("host");
  return { candidates: prepared.length, ...total, planned: labels.length, cancelled, longestCallMs: Math.round(longestCallMs), seconds: (performance.now() - started) / 1000, timings };
}
