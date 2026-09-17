// Auto labels: country and city names from Natural Earth in the local language (with an English
// subtitle), placed over the whole timeline of a map and built as After Effects text layers.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { labelText, scriptOf, SCRIPT_FONTS, type LabelLanguageMode, type LabelNames, type Script } from "../../core/labels/language.ts";
import { opacityKeys, placeLabels, type Box, type LabelCandidate } from "../../core/labels/placement.ts";
import { projectPoint } from "../../core/camera/globe.ts";
import { callHost, callHostWithJobFile, fs } from "../cep.ts";
import { worldOverlayPath } from "../basemap/basemapStyle.ts";
import { readCameras, type RenderInfo } from "../render/renderJob.ts";

type LabelRecord = {
  id: string;
  kind: "country" | "place";
  lat: number;
  lng: number;
  country: string;
  region?: string;
  capital?: boolean;
  rank: number;
  minZoom: number;
  maxZoom?: number;
  population: number;
  names: LabelNames;
};

export type AutoLabelOptions = {
  language?: LabelLanguageMode;
  english?: boolean;
  countries?: boolean;
  places?: boolean;
  /** Most label layers to create (lowest priority dropped first). */
  maxLabels?: number;
  /** Place labels fade away above this zoom, where the map shows the city itself. */
  placeMaxZoom?: number;
  /**
   * Areas labels must avoid, such as pins and callouts: a box relative to a place (map comp pixels),
   * between two frames.
   */
  keepOut?: { lat: number; lng: number; fromFrame: number; toFrame: number; dx: number; dy: number; width: number; height: number }[];
};

export type AutoLabelResult = { candidates: number; labels: number; layers: number; removed: number; expressionErrors: string[]; seconds: number; timings: Record<string, number> };

type TextStyle = { size: number; color: number[]; haloColor: number[]; haloWidth: number; fonts: string[]; tracking: number; rtl: boolean };

const RTL: Script[] = ["arabic", "hebrew"];
const UPPERCASE: Script[] = ["latin", "cyrillic", "greek"];

let records: { countries: LabelRecord[]; places: LabelRecord[] } | null = null;

function loadRecords() {
  if (!records) records = JSON.parse(fs().readFileSync(worldOverlayPath("labels.json"), "utf8"));
  return records!;
}

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
    const text = isCountry && UPPERCASE.includes(script) ? raw.toLocaleUpperCase() : raw;
    const size = Math.round((isCountry ? 24 : 21) * scale);
    const tracking = isCountry && UPPERCASE.includes(script) ? 160 : 0;
    const main: TextStyle = {
      size,
      color: isCountry ? [0.8, 0.86, 0.92] : [0.97, 0.98, 1],
      haloColor: [0.03, 0.07, 0.11],
      haloWidth: Math.max(2, Math.round(3 * scale)),
      fonts: SCRIPT_FONTS[script].bold,
      tracking,
      rtl: RTL.includes(script)
    };
    const subScript = subtitle ? scriptOf(subtitle) : "latin";
    const sub: TextStyle = { ...main, size: Math.round(size * 0.62), color: [0.7, 0.77, 0.84], fonts: SCRIPT_FONTS[subScript].regular, tracking: 20, rtl: RTL.includes(subScript) };
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
      markerRadius: isCountry ? 0 : 5 * scale,
      minZoom,
      maxZoom
    };
    prepared.push({ candidate, record, text, subtitle, main, sub, mainDy, subDy, dx: isCountry ? 0 : offset + width / 2 });
  };
  if (options.countries ?? true) data.countries.forEach(add);
  if (options.places ?? true) data.places.forEach(add);

  lap("prepare");
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
        const boxes: Box[] = [];
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

  const labels = kept.map(({ track, label }) => {
    const { record } = label;
    const peak = record.kind === "country" ? 85 : 100;
    const keys = opacityKeys(track, fade).map(([frame, value]) => [frame, (value * peak) / 100]);
    return {
      id: record.id,
      name: record.names.en ?? label.text,
      text: label.text,
      subtitle: label.subtitle,
      keys,
      dot: record.kind === "place",
      main: label.main,
      sub: label.sub,
      dotStyle: { radius: 4.5 * scale, color: [0.97, 0.98, 1], strokeColor: [0.03, 0.07, 0.11], strokeWidth: 2 * scale },
      expressions: {
        main: anchoredPositionExpression(record.lat, record.lng, label.dx, label.mainDy),
        sub: label.subtitle ? anchoredPositionExpression(record.lat, record.lng, label.dx, label.subDy) : null,
        dot: anchoredPositionExpression(record.lat, record.lng, 0, 0)
      }
    };
  });
  const result = await callHostWithJobFile<{ labels: number; layers: number; removed: number; expressionErrors: string[] }>("addLabels", { mapId, labels });
  lap("host");
  return { candidates: prepared.length, ...result, seconds: (performance.now() - started) / 1000, timings };
}
