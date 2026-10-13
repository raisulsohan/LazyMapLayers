// "Only the story's names" (D107): of the names Auto labels placed, keep the ones that stand for the
// places the map's own story is about - both ends of every route, every pin, callout and attached
// layer - and let the rest go. The panel reads the layers and the label records; this decides.

import { pointsFromExpression, type ExportLayer } from "../data/geoJsonExport.ts";

export type LatLng = { lat: number; lng: number };

/**
 * A name on the map with the place it stands for. `tier` orders the kinds of name a story place is
 * best named by, lower first: a city or town before a country, a sea or a name inside a city, so a
 * pin on the Eiffel Tower keeps "Paris" rather than the district or the river beside it.
 */
export type NamedPlace = LatLng & { labelId: string; tier: number };

/** How far a name may stand from the place it is kept for. Wide enough for a landmark in its city. */
export const STORY_RADIUS_KM = 50;

/** Great-circle distance in kilometres. */
export function kmBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The places a map's story is about: the place of every pin, attached layer and callout, and the first
 * and last point of every route. A route of the user's own whose expression was replaced by hand has
 * no points to read and adds nothing.
 */
export function storyPlaces(layers: ExportLayer[]): LatLng[] {
  const out: LatLng[] = [];
  const seen = new Set<string>();
  const add = (lat: number, lng: number) => {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ lat, lng });
  };
  for (const layer of layers) {
    if (layer.kind === "pin" || layer.kind === "attached" || layer.kind === "callout") {
      if (finite(layer.lat) && finite(layer.lng)) add(layer.lat, layer.lng);
      continue;
    }
    if (layer.kind !== "route") continue;
    const line = (layer.paths ?? []).map(pointsFromExpression).find((p): p is number[][] => !!p && p.length >= 2);
    if (!line) continue;
    // Route points are baked as [lat, lng].
    add(line[0][0], line[0][1]);
    add(line[line.length - 1][0], line[line.length - 1][1]);
  }
  return out;
}

/**
 * The ids of the names to keep: for each story place, the name of the best tier within `radiusKm`,
 * the nearest of that tier. A place with no name near it keeps nothing; one name can serve several
 * places (a route that starts at a pin).
 */
export function namesToKeep(names: NamedPlace[], places: LatLng[], radiusKm = STORY_RADIUS_KM): Set<string> {
  const keep = new Set<string>();
  for (const place of places) {
    let best: { name: NamedPlace; km: number } | null = null;
    for (const name of names) {
      const km = kmBetween(place, name);
      if (km > radiusKm) continue;
      if (!best || name.tier < best.name.tier || (name.tier === best.name.tier && km < best.km)) best = { name, km };
    }
    if (best) keep.add(best.name.labelId);
  }
  return keep;
}
