import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_SAMPLES, minimapBoxExpression, northArrowPath, northRotationExpression, scaleBarPathExpression, scaleBarTextExpression, type ScaleUnits } from "../../src/core/ae/mapFurniture.ts";
import { metersPerPixel } from "../../src/core/geo/mercator.ts";

type View = { lat: number; lng: number; zoom: number; bearing?: number; pitch?: number; globe?: number };
type Placing = { scale?: number; rotation?: number; offset?: [number, number] };

const SOURCE = { width: 1920, height: 1080 };
const COMP = { width: 1920, height: 1080 };

/** A stand-in for the map layer: the controls the expression reads, and a real affine toComp. */
function mapLayer(view: View, placing: Placing = {}) {
  const controls: Record<string, number> = {
    Latitude: view.lat,
    Longitude: view.lng,
    Zoom: view.zoom,
    Bearing: view.bearing ?? 0,
    Pitch: view.pitch ?? 0,
    Globe: view.globe ?? 0
  };
  const scale = placing.scale ?? 1;
  const turn = ((placing.rotation ?? 0) * Math.PI) / 180;
  const [ox, oy] = placing.offset ?? [0, 0];
  return {
    source: SOURCE,
    effect: (name: string) => () => {
      if (!(name in controls)) throw new Error(`no effect ${name}`);
      return { value: controls[name] };
    },
    toComp: (p: number[]) => {
      const x = p[0] * scale;
      const y = p[1] * scale;
      return [ox + x * Math.cos(turn) - y * Math.sin(turn), oy + x * Math.sin(turn) + y * Math.cos(turn)];
    }
  };
}

function run(code: string, view: View, placing: Placing = {}) {
  const map = mapLayer(view, placing);
  const effect = () => () => map;
  const createPath = (points: number[][], _in: unknown, _out: unknown, closed: boolean) => ({ points, closed });
  // After Effects hands back the value of the last statement, which eval does too.
  return new Function("effect", "thisComp", "createPath", "code", "return eval(code);")(effect, COMP, createPath, code);
}

function bar(view: View, units: ScaleUnits = "metric", maxPixels = 240, placing: Placing = {}) {
  const path = run(scaleBarPathExpression(maxPixels, units, 8), view, placing) as { points: number[][]; closed: boolean };
  const text = run(scaleBarTextExpression(maxPixels, units), view, placing) as string;
  return { pixels: path.points[2][0], points: path.points, closed: path.closed, text };
}

const NICE = [1, 2, 5];
function isNice(value: number): boolean {
  const step = Math.pow(10, Math.floor(Math.log10(value) + 1e-9));
  return NICE.some((n) => Math.abs(value - n * step) < 1e-6 * step);
}

test("the bar is a round distance that fits the length it is given", () => {
  for (const zoom of [0, 3, 6, 9, 12, 16, 20]) {
    for (const lat of [0, 23.8, 51.5, -33.9, 71]) {
      const { pixels, text } = bar({ lat, lng: 90, zoom });
      assert.ok(pixels > 0 && pixels <= 240 + 1e-6, `${zoom}/${lat}: ${pixels} px`);
      assert.ok(pixels > 240 / 5.0001, `${zoom}/${lat}: only ${pixels} px of 240`);
      const [shown, unit] = text.split(" ");
      assert.ok(isNice(Number(shown)), `${zoom}/${lat}: ${text} is not a round number`);
      // What it says is what it draws: the metres under the bar are the metres it claims.
      const metres = Number(shown) * (unit === "km" ? 1000 : 1);
      assert.equal(unit === "km" || unit === "m", true, text);
      const real = pixels * metersPerPixel(lat, zoom);
      assert.ok(Math.abs(real - metres) < 1e-6 * metres, `${zoom}/${lat}: ${text} over ${real} m`);
    }
  }
});

test("it says metres up close and kilometres far out", () => {
  assert.equal(bar({ lat: 0, lng: 0, zoom: 1 }).text.split(" ")[1], "km");
  assert.equal(bar({ lat: 0, lng: 0, zoom: 20 }).text.split(" ")[1], "m");
  assert.equal(bar({ lat: 0, lng: 0, zoom: 1 }, "imperial").text.split(" ")[1], "mi");
  assert.equal(bar({ lat: 0, lng: 0, zoom: 20 }, "imperial").text.split(" ")[1], "ft");
  const miles = bar({ lat: 0, lng: 0, zoom: 8 }, "imperial");
  const metres = bar({ lat: 0, lng: 0, zoom: 8 }, "metric");
  assert.ok(Math.abs(Number(miles.text.split(" ")[0]) * 1609.344 - miles.pixels * metersPerPixel(0, 8)) < 1, miles.text);
  assert.notEqual(miles.text, metres.text);
});

test("the bar is a bracket with a tick at each end, open, starting at the anchor", () => {
  const { points, closed } = bar({ lat: 10, lng: 10, zoom: 5 });
  assert.equal(closed, false);
  assert.equal(points.length, 4);
  assert.deepEqual(points[1], [0, 0]);
  assert.deepEqual(points[0], [0, -8]);
  assert.equal(points[3][0], points[2][0]);
  assert.equal(points[3][1], -8);
});

test("a map the user has scaled still tells the truth", () => {
  const full = bar({ lat: 45, lng: 0, zoom: 6 });
  const half = bar({ lat: 45, lng: 0, zoom: 6 }, "metric", 240, { scale: 0.5, rotation: 20, offset: [300, 200] });
  // Half the size on screen means twice the ground under every pixel, and the bar is measured against
  // that, not against the map's zoom alone.
  const fullMetres = Number(full.text.split(" ")[0]) * (full.text.endsWith("km") ? 1000 : 1);
  const halfMetres = Number(half.text.split(" ")[0]) * (half.text.endsWith("km") ? 1000 : 1);
  const ground = metersPerPixel(45, 6);
  assert.ok(Math.abs(fullMetres / full.pixels - ground) < 1e-6 * ground, `${full.text} over ${full.pixels} px`);
  assert.ok(Math.abs(halfMetres / half.pixels - ground * 2) < 1e-6 * ground, `${half.text} over ${half.pixels} px`);
});

test("north turns with the map's bearing, the globe's poles and the layer's own rotation", () => {
  const turn = (view: View, placing?: Placing) => run(northRotationExpression(), view, placing) as number;
  assert.ok(Math.abs(turn({ lat: 20, lng: 0, zoom: 4 })) < 1e-6);
  assert.ok(Math.abs(turn({ lat: 20, lng: 0, zoom: 4, bearing: 35 }) + 35) < 1e-4);
  assert.ok(Math.abs(turn({ lat: 20, lng: 0, zoom: 4, bearing: -110 }) - 110) < 1e-4);
  // The map layer's own rotation carries the arrow with it.
  assert.ok(Math.abs(turn({ lat: 20, lng: 0, zoom: 4, bearing: 35 }, { rotation: 15 }) + 20) < 1e-3);
  // At the centre of the globe north is still the bearing, and away from it the pole bends it.
  assert.ok(Math.abs(turn({ lat: 20, lng: 0, zoom: 2, bearing: 35, globe: 1 }) + 35) < 0.5);
  assert.ok(Math.abs(turn({ lat: 78, lng: 0, zoom: 2, globe: 1 })) < 5);
});

test("the arrow is a kite pointing up, the size it was asked for", () => {
  const points = northArrowPath(40);
  assert.equal(points.length, 4);
  assert.deepEqual(points[0], [0, -20]);
  assert.ok(points[1][0] > 0 && points[3][0] === -points[1][0]);
  assert.ok(points[2][1] < points[1][1], "the tail notch sits above the wings");
  assert.equal(northArrowPath(80)[0][1], -40);
});

/** The box on an inset: the inset is the layer's "Map", the big map is its "Main map". */
function boxOn(inset: View, main: View, mainSize = { width: 1920, height: 1080 }) {
  const insetLayer = mapLayer(inset);
  const mainLayer = { ...mapLayer(main), source: mainSize };
  const effect = (name: string) => () => (name === "Main map" ? mainLayer : insetLayer);
  const createPath = (points: number[][], _in: unknown, _out: unknown, closed: boolean) => ({ points, closed });
  const fromComp = (q: number[]) => q;
  return new Function("effect", "thisComp", "createPath", "fromComp", "code", "return eval(code);")(
    effect,
    COMP,
    createPath,
    fromComp,
    minimapBoxExpression()
  ) as { points: number[][]; closed: boolean };
}

test("the box on an inset is the big map's frame, at the inset's scale", () => {
  const main: View = { lat: 23.8, lng: 90.4, zoom: 8 };
  const box = boxOn({ lat: 23.8, lng: 90.4, zoom: 4 }, main);
  assert.equal(box.closed, true);
  assert.equal(box.points.length, 4 * BOX_SAMPLES);
  const xs = box.points.map((q) => q[0]);
  const ys = box.points.map((q) => q[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  // Four zoom levels out, the big map's frame is a sixteenth of its own size on the inset.
  assert.ok(Math.abs(width - 1920 / 16) < 0.5, `the box is ${width} px wide`);
  assert.ok(Math.abs(height - 1080 / 16) < 0.5, `the box is ${height} px tall`);
  // It sits on the inset's centre, because both maps are looking at the same place.
  assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - SOURCE.width / 2) < 0.5);
  assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - SOURCE.height / 2) < 0.5);
});

test("the box follows the big map away from the inset's centre, and turns with it", () => {
  const inset: View = { lat: 23.8, lng: 90.4, zoom: 4 };
  const east = boxOn(inset, { lat: 23.8, lng: 92.4, zoom: 8 });
  const middle = boxOn(inset, { lat: 23.8, lng: 90.4, zoom: 8 });
  const eastX = east.points.reduce((sum, q) => sum + q[0], 0) / east.points.length;
  const middleX = middle.points.reduce((sum, q) => sum + q[0], 0) / middle.points.length;
  // Two degrees of longitude are 2/360 of the world, which at the inset's zoom is 45.5 px.
  const expected = (2 / 360) * 512 * 2 ** 4;
  assert.ok(Math.abs(eastX - middleX - expected) < 0.5, `the box moved ${eastX - middleX} px, expected ${expected}`);
  // Turned 45 degrees, the same frame covers a wider span of the inset.
  const turned = boxOn(inset, { lat: 23.8, lng: 90.4, zoom: 8, bearing: 45 });
  const span = (points: number[][]) => Math.max(...points.map((q) => q[0])) - Math.min(...points.map((q) => q[0]));
  // Turned 45 degrees, a 120 by 67.5 box spans (120 + 67.5) / root 2 of the inset.
  const corner = (120 + 67.5) / Math.SQRT2;
  assert.ok(Math.abs(span(middle.points) - 120) < 0.5, `flat, the box spans ${span(middle.points)} px`);
  assert.ok(Math.abs(span(turned.points) - corner) < 0.5, `turned, the box spans ${span(turned.points)} px, expected ${corner}`);
});
