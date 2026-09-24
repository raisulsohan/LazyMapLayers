// Writes .cache/expression-fixtures.js: every kind of generated After Effects expression, with
// random inputs and the result a modern engine (Node) gives. tools/check-expressions.js then runs the
// same expressions in Windows Script Host's JScript, an ES3 engine like After Effects' Legacy
// ExtendScript expression engine, and compares.
//
//   node tools/expression-fixtures.ts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cameraRigExpressions, groundFrameFor, pin3dPositionExpression } from "../src/core/ae/cameraRig.ts";
import { anchoredPositionExpression, leaderPathExpression, routePathExpression, travellerExpressions } from "../src/core/ae/labelExpressions.ts";
import { float32, pinExpressions } from "../src/core/ae/pinExpressions.ts";
import { lodPathExpression, shapePathExpressions, shapeRings } from "../src/core/ae/shapeExpressions.ts";
import { froundSource } from "../src/core/ae/projectionExpression.ts";
import { minimapBoxExpression, northRotationExpression, scaleBarPathExpression, scaleBarTextExpression } from "../src/core/ae/mapFurniture.ts";
import type { View } from "../src/core/camera/camera.ts";
import { greatCircle } from "../src/core/geo/greatCircle.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".cache", "expression-fixtures.js");

type Env = {
  own: Record<string, number | "MAP">;
  parentOwn?: Record<string, number | "MAP">;
  map: { width: number; height: number; scale: number; controls: Record<string, number>; toComp: number[] };
  comp: { width: number; height: number };
  value: unknown;
};
type Fixture = { name: string; code: string; env: Env; expected: (number | string)[]; tolerance: number };

const source = fs.readFileSync(path.join(root, "tools", "expression-env.js"), "utf8");
const fake = new Function(`${source}\nreturn { run: lmlRunExpression, flatten: lmlFlatten };`)() as {
  run: (code: string, env: Env) => unknown;
  flatten: (result: unknown) => (number | string)[];
};

let seed = 20260917;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const fixtures: Fixture[] = [];
function add(name: string, code: string, env: Env, tolerance = 1e-7) {
  const expected = fake.flatten(fake.run(code, env));
  if (expected.some((v) => typeof v === "number" && !Number.isFinite(v))) throw new Error(`${name}: non-finite result`);
  fixtures.push({ name, code, env, expected, tolerance });
}

function randomView(globe: boolean): View {
  return {
    center: { lat: float32(random() * 150 - 75), lng: float32(random() * 360 - 180) },
    zoom: float32(globe ? random() * 9 : random() * 17),
    bearing: float32(random() * 360 - 180),
    pitch: float32(random() * 70)
  };
}

function mapFor(view: View, globe: boolean, extra: Record<string, number> = {}) {
  const hd = random() < 0.5;
  const controls: Record<string, number> = {
    Latitude: view.center.lat,
    Longitude: view.center.lng,
    Zoom: view.zoom,
    Bearing: view.bearing,
    Pitch: view.pitch,
    ...extra
  };
  if (globe) controls.Globe = 1;
  const scale = random() < 0.5 ? 1 : 0.5 + random();
  return {
    width: hd ? 1920 : 3840,
    height: hd ? 1080 : 2160,
    scale,
    controls,
    toComp: [scale, 0.1 * (random() - 0.5), random() * 50, 0.1 * (random() - 0.5), scale, random() * 50]
  };
}

const near = (view: View, spread: number) => ({
  lat: Math.max(-80, Math.min(80, view.center.lat + (random() - 0.5) * spread)),
  lng: view.center.lng + (random() - 0.5) * spread
});

// Float32 rounding, including halfway cases and subnormals (overflow is in the unit tests: JSON has no Infinity).
for (const x of [0, -0, 1, -1, 0.1, 48.8583701, -73.9856644, 16777217, 16777219, 1e-40, -1e-45, 3.4028234663852886e38, 3.4028235e38, 5e-324, 2.5, 1 + 2 ** -24, 1 + 3 * 2 ** -25]) {
  add(`fround ${x}`, `${froundSource()}lmlFround(${x === 0 && 1 / x < 0 ? "-0" : String(x)});`, { own: {}, map: mapFor(randomView(false), false), comp: { width: 1920, height: 1080 }, value: 0 }, 0);
}
for (let i = 0; i < 40; i++) {
  const x = (random() - 0.5) * 10 ** (Math.floor(random() * 82) - 45);
  add(`fround random ${i}`, `${froundSource()}lmlFround(${x});`, { own: {}, map: mapFor(randomView(false), false), comp: { width: 1920, height: 1080 }, value: 0 }, 0);
}

for (const globe of [false, true]) {
  const kind = globe ? "globe" : "mercator";
  for (let i = 0; i < 24; i++) {
    const view = randomView(globe);
    const map = mapFor(view, globe);
    const spread = 40 / 2 ** Math.max(0, view.zoom - 1);
    const pin = near(view, spread);
    const moved = i % 6 === 5;
    const own = {
      Map: "MAP" as const,
      Latitude: float32(moved ? pin.lat + 0.5 : pin.lat),
      Longitude: float32(pin.lng),
      "Scale with Map": i % 2,
      "Rotate with Map": (i >> 1) % 2,
      "Reference Zoom": Math.floor(random() * 12)
    };
    const comp = { width: map.width, height: map.height };
    const e = pinExpressions(pin.lat, pin.lng);
    add(`pin position ${kind} ${i}`, e.position, { own, map, comp, value: i % 3 === 0 ? [0, 0, -40] : [0, 0] });
    add(`pin scale ${kind} ${i}`, e.scale, { own, map, comp, value: i % 3 === 0 ? [100, 100, 100] : [100, 100] });
    add(`pin rotation ${kind} ${i}`, e.rotation, { own, map, comp, value: 5 });
    add(`pin opacity ${kind} ${i}`, e.opacity, { own, map, comp, value: 80 });

    // The map's furniture reads the same view: a bar that measures itself, and an arrow that finds north.
    const units = i % 2 ? "imperial" : "metric";
    const barLength = 120 + i * 9;
    add(`scale bar path ${kind} ${i}`, scaleBarPathExpression(barLength, units, 8), { own: { Map: "MAP" }, map, comp, value: null });
    add(`scale bar text ${kind} ${i}`, scaleBarTextExpression(barLength, units), { own: { Map: "MAP" }, map, comp, value: "" }, 0);
    add(`north arrow ${kind} ${i}`, northRotationExpression(), { own: { Map: "MAP" }, map, comp, value: 0 }, 1e-5);
    // The box on an inset map: here the inset and the map it follows are the same one, which draws
    // the inset's own frame - the maths the ES3 engine has to agree on is the same.
    add(`minimap box ${kind} ${i}`, minimapBoxExpression(), { own: { Map: "MAP", "Main map": "MAP" }, map, comp, value: null });

    const label = near(view, spread);
    add(`label ${kind} ${i}`, anchoredPositionExpression(label.lat, label.lng, (random() - 0.5) * 80, -30 * random()), { own: { Map: "MAP" }, map, comp, value: [0, 0] });
    add(`leader ${kind} ${i}`, leaderPathExpression(label.lat, label.lng, 40, -60, i % 2 ? 120 : -120), { own: { Map: "MAP" }, map, comp, value: null });

    const a = near(view, spread * 4);
    const b = near(view, spread * 4);
    const route = greatCircle({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }, 24, globe ? 400000 : 0).map((p) => [p.lat, p.lng, p.altitude]);
    add(`route ${kind} ${i}`, routePathExpression(route), { own: { Map: "MAP" }, map, comp, value: null });
    const traveller = travellerExpressions(route);
    const travellerOwn = { Map: "MAP" as const, Progress: float32(random() * 100), "Rotate along Route": i % 2 };
    add(`traveller position ${kind} ${i}`, traveller.position, { own: travellerOwn, map, comp, value: [0, 0] });
    add(`traveller rotation ${kind} ${i}`, traveller.rotation, { own: travellerOwn, map, comp, value: 10 }, 1e-5);
    add(`traveller opacity ${kind} ${i}`, traveller.opacity, { own: travellerOwn, map, comp, value: 90 });

    // A feature as a shape layer: one closed path per ring, with a hole inside the outer ring, and the
    // rings on 3D terrain every third time.
    const centre = near(view, spread);
    const radius = spread / 4;
    const circle = (r: number) => Array.from({ length: 24 }, (_, k) => [centre.lng + r * Math.cos((k / 24) * 2 * Math.PI), centre.lat + r * Math.sin((k / 24) * 2 * Math.PI)]);
    const lifted = i % 3 === 0;
    const outline = shapePathExpressions(shapeRings([[[...circle(radius), [centre.lng + radius, centre.lat]], circle(radius / 3)]], () => (lifted ? 1500 : 0)));
    const shapeMap = mapFor(view, globe, { "Terrain Height": lifted ? 1.4 : 0, "Ground Level": 500 });
    outline.forEach((code, part) => add(`shape ring ${part} ${kind} ${i}`, code, { own: { Map: "MAP" }, map: shapeMap, comp: { width: shapeMap.width, height: shapeMap.height }, value: null }));
    // The same outline with two levels of detail: the coarse ring below the switch zoom, the fine one above.
    const coarseRing = shapeRings([[[...circle(radius), [centre.lng + radius, centre.lat]]]], () => (lifted ? 1500 : 0))[0];
    const fineRing = shapeRings([[[...circle(radius).flatMap((p, k, all) => [p, [(p[0] + all[(k + 1) % all.length][0]) / 2, (p[1] + all[(k + 1) % all.length][1]) / 2]]), [centre.lng + radius, centre.lat]]]], () => (lifted ? 1500 : 0))[0];
    const levelled = lodPathExpression(coarseRing, fineRing, view.zoom + (i % 2 ? 0.5 : -0.5));
    add(`shape levels ${i % 2 ? "coarse" : "fine"} ${kind} ${i}`, levelled, { own: { Map: "MAP" }, map: shapeMap, comp: { width: shapeMap.width, height: shapeMap.height }, value: null });
  }
}

// 3D terrain: the map's height and ground level lift pins, labels, leaders, routes and travellers.
for (let i = 0; i < 12; i++) {
  const view = randomView(false);
  const terrain = { "Terrain Height": [0, 1, 1.5, 2.5][i % 4], "Ground Level": [0, 1200, 4300, -20][(i >> 2) % 4] };
  const map = mapFor(view, false, terrain);
  const comp = { width: map.width, height: map.height };
  const spread = 40 / 2 ** Math.max(0, view.zoom - 1);
  const pin = near(view, spread);
  const own = { Map: "MAP" as const, Latitude: float32(pin.lat), Longitude: float32(pin.lng), "Scale with Map": 1, "Rotate with Map": i % 2, "Reference Zoom": 8, "Elevation (m)": random() * 8000 };
  const e = pinExpressions(pin.lat, pin.lng);
  add(`pin position on terrain ${i}`, e.position, { own, map, comp, value: [0, 0] });
  add(`pin rotation on terrain ${i}`, e.rotation, { own, map, comp, value: 5 });
  const label = near(view, spread);
  add(`label on terrain ${i}`, anchoredPositionExpression(label.lat, label.lng, 12, -30, undefined, random() * 5000), { own: { Map: "MAP" }, map, comp, value: [0, 0] });
  add(`leader on terrain ${i}`, leaderPathExpression(label.lat, label.lng, 40, -60, 120, random() * 5000), { own: { Map: "MAP" }, map, comp, value: null });
  const a = near(view, spread * 4);
  const b = near(view, spread * 4);
  const route = greatCircle({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }, 24, 0).map((p, k) => [p.lat, p.lng, p.altitude, 2000 + Math.sin(k) * 1500]);
  add(`route on terrain ${i}`, routePathExpression(route), { own: { Map: "MAP" }, map, comp, value: null });
  const traveller = travellerExpressions(route);
  const travellerOwn = { Map: "MAP" as const, Progress: float32(random() * 100), "Rotate along Route": 1 };
  add(`traveller position on terrain ${i}`, traveller.position, { own: travellerOwn, map, comp, value: [0, 0] });
  add(`traveller rotation on terrain ${i}`, traveller.rotation, { own: travellerOwn, map, comp, value: 10 }, 1e-5);
}

// A route whose start is behind the planet, and one entirely hidden.
{
  const view: View = { center: { lat: 20, lng: 0 }, zoom: 1.5, bearing: 0, pitch: 0 };
  const map = mapFor(view, true);
  const comp = { width: map.width, height: map.height };
  const behind = greatCircle({ lat: 35.68, lng: 139.69 }, { lat: 48.85, lng: 2.35 }, 32, 300000).map((p) => [p.lat, p.lng, p.altitude]);
  add("route starting behind the globe", routePathExpression(behind), { own: { Map: "MAP" }, map, comp, value: null });
  const hidden = greatCircle({ lat: -30, lng: 170 }, { lat: -10, lng: -170 }, 8, 0).map((p) => [p.lat, p.lng, p.altitude]);
  add("route entirely behind the globe", routePathExpression(hidden), { own: { Map: "MAP" }, map, comp, value: null });
}

// 3D camera rig and 3D pins.
for (let i = 0; i < 20; i++) {
  const view = randomView(false);
  const scene = random() < 0.5 ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 };
  const frame = groundFrameFor({ ...view, zoom: view.zoom + (random() - 0.5) * 4 }, scene);
  const map = mapFor(view, false, {
    "3D Origin Latitude": frame.origin.lat,
    "3D Origin Longitude": frame.origin.lng,
    "3D Reference Zoom": frame.referenceZoom
  });
  map.width = scene.width;
  map.height = scene.height;
  const rig = cameraRigExpressions();
  add(`rig target position ${i}`, rig.targetPosition, { own: { Map: "MAP" }, map, comp: scene, value: [0, 0, 0] });
  add(`rig target rotation ${i}`, rig.targetRotationZ, { own: { Map: "MAP" }, map, comp: scene, value: 0 });
  add(`rig camera position ${i}`, rig.cameraPosition, { own: {}, parentOwn: { Map: "MAP" }, map, comp: scene, value: [0, 0, 0] });
  add(`rig camera tilt ${i}`, rig.cameraRotationX, { own: {}, parentOwn: { Map: "MAP" }, map, comp: scene, value: 0 });
  add(`rig camera zoom ${i}`, rig.cameraZoom, { own: {}, parentOwn: { Map: "MAP" }, map, comp: scene, value: 0 });
  const pin = near(view, 20 / 2 ** Math.max(0, view.zoom - 1));
  add(`3D pin ${i}`, pin3dPositionExpression(pin.lat, pin.lng), {
    own: { Map: "MAP", Latitude: float32(i % 5 === 4 ? pin.lat + 0.01 : pin.lat), Longitude: float32(pin.lng), "Altitude (m)": random() * 500 },
    map,
    comp: scene,
    value: [0, 0, 0]
  });
  // The same pin on 3D terrain: the map's height and ground level lift it by its elevation.
  if (i % 2 === 0) {
    const lifted = mapFor(view, false, { "3D Origin Latitude": frame.origin.lat, "3D Origin Longitude": frame.origin.lng, "3D Reference Zoom": frame.referenceZoom, "Terrain Height": 1 + random(), "Ground Level": random() * 3000 });
    lifted.width = scene.width;
    lifted.height = scene.height;
    add(`3D pin on terrain ${i}`, pin3dPositionExpression(pin.lat, pin.lng), {
      own: { Map: "MAP", Latitude: float32(pin.lat), Longitude: float32(pin.lng), "Altitude (m)": random() * 500, "Elevation (m)": random() * 6000 },
      map: lifted,
      comp: scene,
      value: [0, 0, 0]
    });
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `var LML_EXPRESSION_FIXTURES = ${JSON.stringify(fixtures)};\n`, "utf8");
console.log(`wrote ${fixtures.length} expression fixtures to ${path.relative(root, out)}`);
