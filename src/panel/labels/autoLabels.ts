// Auto labels: country and city names from Natural Earth in the local language (with an English
// subtitle), placed over the whole timeline of a map and built as After Effects text layers.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { labelText, scriptOf, SCRIPT_FONTS, type LabelLanguageMode, type LabelNames, type Script } from "../../core/labels/language.ts";
import { zoneBoxes, zonesOnFrame, type KeepOutZone } from "../../core/labels/keepOut.ts";
import { resolveLabelTemplate, templateFonts, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { opacityKeys, placeLabels, type Box, type LabelCandidate } from "../../core/labels/placement.ts";
import { projectPoint } from "../../core/camera/globe.ts";
import { hexToRgb, themeById } from "../../core/style/themes.ts";
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
  /** Most label layers to create (lowest priority dropped first). */
  maxLabels?: number;
  /** The map's look: labels take their colours from it (light text on dark maps, dark on light ones). */
  theme?: string | null;
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

type TextStyle = { size: number; color: number[]; haloColor: number[]; haloWidth: number; fonts: string[]; tracking: number; rtl: boolean };

const RTL: Script[] = ["arabic", "hebrew"];
const UPPERCASE: Script[] = ["latin", "cyrillic", "greek"];

const loadRecords = () => loadWorldLabels() as { countries: LabelRecord[]; places: LabelRecord[] };

let measureContext: CanvasRenderingContext2D | null = null;

export function measure(text: string, script: Script, size: number, weight: number, tracking: number): number {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  const family = SCRIPT_FONTS[script].css
    .split(",")
    .map((name) => `"${name.trim()}"`)
    .join(", ");
  measureContext!.font = `${weight} ${size}px ${family}`;
  // After Effects tracking is in thousandths of an em per character.
  return measureContext!.measureText(text).width + (tracking / 1000) * size * [...text].length;
}

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
  const theme = themeById(options.theme);
  const template = options.template ?? resolveLabelTemplate(theme);
  const colors = {
    place: hexToRgb(template.color),
    country: hexToRgb(template.countryColor),
    halo: hexToRgb(template.haloColor),
    subtitle: hexToRgb(template.subtitleColor)
  };
  const lowestZoom = Math.min(...cameras.map((c) => c.zoom));
  const highestZoom = Math.max(...cameras.map((c) => c.zoom));

  type Prepared = { candidate: LabelCandidate; record: LabelRecord; text: string; subtitle: string | null; main: TextStyle; sub: TextStyle; mainDy: number; subDy: number; dx: number };
  const prepared: Prepared[] = [];
  const add = (record: LabelRecord) => {
    const isCountry = record.kind === "country";
    // Natural Earth zooms count 256-pixel tiles; MapLibre zooms count 512-pixel tiles.
    const minZoom = Math.max(0, record.minZoom - 1);
    const maxZoom = isCountry ? Math.max(minZoom + 2, (record.maxZoom ?? 8) - 1) : placeMaxZoom;
    if (minZoom > highestZoom || maxZoom < lowestZoom) return;
    const { text: raw, subtitle } = labelText(record.names, record.country, record.region, language, english);
    if (!raw) return;
    const script = scriptOf(raw);
    const caps = template.caps && isCountry && UPPERCASE.includes(script);
    const text = caps ? raw.toLocaleUpperCase() : raw;
    const size = Math.round((isCountry ? template.countrySize : template.size) * scale);
    const tracking = caps ? 160 : 0;
    const main: TextStyle = {
      size,
      color: isCountry ? colors.country : colors.place,
      haloColor: colors.halo,
      haloWidth: template.halo > 0 ? Math.max(1, Math.round(template.halo * scale)) : 0,
      fonts: templateFonts(template, SCRIPT_FONTS[script].bold, script),
      tracking,
      rtl: RTL.includes(script)
    };
    const subScript = subtitle ? scriptOf(subtitle) : "latin";
    const sub: TextStyle = { ...main, size: Math.round(size * 0.62), color: colors.subtitle, fonts: templateFonts(template, SCRIPT_FONTS[subScript].regular, subScript), tracking: 20, rtl: RTL.includes(subScript) };
    const mainWidth = measure(text, script, size, 600, tracking);
    const subWidth = subtitle ? measure(subtitle, subScript, sub.size, 400, sub.tracking) : 0;
    const width = Math.max(mainWidth, subWidth) + main.haloWidth * 2;
    const gap = size * 0.18;
    const height = size * 1.1 + (subtitle ? gap + sub.size * 1.1 : 0);
    // Baselines inside a block centred on the anchor.
    const top = -height / 2;
    const mainDy = top + size * 0.85;
    const subDy = top + size * 1.1 + gap + sub.size * 0.85;
    const offset = Math.round(10 * scale);
    const candidate: LabelCandidate = {
      id: record.id,
      lat: record.lat,
      lng: record.lng,
      priority: isCountry ? record.rank * 10 + 5 : record.rank * 10 - (record.capital ? 4 : 0) - Math.min(3, Math.log10(record.population + 1) / 3),
      width,
      height,
      anchor: isCountry ? "center" : "right",
      offset,
      markerRadius: isCountry || !template.dots ? 0 : 5 * scale,
      minZoom,
      maxZoom
    };
    prepared.push({ candidate, record, text, subtitle, main, sub, mainDy, subDy, dx: isCountry ? 0 : offset + width / 2 });
  };
  if (options.countries ?? true) data.countries.forEach(add);
  if (options.places ?? true) data.places.forEach(add);

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
    const peak = record.kind === "country" ? 85 : 100;
    const keys = opacityKeys(track, fade).map(([frame, value]) => [frame, (value * peak) / 100]);
    return {
      id: record.id,
      name: record.names.en ?? label.text,
      text: label.text,
      subtitle: label.subtitle,
      keys,
      dot: record.kind === "place" && template.dots,
      main: label.main,
      sub: label.sub,
      dotStyle: { radius: 4.5 * scale, color: colors.place, strokeColor: colors.halo, strokeWidth: 2 * scale },
      expressions: {
        main: anchoredPositionExpression(record.lat, record.lng, label.dx, label.mainDy, undefined, elevation),
        sub: label.subtitle ? anchoredPositionExpression(record.lat, record.lng, label.dx, label.subDy, undefined, elevation) : null,
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
