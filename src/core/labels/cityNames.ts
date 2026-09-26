// The names inside a downloaded city, from its OpenStreetMap tiles (the Protomaps basemap layers):
// districts and neighbourhoods, parks, landmarks, stations, airports and campuses, the rivers and
// canals through town, and the main streets. Each becomes one label record like the world's, so Auto
// labels places them with the same rules.
//
// Tiles repeat a feature near their edges and cut long streets and rivers into pieces, so names are
// gathered per kind and per name: a point is kept once within a short distance, and a street or a
// river gets one name per stretch of a couple of kilometres, halfway along its longest piece, with
// two points either side of it so the name can lie along it.

import type { NameLanguage } from "./language.ts";
import { labelPoint } from "../geo/polylabel.ts";
import { cityLabelId, type CityClass } from "./nature.ts";
import type { TileValue } from "../tiles/mvt.ts";

/** A decoded tile feature with its geometry in longitude and latitude. */
export type CityFeature = { layer: string; type: 1 | 2 | 3; properties: Record<string, TileValue>; coords: number[][][] };

export type CityRecord = {
  id: string;
  kind: "city";
  city: CityClass;
  lat: number;
  lng: number;
  country: string;
  rank: number;
  minZoom: number;
  maxZoom: number;
  population: 0;
  names: Record<string, string>;
  /**
   * Two points of the street or river either side of the name, for names laid along it, and the
   * stretch of it the name bends along ([lat, lng] points, the name's place at `mid`).
   */
  along?: { from: { lat: number; lng: number }; to: { lat: number; lng: number }; path?: { points: number[][]; mid: number } };
};

const PARKS = new Set(["park", "garden", "nature_reserve", "national_park", "protected_area", "forest", "cemetery", "recreation_ground", "common", "wood"]);
const LANDMARKS = new Set(["attraction", "museum", "castle", "monument", "memorial", "stadium", "zoo", "theme_park", "aquarium", "palace", "fort", "ruins", "archaeological_site", "theatre", "arts_centre", "lighthouse", "tower", "cathedral", "opera"]);
const STATIONS = new Set(["station", "train_station", "railway_station"]);
const AIRPORTS = new Set(["aerodrome", "airport"]);
const CAMPUSES = new Set(["university", "college"]);
const STREET_RANK: Record<string, number> = { motorway: 0, trunk: 0, primary: 0, secondary: 1, tertiary: 2 };

const text = (value: TileValue | undefined) => (typeof value === "string" ? value.trim() : "");
const number = (value: TileValue | undefined, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** What kind of city name a tile feature is, or null for one the map should not name. */
export function cityClassOf(feature: CityFeature): { kind: CityClass; rank: number; minZoom: number } | null {
  const p = feature.properties;
  const kind = text(p.kind);
  const detail = text(p.kind_detail);
  const minZoom = number(p.min_zoom, NaN);
  if (feature.layer === "places") {
    const district = kind === "neighbourhood" || kind === "macrohood" || (kind === "locality" && (detail === "town" || detail === "village" || detail === "suburb"));
    if (!district) return null;
    const z = Number.isFinite(minZoom) ? minZoom : 12;
    return { kind: "district", rank: Math.max(0, z - 10), minZoom: z };
  }
  if (feature.layer === "pois") {
    const cls: CityClass | null = PARKS.has(kind) ? "park" : AIRPORTS.has(kind) ? "airport" : STATIONS.has(kind) ? "station" : CAMPUSES.has(kind) ? "campus" : LANDMARKS.has(kind) || LANDMARKS.has(detail) ? "landmark" : null;
    if (!cls) return null;
    const z = Number.isFinite(minZoom) ? minZoom : 14;
    return { kind: cls, rank: Math.max(0, z - 12), minZoom: Math.max(11, z) };
  }
  if (feature.layer === "water") {
    const line = feature.type === 2 && (kind === "river" || kind === "canal");
    const area = feature.type === 3 && (kind === "lake" || kind === "water" || kind === "reservoir" || kind === "basin" || kind === "river");
    if (!line && !area) return null;
    const z = Number.isFinite(minZoom) ? minZoom : 11;
    return { kind: "cityWater", rank: Math.max(0, z - 10), minZoom: Math.max(10.5, z) };
  }
  if (feature.layer === "roads") {
    if (feature.type !== 2 || p.is_link === true || p.is_tunnel === true) return null;
    const road = kind === "highway" ? "motorway" : kind === "major_road" ? detail : "";
    const rank = STREET_RANK[road];
    if (rank === undefined) return null;
    return { kind: "street", rank, minZoom: 12.5 + rank };
  }
  return null;
}

/**
 * A feature's names by our language codes. OpenStreetMap's plain name is the local one, so it stands
 * for the local language wherever that has no name of its own.
 */
export function namesOf(properties: Record<string, TileValue>, local: NameLanguage | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!key.startsWith("name:") || typeof value !== "string" || !value.trim()) continue;
    const code = key.slice(5).toLowerCase();
    const ours = code === "zh-hant" || code === "zh_hant" || code === "zh-tw" ? "zht" : code === "zh-hans" || code === "zh_hans" ? "zh" : code;
    if (/^[a-z]{2,3}$/.test(ours) && !out[ours]) out[ours] = value.trim();
  }
  const plain = text(properties.name);
  if (plain) {
    if (local && !out[local]) out[local] = plain;
    if (!out.en) out.en = plain;
  }
  return out;
}

/** Metres between two points, near enough for a city. */
function metres(a: number[], b: number[]): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320;
}

/** The point `distance` metres along a line from its start. */
function pointAlong(line: number[][], distance: number): number[] {
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const step = metres(line[i - 1], line[i]);
    if (walked + step >= distance && step > 0) {
      const t = (distance - walked) / step;
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
    }
    walked += step;
  }
  return line[line.length - 1];
}

function lengthOf(line: number[][]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += metres(line[i - 1], line[i]);
  return total;
}

/** The two points either side of a name on its line, and the stretch it bends along when the line turns gently there. */
function alongOf(line: number[][], middle: number, from: number[], to: number[]): NonNullable<CityRecord["along"]> {
  const along: NonNullable<CityRecord["along"]> = { from: { lat: from[1], lng: from[0] }, to: { lat: to[1], lng: to[0] } };
  const stretch = stretchAround(line, middle);
  if (stretch.points.length >= 3 && bendNear(stretch) <= MOST_BEND_DEGREES) along.path = stretch;
  return along;
}

/** How far either side of its place a name may bend along its line, and the step it is kept at. */
const STRETCH_METRES = 700;
const STRETCH_STEP_METRES = 25;

/** The stretch of a line either side of the point `middle` metres along it, as [lat, lng] points. */
export function stretchAround(line: number[][], middle: number, half = STRETCH_METRES, step = STRETCH_STEP_METRES): { points: number[][]; mid: number } {
  const total = lengthOf(line);
  const start = Math.max(0, middle - half);
  const end = Math.min(total, middle + half);
  const before = Math.ceil((middle - start) / step);
  const after = Math.ceil((end - middle) / step);
  const points: number[][] = [];
  const add = (distance: number) => {
    const [lng, lat] = pointAlong(line, distance);
    points.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
  };
  for (let k = before; k >= 1; k--) add(middle - ((middle - start) * k) / before);
  add(middle);
  for (let k = 1; k <= after; k++) add(middle + ((end - middle) * k) / after);
  return { points, mid: before };
}

/** Over this many metres either side of its place, a line may turn this much and still carry a bent name. */
const BEND_METRES = 150;
const MOST_BEND_DEGREES = 50;

/**
 * How far a stretch turns near its place: the largest difference in heading, in degrees, between
 * the step at the place and any step within `metres` of it. A name bent round a sharper turn would
 * stand on its head at one end, so such a line keeps a straight name.
 */
export function bendNear(stretch: { points: number[][]; mid: number }, metres = BEND_METRES): number {
  const pts = stretch.points;
  const k = Math.cos((pts[stretch.mid][0] * Math.PI) / 180);
  const heading = (i: number) => Math.atan2(pts[i + 1][0] - pts[i][0], (pts[i + 1][1] - pts[i][1]) * k);
  const at = Math.min(stretch.mid, pts.length - 2);
  if (at < 0) return 0;
  const here = heading(at);
  let most = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const away = metres_([pts[i][1], pts[i][0]], [pts[at][1], pts[at][0]]);
    if (away > metres) continue;
    let d = Math.abs(heading(i) - here);
    if (d > Math.PI) d = 2 * Math.PI - d;
    most = Math.max(most, (d * 180) / Math.PI);
  }
  return most;
}

const metres_ = (a: number[], b: number[]) => metres(a, b);

/** How close two names of the same kind and words may stand before they count as one. */
const CLUSTER_METRES: Record<CityClass, number> = { district: 1000, park: 500, landmark: 400, station: 400, airport: 2000, campus: 500, cityWater: 2500, street: 1800 };
/** A line shorter than this cannot carry its name. */
const SHORTEST_LINE_METRES: Partial<Record<CityClass, number>> = { street: 140, cityWater: 250 };

type Candidate = { kind: CityClass; rank: number; minZoom: number; name: string; point: number[]; weight: number; names: Record<string, string>; along?: CityRecord["along"]; key: string };

/**
 * The city's label records from its tile features. `country` is the region's country (its code) and
 * `local` the language its plain names are in.
 */
export function cityRecords(features: CityFeature[], options: { country: string; local: NameLanguage | null }): CityRecord[] {
  const candidates: Candidate[] = [];
  const lineNames = new Set<string>();
  for (const feature of features) if (feature.layer === "water" && feature.type === 2) lineNames.add(text(feature.properties.name));
  for (const feature of features) {
    const name = text(feature.properties.name);
    if (!name) continue;
    const cls = cityClassOf(feature);
    if (!cls) continue;
    const names = namesOf(feature.properties, options.local);
    const wikidata = text(feature.properties.wikidata);
    if (feature.type === 1) {
      for (const point of feature.coords.flat()) candidates.push({ ...cls, name, point, weight: 1, names, key: wikidata || name });
    } else if (feature.type === 2) {
      const shortest = SHORTEST_LINE_METRES[cls.kind] ?? 0;
      for (const line of feature.coords) {
        const length = lengthOf(line);
        if (length < shortest) continue;
        const middle = length / 2;
        const half = Math.min(60, length / 4);
        const from = pointAlong(line, middle - half);
        const to = pointAlong(line, middle + half);
        candidates.push({ ...cls, name, point: pointAlong(line, middle), weight: length, names, along: alongOf(line, middle, from, to), key: name });
      }
    } else {
      // A river's banks as an area only when the river has no line of its own to be named along.
      if (cls.kind === "cityWater" && lineNames.has(name)) continue;
      for (const ring of feature.coords) {
        if (ring.length < 4) continue;
        const [lng, lat] = labelPoint({ type: "Polygon", coordinates: [ring] });
        candidates.push({ ...cls, name, point: [lng, lat], weight: Math.abs(ringArea(ring)), names, key: wikidata || name });
      }
    }
  }

  // The best first (lowest rank, then the longest line or the largest area), then one per cluster.
  candidates.sort((a, b) => a.rank - b.rank || b.weight - a.weight);
  const kept: Candidate[] = [];
  const byName = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const group = `${c.kind}|${c.name}`;
    const same = byName.get(group) ?? [];
    if (same.some((k) => metres(k.point, c.point) < CLUSTER_METRES[c.kind])) continue;
    same.push(c);
    byName.set(group, same);
    kept.push(c);
  }
  return kept.map((c) => ({
    id: cityLabelId(c.kind, `${c.key}@${c.point[1].toFixed(4)},${c.point[0].toFixed(4)}`),
    kind: "city",
    city: c.kind,
    lat: Math.round(c.point[1] * 1e6) / 1e6,
    lng: Math.round(c.point[0] * 1e6) / 1e6,
    country: options.country,
    rank: c.rank,
    minZoom: c.minZoom,
    maxZoom: 22,
    population: 0,
    names: c.names,
    along: c.along
  }));
}

function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum / 2;
}
