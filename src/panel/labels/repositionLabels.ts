// The names already on a map move when the template changes their size: bigger names need more room,
// so they are placed again over the whole timeline with the same collision rules that placed them,
// and a name that no longer fits anywhere fades out instead of sitting on top of another.
//
// The words are not chosen again: every name keeps the text it was placed with (its tag holds it), so
// the language, the density and which places were chosen stay exactly as the user had them.

import { anchoredPositionExpression, curvedLabelPathExpression, streetLabelExpressions } from "../../core/ae/labelExpressions.ts";
import type { View } from "../../core/camera/camera.ts";
import { projectPoint, type MapProjection } from "../../core/camera/globe.ts";
import { zoneBoxes, zonesOnFrame, type KeepOutZone } from "../../core/labels/keepOut.ts";
import type { LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { opacityKeys, placeLabels, type Box } from "../../core/labels/placement.ts";
import type { PlacedLabel } from "../../core/labels/restyle.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";
import { readCameras, type RenderInfo } from "../render/renderJob.ts";
import { loadWorldLabels, type WorldLabel } from "../data/worldLabels.ts";
import { labelStrength, measureLabel, zoomBand, type MeasuredLabel } from "./candidate.ts";

/** Names per call into After Effects, as a restyle sends them. */
export const REPOSITION_BATCH = 40;

export type RepositionOptions = {
  template: LabelTemplate;
  terrain?: TerrainSetting | null;
  /** Parts of the frame names must stay out of, as the map carries them. */
  zones?: KeepOutZone[];
  /** Place names fade away above this zoom, as when they were placed. */
  placeMaxZoom?: number;
  onProgress?: (done: number, total: number) => void;
};

export type RepositionResult = {
  /** Names the map has that the world data still knows. */
  labels: number;
  /** Names whose place on the frame changed. */
  moved: number;
  /** Names that no longer fit anywhere and now stay hidden. */
  hidden: number;
  /** Names on the map the world data no longer holds; they are left alone. */
  unknown: number;
  longestCallMs: number;
};

type Part = { main?: PlacedLabel; subtitle?: PlacedLabel; dot?: PlacedLabel; design?: PlacedLabel };

/** A line's screen angle over the frames close enough to show it, the median. */
function medianAngle(along: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }, cameras: View[], viewport: { width: number; height: number }, projection: MapProjection, minZoom: number): number {
  const angles: number[] = [];
  const step = Math.max(1, Math.floor(cameras.length / 24));
  for (let i = 0; i < cameras.length; i += step) {
    if (cameras[i].zoom < minZoom) continue;
    const a = projectPoint(cameras[i], viewport, along.from, { projection });
    const b = projectPoint(cameras[i], viewport, along.to, { projection });
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    angles.push(deg);
  }
  angles.sort((x, y) => x - y);
  return angles.length ? angles[Math.floor(angles.length / 2)] : 0;
}

/** The label records by their id, so a placed name finds the place it stands for. */
function recordsById(): Map<string, WorldLabel> {
  const data = loadWorldLabels();
  const map = new Map<string, WorldLabel>();
  for (const record of data.countries) map.set(record.id, record);
  for (const record of data.places) map.set(record.id, record);
  for (const record of data.nature) map.set(record.id, record);
  return map;
}

/**
 * Places the names already on the map again with `template`'s sizes and writes their new positions
 * and fades. Nothing is created or removed: only the layers that are there are moved.
 */
export async function repositionLabels(mapId: string, options: RepositionOptions): Promise<RepositionResult> {
  const result: RepositionResult = { labels: 0, moved: 0, hidden: 0, unknown: 0, longestCallMs: 0 };
  const placed = await callHost<PlacedLabel[]>("listLabels", { mapId, kind: "label" });
  if (!placed.length) return result;
  const parts = new Map<string, Part>();
  for (const label of placed) {
    const part = parts.get(label.labelId) ?? {};
    if (label.part === "subtitle") part.subtitle = label;
    else if (label.part === "dot") part.dot = label;
    else if (label.part === "design") part.design = label;
    else part.main = label;
    parts.set(label.labelId, part);
  }

  const info = await callHost<RenderInfo>("renderInfo", { mapId });
  const cameras = (await readCameras(mapId, info, [0], undefined, () => undefined)).map((samples) => samples[0]);
  const records = recordsById();
  const scale = info.height / 1080;
  const placeMaxZoom = options.placeMaxZoom ?? 10;
  const lowestZoom = Math.min(...cameras.map((c) => c.zoom));
  const highestZoom = Math.max(...cameras.map((c) => c.zoom));

  type Prepared = MeasuredLabel & { record: WorldLabel; part: Part };
  const prepared: Prepared[] = [];
  for (const [labelId, part] of parts) {
    const kept = part.main?.place;
    // A name inside a city has no record in the world data; its tag says where it stands.
    const record: WorldLabel | undefined = records.get(labelId) ?? (kept ? ({ id: labelId, kind: "city", lat: kept.lat, lng: kept.lng, country: "", rank: kept.rank, minZoom: kept.minZoom, maxZoom: kept.maxZoom, population: 0, names: {}, along: kept.along ?? undefined } as WorldLabel) : undefined);
    if (!record || !(part.main || part.design)) {
      result.unknown++;
      continue;
    }
    // The same zoom band the name was placed in, so a template change never lengthens its stay.
    const band = zoomBand(record, labelId, placeMaxZoom);
    if (band.minZoom > highestZoom || band.maxZoom < lowestZoom) continue;
    const placed = (part.design ?? part.main)!;
    // A design keeps the room its comp took when it was placed (its tag holds it).
    const design = part.design ? { width: part.design.w ?? 0, height: part.design.h ?? 0 } : null;
    // A name whose dot is gone keeps nothing free around its place.
    const angle = record.along ? medianAngle(record.along, cameras, { width: info.width, height: info.height }, info.projection, record.minZoom) : null;
    const measured = measureLabel({ record, labelId, raw: placed.raw ?? placed.text, subtitle: part.subtitle?.text ?? null, template: options.template, scale, design, dot: !!part.dot, placeMaxZoom, angle });
    prepared.push({ ...measured, record, part });
  }
  result.labels = prepared.length;
  if (!prepared.length) return result;

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
      keepOut: (frame) => zonesOnFrame(frameZones, frame).slice() as Box[]
    }
  );
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const fade = Math.round(info.frameRate * 0.4);
  const sampler = samplerFor(options.terrain ?? null);
  let elevations: number[];
  try {
    elevations = sampler ? await sampler.elevations(prepared.map((p) => p.record)) : prepared.map(() => 0);
  } finally {
    sampler?.close();
  }

  type Item = { labelId: string; part: "text" | "subtitle" | "dot" | "design"; positionExpression: string; pathExpression?: string; keys: number[][] };
  const items: Item[] = [];
  for (const [index, entry] of prepared.entries()) {
    const elevation = elevations[index];
    const track = byId.get(entry.candidate.id);
    const strength = labelStrength(entry.candidate.id);
    const keys = track ? opacityKeys(track, fade, cameras.length).map(([frame, value]) => [frame, (value * strength) / 100]) : [];
    if (!keys.length) result.hidden++;
    const along = entry.record.along;
    const at = (dy: number) => (along ? streetLabelExpressions(entry.record.lat, entry.record.lng, along.from, along.to, dy, elevation).position : anchoredPositionExpression(entry.record.lat, entry.record.lng, entry.dx, dy, undefined, elevation));
    if (entry.part.design) items.push({ labelId: entry.candidate.id, part: "design", positionExpression: at(0), keys });
    else if (along?.path) items.push({ labelId: entry.candidate.id, part: "text", positionExpression: at(entry.mainDy), pathExpression: curvedLabelPathExpression(along.path, along.from, along.to, entry.mainDy, elevation, (entry.length ?? 0) / 2 + 12), keys });
    else items.push({ labelId: entry.candidate.id, part: "text", positionExpression: at(entry.mainDy), keys });
    if (entry.part.subtitle) items.push({ labelId: entry.candidate.id, part: "subtitle", positionExpression: at(entry.subDy), keys });
    if (entry.part.dot) items.push({ labelId: entry.candidate.id, part: "dot", positionExpression: anchoredPositionExpression(entry.record.lat, entry.record.lng, 0, 0, undefined, elevation), keys });
  }

  const batches = Math.max(1, Math.ceil(items.length / REPOSITION_BATCH));
  for (let b = 0; b < batches; b++) {
    const started = Date.now();
    const made = await callHostWithJobFile<{ moved: number; expressionErrors: string[] }>("moveLabels", {
      mapId,
      kind: "label",
      first: b === 0,
      last: b === batches - 1,
      items: items.slice(b * REPOSITION_BATCH, (b + 1) * REPOSITION_BATCH)
    });
    result.longestCallMs = Math.max(result.longestCallMs, Date.now() - started);
    result.moved += made.moved;
    options.onProgress?.(b + 1, batches);
  }
  // Every part of a name moves together; the count the caller wants is names, not layers.
  result.moved = Math.min(result.labels, prepared.filter((p) => byId.has(p.candidate.id)).length);
  return result;
}
