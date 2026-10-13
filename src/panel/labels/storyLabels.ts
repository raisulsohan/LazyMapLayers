// "Only the story's names" (D107): the panel side. Reads the names Auto labels placed and the map's
// routes, pins and callouts, lets core decide which names stand for those places, and asks the host to
// remove the others in one undo step.

import { namesToKeep, storyPlaces, STORY_RADIUS_KM, type NamedPlace } from "../../core/labels/storyNames.ts";
import type { PlacedLabel } from "../../core/labels/restyle.ts";
import type { ExportLayer } from "../../core/data/geoJsonExport.ts";
import { callHost } from "../cep.ts";
import { loadWorldLabels } from "../data/worldLabels.ts";

export type StoryNamesResult = {
  /** Story places found: route ends, pins, callouts, attached layers. */
  places: number;
  /** The words of the names kept. */
  kept: string[];
  /** Label layers removed (a name can have a dot and a subtitle as well). */
  removed: number;
};

/** Where each name on the map stands, with its tier: a city or town 0, a country 1, nature 2, a name inside a city 3. */
function namedPlaces(placed: PlacedLabel[]): { names: NamedPlace[]; words: Map<string, string> } {
  const data = loadWorldLabels();
  const records = new Map<string, { lat: number; lng: number; tier: number }>();
  for (const r of data.places) records.set(r.id, { lat: r.lat, lng: r.lng, tier: 0 });
  for (const r of data.countries) records.set(r.id, { lat: r.lat, lng: r.lng, tier: 1 });
  for (const r of data.nature) records.set(r.id, { lat: r.lat, lng: r.lng, tier: 2 });
  const names: NamedPlace[] = [];
  const words = new Map<string, string>();
  for (const label of placed) {
    if (label.part !== "text" && label.part !== "design") continue;
    words.set(label.labelId, label.raw ?? label.text);
    const record = records.get(label.labelId);
    if (record) names.push({ labelId: label.labelId, ...record });
    else if (label.place) names.push({ labelId: label.labelId, lat: label.place.lat, lng: label.place.lng, tier: 3 });
    // A name the world data no longer knows has no place to stand for, so it is not kept.
  }
  return { names, words };
}

/**
 * Keeps the names of the map's own places and removes the other Auto labels. Does nothing when the
 * map has no route, pin or callout, or no name stands near any of them (that would be Remove labels).
 */
export async function keepStoryNames(mapId: string): Promise<StoryNamesResult> {
  const layers = await callHost<ExportLayer[]>("exportLayers", { mapId });
  const places = storyPlaces(layers);
  if (!places.length) return { places: 0, kept: [], removed: 0 };
  const placed = await callHost<PlacedLabel[]>("listLabels", { mapId, kind: "label" });
  const { names, words } = namedPlaces(placed);
  const keep = namesToKeep(names, places, STORY_RADIUS_KM);
  const kept = [...keep].map((id) => words.get(id) ?? id);
  if (!keep.size) return { places: places.length, kept, removed: 0 };
  const result = await callHost<{ removed: number }>("keepLabels", { mapId, keep: [...keep] });
  return { places: places.length, kept, removed: result.removed };
}
