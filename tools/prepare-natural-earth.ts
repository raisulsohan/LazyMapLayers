// Builds the offline world basemap (data/generated/natural-earth.pmtiles) from the Natural Earth
// shapefiles in .cache/ne (public domain, https://www.naturalearthdata.com).
//
//   node tools/prepare-natural-earth.ts [--max-zoom 6]
//
// Zoom bands use the scale that fits them: 1:110m for z0-2, 1:50m for z3-4, 1:10m from z5.
// Tiles are Mapbox Vector Tiles (512 px, extent 4096), gzip-compressed.

import fs from "node:fs";
import path from "node:path";
import shp from "shpjs";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { gzipSync } from "fflate";
import { PMTILES_COMPRESSION, PMTILES_TILE_TYPE, PmtilesWriter } from "../src/core/pmtiles/writer.ts";

type Feature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;
type Collection = { type: "FeatureCollection"; features: Feature[] };

const root = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(root, ".cache", "ne");
const outFile = path.join(root, "data", "generated", "natural-earth.pmtiles");
const maxZoomArg = process.argv.indexOf("--max-zoom");
const MAX_ZOOM = maxZoomArg > 0 ? Number(process.argv[maxZoomArg + 1]) : 6;

const LANGUAGES = [
  "ar", "bn", "de", "el", "en", "es", "fa", "fr", "he", "hi", "hu", "id", "it", "ja", "ko", "nl",
  "pl", "pt", "ru", "sv", "tr", "uk", "ur", "vi", "zh", "zht"
];

type Band = { minZoom: number; maxZoom: number; scale: "110m" | "50m" | "10m" };
const BANDS: Band[] = [
  { minZoom: 0, maxZoom: 2, scale: "110m" },
  { minZoom: 3, maxZoom: 4, scale: "50m" },
  { minZoom: 5, maxZoom: MAX_ZOOM, scale: "10m" }
];

type LayerSpec = {
  name: string;
  /** Shapefile base name per scale; a missing scale falls back to the next finer one. */
  files: Partial<Record<Band["scale"], string>>;
  keep: (props: Record<string, unknown>) => Record<string, unknown>;
  transform?: (fc: Collection) => Collection;
  minZoom?: number;
  /** Keeps a feature in tiles of zoom z only when this returns true (one index per zoom). */
  zoomFilter?: (props: Record<string, unknown>, z: number) => boolean;
};

/** Natural Earth's own "min_zoom" (the zoom where cartographers show a feature), with slack. */
const byMinZoom = (slack: number) => (props: Record<string, unknown>, z: number) => {
  const minZoom = Number(props.min_zoom);
  return !Number.isFinite(minZoom) || minZoom <= z + slack;
};

const lower = (props: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k.toLowerCase()] = v;
  return out;
};

const pick = (props: Record<string, unknown>, keys: string[]) => {
  const p = lower(props);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = p[key];
    if (value !== undefined && value !== null && value !== "" && value !== -99 && value !== "-99") out[key] = value;
  }
  for (const lang of LANGUAGES) {
    const value = p[`name_${lang}`];
    if (typeof value === "string" && value.length > 0) out[`name_${lang}`] = value;
  }
  return out;
};

const ringsToLines = (fc: Collection): Collection => ({
  type: "FeatureCollection",
  features: fc.features.flatMap((f): Feature[] => {
    const g = f.geometry;
    if (!g) return [];
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    const lines = polygons.flatMap((rings) => rings);
    return lines.length ? [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }] : [];
  })
});

const countryLabelPoints = (fc: Collection): Collection => ({
  type: "FeatureCollection",
  features: fc.features.flatMap((f): Feature[] => {
    const p = lower(f.properties ?? {});
    const x = Number(p.label_x);
    const y = Number(p.label_y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: [x, y] } }];
  })
});

const LAYERS: LayerSpec[] = [
  { name: "ocean", files: { "110m": "ne_110m_ocean", "50m": "ne_50m_ocean", "10m": "ne_10m_ocean" }, keep: () => ({}) },
  { name: "land", files: { "110m": "ne_110m_land", "50m": "ne_50m_land", "10m": "ne_10m_land" }, keep: () => ({}) },
  {
    name: "coastline",
    files: { "110m": "ne_110m_land", "50m": "ne_50m_land", "10m": "ne_10m_land" },
    keep: () => ({}),
    transform: ringsToLines
  },
  {
    name: "countries",
    files: { "110m": "ne_110m_admin_0_countries", "50m": "ne_50m_admin_0_countries", "10m": "ne_10m_admin_0_countries" },
    keep: (p) => pick(p, ["name", "name_long", "iso_a2", "iso_a3", "adm0_a3", "continent", "subregion", "pop_est", "gdp_md", "mapcolor7", "min_label", "max_label"])
  },
  {
    name: "country_points",
    files: { "110m": "ne_110m_admin_0_countries", "50m": "ne_50m_admin_0_countries", "10m": "ne_10m_admin_0_countries" },
    keep: (p) => pick(p, ["name", "iso_a2", "iso_a3", "adm0_a3", "pop_est", "min_label", "max_label"]),
    transform: countryLabelPoints
  },
  {
    name: "boundaries",
    files: { "50m": "ne_50m_admin_0_boundary_lines_land", "10m": "ne_10m_admin_0_boundary_lines_land" },
    keep: (p) => pick(p, ["featurecla", "min_zoom", "adm0_left", "adm0_right"])
  },
  {
    name: "admin1_lines",
    files: { "10m": "ne_10m_admin_1_states_provinces_lines" },
    keep: (p) => pick(p, ["adm0_name", "adm0_a3", "min_zoom"]),
    minZoom: 4,
    zoomFilter: byMinZoom(1)
  },
  { name: "lakes", files: { "110m": "ne_110m_lakes", "50m": "ne_50m_lakes", "10m": "ne_10m_lakes" }, keep: (p) => pick(p, ["name", "scalerank", "min_zoom"]) },
  {
    name: "rivers",
    files: { "50m": "ne_50m_rivers_lake_centerlines", "10m": "ne_10m_rivers_lake_centerlines" },
    keep: (p) => pick(p, ["name", "scalerank", "featurecla", "min_zoom"]),
    minZoom: 2,
    zoomFilter: byMinZoom(1)
  },
  {
    name: "places",
    files: { "10m": "ne_10m_populated_places" },
    keep: (p) => pick(p, ["name", "nameascii", "featurecla", "scalerank", "min_zoom", "pop_max", "adm0cap", "worldcity", "megacity", "iso_a2", "adm0name", "adm1name"]),
    zoomFilter: byMinZoom(1)
  }
];

const cache = new Map<string, Collection>();
async function load(base: string): Promise<Collection> {
  const hit = cache.get(base);
  if (hit) return hit;
  const zip = fs.readFileSync(path.join(cacheDir, `${base}.zip`));
  const arrayBuffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  const result = (await shp(arrayBuffer)) as Collection | Collection[];
  const fc = Array.isArray(result) ? result[0] : result;
  cache.set(base, fc);
  return fc;
}

function fileForScale(spec: LayerSpec, scale: Band["scale"]): string | undefined {
  const order: Band["scale"][] = scale === "110m" ? ["110m", "50m", "10m"] : scale === "50m" ? ["50m", "10m"] : ["10m"];
  for (const s of order) if (spec.files[s]) return spec.files[s];
  return undefined;
}

async function main() {
  const started = Date.now();
  const writer = new PmtilesWriter();
  const layerStats = new Map<string, number>();
  let rawBytes = 0;

  for (const band of BANDS) {
    if (band.minZoom > MAX_ZOOM) continue;
    const indexes: { name: string; index: GeoJSONVT; minZoom: number; onlyZoom?: number }[] = [];
    for (const spec of LAYERS) {
      const file = fileForScale(spec, band.scale);
      if (!file) continue;
      const source = await load(file);
      const shaped: Collection = {
        type: "FeatureCollection",
        features: source.features
          .filter((f) => f.geometry)
          .map((f) => ({ type: "Feature", geometry: f.geometry, properties: spec.keep(f.properties ?? {}) }))
      };
      // Label points need the original label_x/label_y, so transform before trimming properties.
      const collection = spec.transform
        ? {
            type: "FeatureCollection" as const,
            features: spec.transform(source).features.map((f) => ({ ...f, properties: spec.keep(f.properties ?? {}) }))
          }
        : shaped;
      const options = { maxZoom: band.maxZoom, indexMaxZoom: Math.min(band.maxZoom, 5), tolerance: 3, extent: 4096, buffer: 64 };
      if (spec.zoomFilter) {
        const filter = spec.zoomFilter;
        for (let z = band.minZoom; z <= Math.min(band.maxZoom, MAX_ZOOM); z++) {
          const features = collection.features.filter((f) => filter(f.properties ?? {}, z));
          if (!features.length) continue;
          const index = new GeoJSONVT({ type: "FeatureCollection", features } as GeoJSON.FeatureCollection, options);
          indexes.push({ name: spec.name, index, minZoom: spec.minZoom ?? 0, onlyZoom: z });
        }
      } else {
        indexes.push({ name: spec.name, index: new GeoJSONVT(collection as GeoJSON.FeatureCollection, options), minZoom: spec.minZoom ?? 0 });
      }
    }

    for (let z = band.minZoom; z <= Math.min(band.maxZoom, MAX_ZOOM); z++) {
      const n = 2 ** z;
      let written = 0;
      let largest = 0;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          const layers: Record<string, ReturnType<GeoJSONVT["getTile"]>> = {};
          let hasContent = false;
          for (const { name, index, minZoom, onlyZoom } of indexes) {
            if (z < minZoom || (onlyZoom !== undefined && onlyZoom !== z)) continue;
            const tile = index.getTile(z, x, y);
            if (tile && tile.features.length > 0) {
              layers[name] = tile;
              hasContent = true;
            }
          }
          if (!hasContent) continue;
          const pbf = fromGeojsonVt(layers as Parameters<typeof fromGeojsonVt>[0], { version: 2, extent: 4096 });
          rawBytes += pbf.length;
          for (const name of Object.keys(layers)) layerStats.set(name, (layerStats.get(name) ?? 0) + 1);
          writer.addTile(z, x, y, gzipSync(pbf, { level: 9 }));
          written++;
          largest = Math.max(largest, pbf.length);
        }
      }
      console.log(`z${z}: ${written} tiles, largest ${(largest / 1024).toFixed(0)} KB uncompressed`);
    }
  }

  const vectorLayers = LAYERS.map((l) => ({ id: l.name, fields: {} }));
  const archive = writer.build({
    tileType: PMTILES_TILE_TYPE.mvt,
    tileCompression: PMTILES_COMPRESSION.gzip,
    metadata: {
      name: "LazyMapLayers Natural Earth",
      description: "Offline world basemap built from Natural Earth (public domain).",
      attribution: "Made with Natural Earth",
      format: "pbf",
      minzoom: 0,
      maxzoom: MAX_ZOOM,
      vector_layers: vectorLayers
    },
    center: { lng: 0, lat: 20, zoom: 1 }
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, archive);
  const mb = (bytes: number) => (bytes / 1048576).toFixed(1) + " MB";
  console.log(`layers: ${[...layerStats].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`wrote ${outFile}: ${mb(archive.length)} (uncompressed tiles ${mb(rawBytes)}) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
