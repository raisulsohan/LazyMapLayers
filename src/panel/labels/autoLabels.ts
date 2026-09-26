// Auto labels: the names of countries, cities and the natural world (oceans and seas, rivers and
// lakes, ranges, deserts, islands, peaks) from Natural Earth, in the local language with an English
// subtitle, placed over the whole timeline of a map and built as After Effects text layers.

import { anchoredPositionExpression, curvedLabelPathExpression, streetLabelExpressions } from "../../core/ae/labelExpressions.ts";
import { labelText, type LabelLanguageMode, type LabelNames } from "../../core/labels/language.ts";
import { zoneBoxes, zonesOnFrame, type KeepOutZone } from "../../core/labels/keepOut.ts";
import { resolveLabelTemplate, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { dotStyle } from "../../core/labels/restyle.ts";
import { FEATURE_STYLES, featureClassOf, featureGroup, formatElevation, natureGroup } from "../../core/labels/nature.ts";

import { cityLabelRecords, CITY_DETAIL_ZOOM } from "./cityLabels.ts";
import { labelStrength, measureLabel, zoomBand, type MeasuredLabel } from "./candidate.ts";
import { designImages, designValues, type LabelDesign } from "./labelDesigns.ts";
import { imageIndex } from "../../core/labels/designImages.ts";
import { fs, path } from "../cep.ts";
import { opacityKeys, placeLabels, type Box, type LabelCandidate } from "../../core/labels/placement.ts";
import { chooseWithShares } from "../../core/labels/budget.ts";
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
  /** Districts, parks, landmarks, stations, the water through town and the main streets of downloaded regions. */
  city?: boolean;
  /** The region archives the map shows, where the city names come from. */
  regions?: string[];
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
  /** The folder each of the design's picture fields takes its pictures from. */
  designImages?: Record<string, string> | null;
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
  // The screen angle of a street or a river over the city frames it can show in: the median, so a
  // name placed for a turning camera takes the room it needs most of the time.
  const cityFrames = cameras.filter((c) => c.zoom >= CITY_DETAIL_ZOOM);
  const angleOf = (record: LabelRecord): number | null => {
    if (!record.along) return null;
    const angles: number[] = [];
    const step = Math.max(1, Math.floor(cityFrames.length / 24));
    for (let i = 0; i < cityFrames.length; i += step) {
      const view = cityFrames[i];
      if (view.zoom < record.minZoom) continue;
      const viewport = { width: info.width, height: info.height };
      const a = projectPoint(view, viewport, record.along.from, { projection: info.projection });
      const b = projectPoint(view, viewport, record.along.to, { projection: info.projection });
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      angles.push(deg);
    }
    if (!angles.length) return 0;
    angles.sort((x, y) => x - y);
    return angles[Math.floor(angles.length / 2)];
  };
  const add = (record: LabelRecord) => {
    const band = zoomBand(record, record.id, placeMaxZoom);
    if (band.minZoom > highestZoom || band.maxZoom < lowestZoom) return;
    const named = labelText(record.names, record.country, record.region, language, english);
    const raw = named.text;
    if (!raw) return;
    const nature = record.kind === "nature" && record.nature ? record.nature : null;
    // A peak says how high it is under its name, after its English name when that line is asked for.
    const subtitle = nature === "peak" && record.elevation ? [named.subtitle, formatElevation(record.elevation)].filter(Boolean).join(" · ") : named.subtitle;
    const measured = measureLabel({ record, labelId: record.id, raw, subtitle, template, scale, design: design ? { width: design.width, height: design.height } : null, dot: template.dots, placeMaxZoom, angle: angleOf(record) });
    prepared.push({ ...measured, record, raw, subtitle: record.along ? null : subtitle });
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
  let cityRead: Awaited<ReturnType<typeof cityLabelRecords>> | null = null;
  if ((options.city ?? true) && options.regions?.length && cityFrames.length) {
    // The country the move is closest to at its closest: its language is the one OpenStreetMap's
    // plain names are written in.
    const deepest = cityFrames.reduce((best, view) => (view.zoom > best.zoom ? view : best), cityFrames[0]);
    let country = "";
    let nearest = Infinity;
    for (const place of data.places) {
      const d = Math.hypot((place.lng - deepest.center.lng) * Math.cos((deepest.center.lat * Math.PI) / 180), place.lat - deepest.center.lat);
      if (d < nearest) {
        nearest = d;
        country = place.country;
      }
    }
    cityRead = await cityLabelRecords(options.regions, cameras, { width: info.width, height: info.height }, country);
    // A district the world data already names (a large suburb, a town) is named once, by the world.
    const worldNames = data.places.filter((p) => Math.abs(p.lat - deepest.center.lat) < 1 && Math.abs(p.lng - deepest.center.lng) < 1.5);
    for (const record of cityRead.records) {
      const english = record.names.en;
      if (record.city === "district" && worldNames.some((p) => p.names.en === english && Math.hypot(p.lat - record.lat, p.lng - record.lng) < 0.04)) continue;
      add(record as unknown as LabelRecord);
    }
    lap("city");
  }

  lap("prepare");
  const frameZones = zoneBoxes(options.zones ?? [], { width: info.width, height: info.height }, info.frameRate, cameras.length);
  const place = (candidates: LabelCandidate[]) =>
    placeLabels(candidates, cameras, {
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
    });
  const byId = new Map(prepared.map((p) => [p.record.id, p]));
  const max = options.maxLabels ?? 150;
  let tracks = place(prepared.map((p) => p.candidate));
  // Every kind of city name within its share of the budget (core/labels/budget.ts); the chosen names
  // are then placed again on their own, so the names left out leave no holes where they would have been.
  const chosen = chooseWithShares(
    tracks.map((track) => {
      const kind = featureClassOf(track.id);
      return { id: track.id, priority: byId.get(track.id)!.candidate.priority, share: kind && featureGroup(kind) === "city" ? kind : null };
    }),
    max
  );
  if (chosen.length < tracks.length) {
    const wanted = new Set(chosen);
    tracks = place(prepared.filter((p) => wanted.has(p.record.id)).map((p) => p.candidate));
  }
  lap("place");
  const kept = tracks
    .map((track) => ({ track, label: byId.get(track.id)! }))
    .sort((a, b) => a.label.candidate.priority - b.label.candidate.priority)
    .slice(0, max);
  const fade = Math.round(info.frameRate * 0.4);
  // The pictures of a design's picture fields, read once per folder.
  const pictureFolders: Record<string, string> = {};
  for (const field of design?.images ?? []) if (options.designImages?.[field]) pictureFolders[field] = options.designImages[field];
  const indexes = new Map<string, Map<string, string>>();
  const pictureIndex = (folder: string) => {
    let index = indexes.get(folder);
    if (!index) {
      let files: string[] = [];
      try {
        files = fs().readdirSync(folder).map((name: string) => path().join(folder, name));
      } catch {
        files = [];
      }
      index = imageIndex(files);
      indexes.set(folder, index);
    }
    return index;
  };

  const sampler = samplerFor(options.terrain);
  const elevations = sampler ? await sampler.elevations(kept.map(({ label }) => label.record)) : kept.map(() => 0);
  sampler?.close();
  lap("elevation");
  const labels = kept.map(({ track, label }, index) => {
    const { record } = label;
    const elevation = elevations[index];
    const nature = featureClassOf(record.id);
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
      dot: nature ? FEATURE_STYLES[nature].marker !== "none" : !designed && record.kind === "place" && template.dots,
      main: label.main,
      sub: label.sub,
      // A design of the user's own: a copy of their comp per place, with its fields filled in.
      design: designed ? { compId: designed.compId, anchorX: designed.anchorX, anchorY: designed.anchorY, width: designed.width, height: designed.height, scale: Math.round(scale * 100), values: designValues(label.record, label.text, label.subtitle), images: designImages(label.record, pictureFolders, pictureIndex) } : null,
      dotStyle: dotStyle(template, scale, nature),
      // A city name keeps where it stands in its tag, so a name placed again later finds it without the tiles.
      place: record.kind === "city" ? { lat: record.lat, lng: record.lng, rank: record.rank, minZoom: record.minZoom, maxZoom: record.maxZoom ?? 22, along: record.along ?? null } : null,
      expressions: {
        main: record.along ? streetLabelExpressions(record.lat, record.lng, record.along.from, record.along.to, label.mainDy, elevation).position : anchoredPositionExpression(record.lat, record.lng, label.dx, label.mainDy, undefined, elevation),
        // Bent along its stretch of the line where the name has one (text on a mask path), else turned with it.
        path: record.along?.path && !designed ? curvedLabelPathExpression(record.along.path, record.along.from, record.along.to, label.mainDy, elevation, (label.length ?? 0) / 2 + 12) : null,
        rotation: record.along && !(record.along.path && !designed) ? streetLabelExpressions(record.lat, record.lng, record.along.from, record.along.to, label.mainDy, elevation).rotation : null,
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
