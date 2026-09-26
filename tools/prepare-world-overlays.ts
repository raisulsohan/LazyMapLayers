// Builds data for animated overlays from the Natural Earth shapefiles in .cache/ne (public domain):
//
//   data/generated/borders.geojson   country borders on land (1:50m) with line metrics, for draw-on
//   data/generated/labels.json       countries, populated places and natural features (oceans and seas,
//                                    rivers and lakes, ranges, deserts, islands, peaks) with names in 26
//                                    languages
//
//   node tools/prepare-world-overlays.ts

import fs from "node:fs";
import path from "node:path";
import shp from "shpjs";
import { labelPoint } from "../src/core/geo/polylabel.ts";
import { natureLabelId, type NatureClass } from "../src/core/labels/nature.ts";

type Feature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;
type Collection = { type: "FeatureCollection"; features: Feature[] };

const root = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(root, ".cache", "ne");
const outDir = path.join(root, "data", "generated");

const LANGUAGES = ["ar", "bn", "de", "el", "en", "es", "fa", "fr", "he", "hi", "hu", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv", "tr", "uk", "ur", "vi", "zh", "zht"];

async function load(base: string): Promise<Collection> {
  const zip = fs.readFileSync(path.join(cacheDir, `${base}.zip`));
  const result = (await shp(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength))) as Collection | Collection[];
  return Array.isArray(result) ? result[0] : result;
}

const lower = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const valid = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== -99 && v !== "-99";

function names(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of LANGUAGES) {
    const value = p[`name_${lang}`];
    if (typeof value === "string" && value.trim()) out[lang] = value.trim();
  }
  if (!out.en && typeof p.name === "string") out.en = p.name;
  return out;
}

function roundCoordinates(coords: unknown): unknown {
  if (typeof coords === "number") return round(coords, 3);
  return (coords as unknown[]).map(roundCoordinates);
}

/**
 * The box around a country's main land: polygons much smaller than the largest one (far islands,
 * overseas territories) are left out, so "fit to France" frames France and not French Guiana too.
 * A box that crosses the antimeridian comes back with its east smaller than its west.
 */
function mainBbox(geometry: GeoJSON.Geometry | null): [number, number, number, number] | null {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings = polygons.map((polygon) => polygon[0]).filter((ring) => ring && ring.length > 2);
  if (!rings.length) return null;
  const area = (ring: number[][]) => {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return Math.abs(sum) / 2;
  };
  const areas = rings.map(area);
  const largest = Math.max(...areas);
  const kept = rings.filter((_, i) => areas[i] >= largest * 0.12);
  const box = (shift: boolean) => {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const ring of kept)
      for (const [x, y] of ring) {
        const lng = shift && x < 0 ? x + 360 : x;
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, y);
        north = Math.max(north, y);
      }
    return { west, south, east, north };
  };
  let b = box(false);
  if (b.east - b.west > 300) {
    const shifted = box(true);
    if (shifted.east - shifted.west < b.east - b.west) b = shifted;
  }
  const wrap = (lng: number) => (lng > 180 ? lng - 360 : lng);
  return [round(wrap(b.west), 3), round(b.south, 3), round(wrap(b.east), 3), round(b.north, 3)];
}

type Polygonal = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** The countries as boxes and rings, to find which country a natural feature lies in. */
function countryFinder(countries: Collection) {
  const shapes = countries.features.flatMap((f) => {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return [];
    const p = lower(f.properties ?? {});
    const code = valid(p.adm0_a3) ? String(p.adm0_a3) : String(p.iso_a3 ?? "");
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return polygons.map((rings) => {
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const [x, y] of rings[0]) {
        west = Math.min(west, x);
        east = Math.max(east, x);
        south = Math.min(south, y);
        north = Math.max(north, y);
      }
      return { code, rings, west, south, east, north };
    });
  });
  const inRing = (x: number, y: number, ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
  return (lng: number, lat: number): string => {
    for (const shape of shapes) {
      if (lng < shape.west || lng > shape.east || lat < shape.south || lat > shape.north) continue;
      if (!inRing(lng, lat, shape.rings[0])) continue;
      if (shape.rings.slice(1).some((hole) => inRing(lng, lat, hole))) continue;
      return shape.code;
    }
    return "";
  };
}

/**
 * The zoom (Natural Earth counts 256-pixel tiles) at which a length of `km` on the ground spans
 * `pixels` on screen at the equator: 40,075 km of the world over 256 * 2^z pixels.
 */
function zoomForSize(km: number, pixels: number): number {
  if (!(km > 0)) return 12;
  return Math.max(0, Math.log2((pixels * 40075) / (256 * km)));
}

/** The longer side of a polygon's box, in rough kilometres. */
function longestSideKm(geometry: Polygonal): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const polygon of polygons) for (const [x, y] of polygon[0]) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  return Math.max((east - west) * k, north - south) * 111.32;
}

/** Length of a line in rough kilometres, and the point halfway along it. */
function midpoint(coords: number[][]): { length: number; point: [number, number] } {
  const km = (a: number[], b: number[]) => {
    const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111.32;
  };
  let length = 0;
  for (let i = 1; i < coords.length; i++) length += km(coords[i - 1], coords[i]);
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const step = km(coords[i - 1], coords[i]);
    if (walked + step >= length / 2 && step > 0) {
      const t = (length / 2 - walked) / step;
      return { length, point: [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t] };
    }
    walked += step;
  }
  return { length, point: [coords[0][0], coords[0][1]] };
}

const MARINE: Record<string, NatureClass> = { ocean: "ocean", sea: "sea", bay: "sea", gulf: "sea", strait: "sea", channel: "sea", sound: "sea", fjord: "sea", lagoon: "sea", inlet: "sea", generic: "sea", reef: "sea", river: "sea" };
const REGIONS: Record<string, NatureClass> = {
  continent: "continent",
  "range/mtn": "range",
  foothills: "range",
  desert: "desert",
  tundra: "desert",
  island: "island",
  "island group": "island",
  plateau: "region",
  plain: "region",
  basin: "region",
  lowland: "region",
  valley: "region",
  depression: "region",
  delta: "region",
  wetlands: "region",
  gorge: "region",
  geoarea: "region",
  "pen/cape": "region",
  peninsula: "region",
  isthmus: "region",
  coast: "region",
  lake: "lake"
};

type NatureRecord = { id: string; kind: "nature"; nature: NatureClass; lat: number; lng: number; country: string; rank: number; minZoom: number; maxZoom: number; population: 0; elevation?: number; names: Record<string, string> };

async function natureLabels(countryOf: (lng: number, lat: number) => string): Promise<NatureRecord[]> {
  const out: NatureRecord[] = [];
  const push = (nature: NatureClass, key: string, lng: number, lat: number, p: Record<string, unknown>, minZoom: number, maxZoom: number, extra: Partial<NatureRecord> = {}) => {
    const n = names(p);
    if (!n.en) return;
    // Water and whole continents belong to no single country: their names follow the chosen language.
    const country = nature === "ocean" || nature === "sea" || nature === "continent" ? "" : countryOf(lng, lat);
    out.push({ id: natureLabelId(nature, key), kind: "nature", nature, lat: round(lat, 4), lng: round(lng, 4), country, rank: valid(p.scalerank) ? Number(p.scalerank) : 9, minZoom: round(minZoom, 1), maxZoom: round(maxZoom, 1), population: 0, names: n, ...extra });
  };

  for (const f of (await load("ne_10m_geography_marine_polys")).features) {
    const p = lower(f.properties ?? {});
    const nature = MARINE[String(p.featurecla ?? "").toLowerCase()];
    if (!nature || !f.geometry || !p.name) continue;
    const [lng, lat] = labelPoint(f.geometry as Polygonal);
    push(nature, String(p.ne_id), lng, lat, p, valid(p.min_label) ? Number(p.min_label) : 4, valid(p.max_label) ? Number(p.max_label) : 9);
  }

  for (const f of (await load("ne_10m_geography_regions_polys")).features) {
    const p = lower(f.properties ?? {});
    const nature = REGIONS[String(p.featurecla ?? "").toLowerCase()];
    const rank = Number(p.scalerank);
    if (!nature || !f.geometry || !p.name || !(rank <= (nature === "island" ? 5 : 6))) continue;
    const [lng, lat] = labelPoint(f.geometry as Polygonal);
    push(nature, String(p.ne_id), lng, lat, p, valid(p.min_label) ? Number(p.min_label) : rank + 1, valid(p.max_label) ? Number(p.max_label) : 11);
  }

  for (const f of (await load("ne_10m_geography_regions_elevation_points")).features) {
    const p = lower(f.properties ?? {});
    const g = f.geometry as GeoJSON.Point | null;
    const rank = Number(p.scalerank);
    const elevation = Number(p.elevation);
    const cls = String(p.featurecla ?? "").toLowerCase();
    if (!g || !p.name || !(rank <= 7) || !(elevation > 0) || (cls !== "mountain" && cls !== "spot elevation")) continue;
    push("peak", String(p.ne_id), g.coordinates[0], g.coordinates[1], p, valid(p.min_zoom) ? Number(p.min_zoom) : rank, 13, { elevation: Math.round(elevation) });
  }

  for (const f of (await load("ne_10m_geography_regions_points")).features) {
    const p = lower(f.properties ?? {});
    const g = f.geometry as GeoJSON.Point | null;
    const cls = String(p.featurecla ?? "").toLowerCase();
    const nature: NatureClass | null = cls === "waterfall" ? "waterfall" : cls === "pole" ? "pole" : cls === "island" && Number(p.scalerank) <= 5 ? "island" : null;
    if (!g || !p.name || !nature) continue;
    push(nature, String(p.ne_id), g.coordinates[0], g.coordinates[1], p, valid(p.min_zoom) ? Number(p.min_zoom) : 5, nature === "pole" ? 8 : 13);
  }

  // A river comes in many pieces; its name goes halfway along its longest piece.
  const rivers = new Map<string, { p: Record<string, unknown>; best: { length: number; point: [number, number] }; rank: number; minLabel: number; total: number }>();
  for (const f of (await load("ne_10m_rivers_lake_centerlines")).features) {
    const p = lower(f.properties ?? {});
    const cls = String(p.featurecla ?? "");
    const rank = Number(p.scalerank);
    if (!p.name || !f.geometry || !(rank <= 8) || (cls !== "River" && cls !== "River (Intermittent)" && cls !== "Canal")) continue;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    // One river can come under several river numbers; its Wikidata id says it is one river.
    const key = valid(p.wikidataid) ? String(p.wikidataid) : `${String(p.name)}:${String(p.rivernum ?? "")}`;
    for (const line of lines) {
      const mid = midpoint(line as number[][]);
      const known = rivers.get(key);
      const minLabel = valid(p.min_label) ? Number(p.min_label) : rank + 1;
      if (!known) rivers.set(key, { p, best: mid, rank, minLabel, total: mid.length });
      else {
        known.total += mid.length;
        if (mid.length > known.best.length) {
          known.best = mid;
          known.p = p;
        }
        known.rank = Math.min(known.rank, rank);
        known.minLabel = Math.min(known.minLabel, minLabel);
      }
    }
  }
  for (const river of rivers.values()) {
    if (river.best.length < 40) continue;
    // Natural Earth gives an arm of a great river the rank of the river (the Sulina branch of the
    // Danube, 70 km, would be named on a globe). A name waits for the zoom at which its river is long
    // enough on screen to carry it: about 200 pixels.
    push("river", String(river.p.ne_id), river.best.point[0], river.best.point[1], { ...river.p, scalerank: river.rank }, Math.max(river.minLabel, zoomForSize(river.total, 200)), 12);
  }

  for (const f of (await load("ne_10m_lakes")).features) {
    const p = lower(f.properties ?? {});
    const rank = Number(p.scalerank);
    const cls = String(p.featurecla ?? "");
    if (!p.name || !f.geometry || !(rank <= (cls === "Reservoir" ? 5 : 7))) continue;
    const [lng, lat] = labelPoint(f.geometry as Polygonal);
    // And a lake for the zoom at which its longest side is about 60 pixels: a long, thin lake such
    // as Baikal is named as early as a round one of the same length.
    push("lake", String(p.ne_id), lng, lat, p, Math.max(valid(p.min_label) ? Number(p.min_label) : rank + 1, zoomForSize(longestSideKm(f.geometry as Polygonal), 60)), 12);
  }
  return out;
}

async function main() {
  const started = Date.now();
  fs.mkdirSync(outDir, { recursive: true });

  const borders = await load("ne_50m_admin_0_boundary_lines_land");
  const bordersOut = {
    type: "FeatureCollection",
    features: borders.features
      .filter((f) => f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"))
      .map((f) => {
        const p = lower(f.properties ?? {});
        const g = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
        return { type: "Feature", properties: { min_zoom: valid(p.min_zoom) ? Number(p.min_zoom) : 0 }, geometry: { type: g.type, coordinates: roundCoordinates(g.coordinates) } };
      })
  };
  const bordersFile = path.join(outDir, "borders.geojson");
  fs.writeFileSync(bordersFile, JSON.stringify(bordersOut));

  const countries = await load("ne_10m_admin_0_countries");
  const countryLabels = countries.features.flatMap((f) => {
    const p = lower(f.properties ?? {});
    const x = Number(p.label_x);
    const y = Number(p.label_y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const code = valid(p.adm0_a3) ? String(p.adm0_a3) : String(p.iso_a3 ?? "");
    return [
      {
        id: `country:${code}:${String(p.name ?? "")}`,
        kind: "country",
        lat: round(y, 4),
        lng: round(x, 4),
        country: code,
        rank: valid(p.labelrank) ? Number(p.labelrank) : 9,
        minZoom: valid(p.min_label) ? Number(p.min_label) : 2,
        maxZoom: valid(p.max_label) ? Number(p.max_label) : 10,
        population: valid(p.pop_est) ? Number(p.pop_est) : 0,
        // [west, south, east, north] of the main land, for "fit to country".
        bbox: mainBbox(f.geometry) ?? undefined,
        names: names(p)
      }
    ];
  });

  const places = await load("ne_10m_populated_places");
  const placeLabels = places.features.flatMap((f) => {
    const p = lower(f.properties ?? {});
    const g = f.geometry as GeoJSON.Point | null;
    const minZoom = valid(p.min_zoom) ? Number(p.min_zoom) : 10;
    if (!g || g.type !== "Point" || minZoom > 8) return [];
    return [
      {
        id: `place:${String(p.ne_id ?? p.wikidataid ?? `${p.nameascii}:${p.adm0_a3}`)}`,
        kind: "place",
        lat: round(g.coordinates[1], 4),
        lng: round(g.coordinates[0], 4),
        country: String(p.adm0_a3 ?? ""),
        region: valid(p.adm1name) ? String(p.adm1name) : undefined,
        capital: String(p.featurecla ?? "").includes("Admin-0 capital"),
        rank: valid(p.scalerank) ? Number(p.scalerank) : 10,
        minZoom,
        population: valid(p.pop_max) ? Number(p.pop_max) : 0,
        names: names(p)
      }
    ];
  });

  const nature = await natureLabels(countryFinder(countries));

  const labelsFile = path.join(outDir, "labels.json");
  fs.writeFileSync(labelsFile, JSON.stringify({ source: "Natural Earth (public domain)", countries: countryLabels, places: placeLabels, nature }));
  const mb = (file: string) => `${(fs.statSync(file).size / 1048576).toFixed(2)} MB`;
  console.log(`borders: ${bordersOut.features.length} lines, ${mb(bordersFile)}`);
  const byClass: Record<string, number> = {};
  for (const record of nature) byClass[record.nature] = (byClass[record.nature] ?? 0) + 1;
  const classes = Object.entries(byClass).map(([k, v]) => k + " " + v).join(", ");
  console.log(`labels: ${countryLabels.length} countries, ${placeLabels.length} places, ${nature.length} natural features (${classes}), ${mb(labelsFile)}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
