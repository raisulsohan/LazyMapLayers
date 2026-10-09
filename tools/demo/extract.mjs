// Extracts the README demo's map data from the offline pack (D91) in the user data folder and from
// the Natural Earth country outlines:
//   .cache/demo/data.json   globe, nearby countries, Bangladesh's districts, OpenStreetMap for the
//                           country (zoom 7 tiles) and for Dhaka (zoom 9 tiles)
//   .cache/demo/sat.jpg     Blue Marble zoom 5 tiles x 23-24, y 13-14, stitched (needs ffmpeg on PATH)
//
//   node tools/demo/extract.mjs
//
// Needs %APPDATA%\LazyMapLayers with offline/world.pmtiles, imagery/blue-marble.pmtiles and
// boundaries/BGD-ADM2.json (the release installer puts them there), and data/generated/countries
// (npm run data:countries). Coordinates are Web Mercator in 2^-22 world units, delta-encoded per ring.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PMTiles } from "pmtiles";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const userData = path.join(process.env.APPDATA ?? path.join(os.homedir(), "Library", "Application Support"), "LazyMapLayers");
const out = path.join(root, ".cache", "demo");
fs.mkdirSync(out, { recursive: true });
const { decodeTile, tilePointToLngLat } = await import(pathToFileURL(path.join(root, "src/core/tiles/mvt.ts")).href);

function openArchive(file) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}: install the release with its offline data first`);
  const fd = fs.openSync(file, "r");
  return new PMTiles({
    getKey: () => file,
    getBytes: async (offset, length) => {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, offset);
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) };
    },
  });
}

const Q = 2 ** 22;
const mx = (lng) => (lng + 180) / 360;
const my = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const toQ = ([lng, lat]) => [Math.round(mx(lng) * Q), Math.round(my(lat) * Q)];
// the tolerance of "px pixels at zoom z" with 512 px tiles, in Q units
const tolAt = (z, px = 0.6) => (px * Q) / (512 * 2 ** z);

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// a closed ring has both ends on one point, so it is split at its farthest point first
function dpRing(pts, tol) {
  let m = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; m = i; }
  }
  if (m === 0) return pts;
  return dp(pts.slice(0, m + 1), tol).concat(dp(pts.slice(m), tol).slice(1));
}
const signedArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
const enc = (pts) => { const o = []; let px = 0, py = 0; for (const [x, y] of pts) { o.push(x - px, y - py); px = x; py = y; } return o; };

function polys(polygons, tol, minArea) {
  const result = [];
  for (const poly of polygons) {
    const rings = [];
    for (const ring of poly) {
      const q = dpRing(ring.map(toQ), tol);
      if (q.length >= 4 && Math.abs(signedArea(q)) >= minArea) rings.push(enc(q));
    }
    if (rings.length) result.push(rings);
  }
  return result;
}

// the globe: every country, coarse
const countryDir = path.join(root, "data/generated/countries");
const readCountry = (id) => JSON.parse(fs.readFileSync(path.join(countryDir, id + ".json"), "utf8"));
const globe = [];
for (const f of fs.readdirSync(countryDir)) {
  const p = polys(readCountry(path.basename(f, ".json")).polygons, tolAt(1.7, 0.8), tolAt(1.7) ** 2 * 60);
  if (p.length) globe.push(p);
}
// the country view: Bangladesh and its neighbours, finer
const region = {};
for (const id of ["BGD", "IND", "MMR", "NPL", "BTN", "CHN"]) {
  const z = id === "BGD" ? 8 : 5.5;
  region[id] = polys(readCountry(id).polygons, tolAt(z), tolAt(z) ** 2 * 6);
}
const adm = JSON.parse(fs.readFileSync(path.join(userData, "boundaries/BGD-ADM2.json"), "utf8"));
const districts = adm.features.map((f) => ({ n: f.name, p: polys(f.polygons, tolAt(7.8), tolAt(7.8) ** 2 * 4) }));

// OpenStreetMap from the offline pack
const world = openArchive(path.join(userData, "offline/world.pmtiles"));
async function tiles(z, [w, s, e, n]) {
  const x0 = Math.floor(mx(w) * 2 ** z), x1 = Math.floor(mx(e) * 2 ** z);
  const y0 = Math.floor(my(n) * 2 ** z), y1 = Math.floor(my(s) * 2 ** z);
  const list = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const t = await world.getZxy(z, x, y);
    if (!t) continue;
    let bytes = new Uint8Array(t.data);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
    list.push({ z, x, y, layers: decodeTile(bytes, ["water", "roads", "places", "landuse"]) });
  }
  return list;
}
const PLACES = new Set(["Dhaka", "Chattogram", "Khulna", "Rajshahi", "Sylhet", "Rangpur", "Barishal", "Mymensingh", "Kolkata", "Cumilla",
  "Tongi", "Savar", "Narayanganj", "Gazipur", "Keraniganj", "Purbachal", "Sonargaon", "Dhamrai", "Rupganj", "Munshiganj"]);

async function osm(z, bbox, displayZoom, { roads, urban = false }) {
  const res = { water: [], roads: {}, urban: [], places: [] };
  const tol = tolAt(displayZoom);
  const seen = new Set();
  // a polygon feature's rings: each outer ring (positive area, y down) starts a new polygon
  const addPolygons = (t, L, f, onPolygon) => {
    let cur = null;
    for (const ring of f.geometry) {
      const q = dpRing(ring.map(([px, py]) => tilePointToLngLat(t.z, t.x, t.y, L.extent, px, py)).map(toQ), tol);
      if (q.length < 4) continue;
      const a = signedArea(q);
      if (a < 0 || !cur) {
        if (Math.abs(a) < tol * tol * 3) { cur = null; continue; }
        cur = onPolygon();
      }
      cur.push(enc(q));
    }
  };
  for (const t of await tiles(z, bbox)) {
    for (const L of t.layers) {
      for (const f of L.features) {
        const kind = String(f.properties.kind ?? "");
        if (L.name === "water" && f.type === 3 && kind === "water") {
          addPolygons(t, L, f, () => { const p = []; res.water.push(p); return p; });
        } else if (L.name === "landuse" && f.type === 3 && urban && ["residential", "commercial", "industrial", "university", "park"].includes(kind)) {
          addPolygons(t, L, f, () => { const u = { k: kind, p: [] }; res.urban.push(u); return u.p; });
        } else if (L.name === "roads" && f.type === 2 && roads.includes(kind)) {
          for (const line of f.geometry) {
            const q = dp(line.map(([px, py]) => tilePointToLngLat(t.z, t.x, t.y, L.extent, px, py)).map(toQ), tol);
            if (q.length >= 2) (res.roads[kind] ??= []).push(enc(q));
          }
        } else if (L.name === "places" && f.type === 1) {
          const name = String(f.properties["name:en"] ?? f.properties.name ?? "");
          if (!PLACES.has(name) || seen.has(name)) continue;
          const [px, py] = f.geometry[0][0];
          const ll = tilePointToLngLat(t.z, t.x, t.y, L.extent, px, py);
          if (ll[0] < bbox[0] || ll[0] > bbox[2] || ll[1] < bbox[1] || ll[1] > bbox[3]) continue;
          seen.add(name);
          res.places.push({ n: name, q: toQ(ll) });
        }
      }
    }
  }
  return res;
}

const country = await osm(7, [87.6, 20.4, 93.0, 26.8], 6.6, { roads: ["highway", "major_road"] });
const city = await osm(9, [89.9, 23.35, 90.95, 24.2], 9.9, { roads: ["highway", "major_road", "medium_road", "minor_road"], urban: true });
const data = { Q, globe, region, districts, country, city };
fs.writeFileSync(path.join(out, "data.json"), JSON.stringify(data));

// Blue Marble around the Bay of Bengal: four zoom 5 tiles (512 px, WebP), stitched with ffmpeg
const marble = openArchive(path.join(userData, "imagery/blue-marble.pmtiles"));
const tileFiles = [];
for (const [x, y] of [[23, 13], [24, 13], [23, 14], [24, 14]]) {
  const t = await marble.getZxy(5, x, y);
  const file = path.join(out, `marble-${x}-${y}.webp`);
  fs.writeFileSync(file, Buffer.from(t.data));
  tileFiles.push(file);
}
execFileSync("ffmpeg", ["-v", "error", "-y", ...tileFiles.flatMap((f) => ["-i", f]),
  "-filter_complex", "[0][1][2][3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0", "-q:v", "5", path.join(out, "sat.jpg")]);

const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0) + " KB";
console.log(`data.json ${kb(data)} (globe ${kb(globe)}, region ${kb(region)}, districts ${kb(districts)}, country ${kb(country)}, city ${kb(city)}); places ${country.places.length} + ${city.places.length}; sat.jpg written`);
