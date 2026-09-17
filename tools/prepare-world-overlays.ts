// Builds data for animated overlays from the Natural Earth shapefiles in .cache/ne (public domain):
//
//   data/generated/borders.geojson   country borders on land (1:50m) with line metrics, for draw-on
//   data/generated/labels.json       countries and populated places with names in 26 languages
//
//   node tools/prepare-world-overlays.ts

import fs from "node:fs";
import path from "node:path";
import shp from "shpjs";

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

  const labelsFile = path.join(outDir, "labels.json");
  fs.writeFileSync(labelsFile, JSON.stringify({ source: "Natural Earth (public domain)", countries: countryLabels, places: placeLabels }));
  const mb = (file: string) => `${(fs.statSync(file).size / 1048576).toFixed(2)} MB`;
  console.log(`borders: ${bordersOut.features.length} lines, ${mb(bordersFile)}`);
  console.log(`labels: ${countryLabels.length} countries, ${placeLabels.length} places, ${mb(labelsFile)}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
