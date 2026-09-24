// The names already on a map move when the template changes their size: bigger names need more room,
// so they are placed again over the whole timeline with the same collision rules that placed them,
// and a name that no longer fits anywhere fades out instead of sitting on top of another.
//
// The words are not chosen again: every name keeps the text it was placed with (its tag holds it), so
// the language, the density and which places were chosen stay exactly as the user had them.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { zoneBoxes, zonesOnFrame, type KeepOutZone } from "../../core/labels/keepOut.ts";
import { scriptOf } from "../../core/labels/language.ts";
import type { LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { opacityKeys, placeLabels, type Box, type LabelCandidate } from "../../core/labels/placement.ts";
import { capsFor, isCountryLabel, type PlacedLabel } from "../../core/labels/restyle.ts";
import { textStyle } from "../../core/labels/restyle.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";
import { readCameras, type RenderInfo } from "../render/renderJob.ts";
import { loadWorldLabels, type WorldLabel } from "../data/worldLabels.ts";
import { measure } from "./autoLabels.ts";

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

type Part = { main?: PlacedLabel; subtitle?: PlacedLabel; dot?: PlacedLabel };

/** The label records by their id, so a placed name finds the place it stands for. */
function recordsById(): Map<string, WorldLabel> {
  const data = loadWorldLabels();
  const map = new Map<string, WorldLabel>();
  for (const record of data.countries) map.set(record.id, record);
  for (const record of data.places) map.set(record.id, record);
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

  type Prepared = { candidate: LabelCandidate; record: WorldLabel; part: Part; dx: number; mainDy: number; subDy: number };
  const prepared: Prepared[] = [];
  for (const [labelId, part] of parts) {
    const record = records.get(labelId);
    if (!record || !part.main) {
      result.unknown++;
      continue;
    }
    const isCountry = isCountryLabel(labelId);
    const raw = part.main.raw ?? part.main.text;
    const script = scriptOf(raw);
    const text = capsFor(options.template, isCountry, script) ? raw.toLocaleUpperCase() : raw;
    const subtitle = part.subtitle?.text ?? null;
    const subScript = subtitle ? scriptOf(subtitle) : "latin";
    const main = textStyle(options.template, scale, { country: isCountry, script, part: "text" });
    const sub = textStyle(options.template, scale, { country: isCountry, script: subScript, part: "subtitle" });
    const width = Math.max(measure(text, script, main.size, 600, main.tracking), subtitle ? measure(subtitle, subScript, sub.size, 400, sub.tracking) : 0) + main.haloWidth * 2;
    const gap = main.size * 0.18;
    const height = main.size * 1.1 + (subtitle ? gap + sub.size * 1.1 : 0);
    const top = -height / 2;
    const offset = Math.round(10 * scale);
    // The same zoom band the name was placed in, so a template change never lengthens its stay.
    const minZoom = Math.max(0, record.minZoom - 1);
    const maxZoom = isCountry ? Math.max(minZoom + 2, (record.maxZoom ?? 8) - 1) : placeMaxZoom;
    if (minZoom > highestZoom || maxZoom < lowestZoom) continue;
    prepared.push({
      candidate: {
        id: labelId,
        lat: record.lat,
        lng: record.lng,
        priority: isCountry ? record.rank * 10 + 5 : record.rank * 10 - (record.capital ? 4 : 0) - Math.min(3, Math.log10(record.population + 1) / 3),
        width,
        height,
        anchor: isCountry ? "center" : "right",
        offset,
        // A name whose dot is gone keeps nothing free around its place.
        markerRadius: isCountry || !part.dot ? 0 : 5 * scale,
        minZoom,
        maxZoom
      },
      record,
      part,
      dx: isCountry ? 0 : offset + width / 2,
      mainDy: top + main.size * 0.85,
      subDy: top + main.size * 1.1 + gap + sub.size * 0.85
    });
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

  type Item = { labelId: string; part: "text" | "subtitle" | "dot"; positionExpression: string; keys: number[][] };
  const items: Item[] = [];
  for (const [index, entry] of prepared.entries()) {
    const elevation = elevations[index];
    const track = byId.get(entry.candidate.id);
    const country = isCountryLabel(entry.candidate.id);
    const peak = country ? 85 : 100;
    const keys = track ? opacityKeys(track, fade).map(([frame, value]) => [frame, (value * peak) / 100]) : [];
    if (!keys.length) result.hidden++;
    const at = (dy: number) => anchoredPositionExpression(entry.record.lat, entry.record.lng, entry.dx, dy, undefined, elevation);
    items.push({ labelId: entry.candidate.id, part: "text", positionExpression: at(entry.mainDy), keys });
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
