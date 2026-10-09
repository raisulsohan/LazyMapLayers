import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceOf, routePathExpression, travellerExpressions } from "../../src/core/ae/labelExpressions.ts";
import { float32 } from "../../src/core/ae/pinExpressions.ts";
import { project, type View, type Viewport } from "../../src/core/camera/camera.ts";
import { projectPoint } from "../../src/core/camera/globe.ts";
import { greatCircle } from "../../src/core/geo/greatCircle.ts";
import { lineReferenceLongitude } from "../../src/core/geo/mercator.ts";
import { importGeoJson } from "../../src/core/data/importLines.ts";
import { lineLengthKm, simplifyLine, simplifyPolygons } from "../../src/core/geo/simplify.ts";

const hd: Viewport = { width: 1920, height: 1080 };

/** Evaluates an expression the way After Effects does: the last statement is the result. */
function evaluate(code: string, own: Record<string, number>, view: View, value: unknown) {
  const mapEffects: Record<string, number> = { Latitude: float32(view.center.lat), Longitude: float32(view.center.lng), Zoom: float32(view.zoom), Bearing: float32(view.bearing), Pitch: float32(view.pitch) };
  const effect = (name: string) => (index: number) => {
    assert.equal(index, 1);
    if (name === "Map") {
      return {
        source: { width: hd.width, height: hd.height },
        effect: (n: string) => () => {
          if (!(n in mapEffects)) throw new Error(`no map control ${n}`);
          return { value: mapEffects[n] };
        },
        toComp: (p: number[]) => [p[0], p[1], 0]
      };
    }
    if (!(name in own)) throw new Error(`unknown effect ${name}`);
    return { value: own[name] };
  };
  // A 2D map layer and route layer at the comp's origin: toComp and fromComp change nothing.
  const fromComp = (p: number[]) => [p[0], p[1]];
  const createPath = (points: number[][]) => points;
  return new Function("effect", "value", "fromComp", "createPath", "return eval(arguments[4]);")(effect, value, fromComp, createPath, code);
}

test("a traveller moves along the route by its share of the length and faces forward", () => {
  const view: View = { center: { lat: 0.5, lng: 1 }, zoom: 7, bearing: 0, pitch: 0 };
  const rounded: View = { center: { lat: float32(view.center.lat), lng: float32(view.center.lng) }, zoom: float32(view.zoom), bearing: 0, pitch: 0 };
  // East for 2 degrees, then north for 1 degree (close to the equator, so 2 : 1 in length).
  const route = [
    [0, 0, 0],
    [0, 2, 0],
    [1, 2, 0]
  ];
  const e = travellerExpressions(route);
  const at = (progress: number) => evaluate(e.position, { Progress: progress, "Rotate along Route": 1 }, view, [0, 0]) as number[];
  const expected = (lat: number, lng: number) => project(rounded, hd, { lat, lng });
  for (const [progress, lat, lng] of [
    [0, 0, 0],
    [100, 1, 2],
    [33.3333, 0, 1]
  ]) {
    const got = at(progress);
    const want = expected(lat, lng);
    assert.ok(Math.abs(got[0] - want.x) < 0.2 && Math.abs(got[1] - want.y) < 0.2, `progress ${progress}: ${got} vs ${want.x}, ${want.y}`);
  }
  const rotation = (progress: number, on = 1) => evaluate(e.rotation, { Progress: progress, "Rotate along Route": on }, view, 10) as number;
  assert.ok(Math.abs(rotation(20) - 10) < 0.01, `eastwards is 0 degrees plus the layer's own 10: ${rotation(20)}`);
  assert.ok(Math.abs(rotation(90) - (10 - 90)) < 0.5, `northwards is -90 degrees: ${rotation(90)}`);
  assert.equal(rotation(90, 0), 10, "rotation stays the layer's own when the checkbox is off");
  assert.equal(evaluate(e.opacity, { Progress: 50, "Rotate along Route": 1 }, view, 80), 80);
  for (const code of [e.position, e.rotation, e.opacity]) assert.ok(!/\b(const|let)\b|=>|`/.test(code), "ES3 only");
});

test("simplifying keeps the ends and the shape, within the point budget", () => {
  const wiggly = Array.from({ length: 5000 }, (_, i) => ({ lng: 90 + i * 0.001, lat: 23 + Math.sin(i / 300) * 0.5 + Math.sin(i * 1.7) * 0.00002 }));
  const light = simplifyLine(wiggly, 200);
  assert.ok(light.length <= 200 && light.length > 20, `points: ${light.length}`);
  assert.deepEqual(light[0], wiggly[0]);
  assert.deepEqual(light[light.length - 1], wiggly[wiggly.length - 1]);
  assert.ok(Math.abs(lineLengthKm(light) - lineLengthKm(wiggly)) / lineLengthKm(wiggly) < 0.01, "the length barely changes");
  assert.equal(simplifyLine(wiggly.slice(0, 50), 200).length, 50, "short lines come back as they are");
  const across = simplifyLine(Array.from({ length: 400 }, (_, i) => ({ lng: ((175 + i * 0.05 + 180) % 360) - 180, lat: -17 })), 50);
  for (let i = 1; i < across.length; i++) assert.ok(Math.abs(across[i].lng - across[i - 1].lng) < 30, "continuous across the antimeridian");
});

test("GeoJSON becomes lines and places, with names, times and sensible order", () => {
  const data = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { name: "Dhaka" }, geometry: { type: "Point", coordinates: [90.4, 23.8] } },
      {
        type: "Feature",
        properties: { name: "Morning ride", coordinateProperties: { times: ["2026-01-01T06:00:00Z", "2026-01-01T06:10:00Z", "2026-01-01T06:30:00Z"] } },
        geometry: { type: "LineString", coordinates: [[90.4, 23.8, 5], [90.5, 23.9, 6], [90.7, 24.0, 8]] }
      },
      { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[0, 0], [10, 0]], [[0, 1], [0, 1], [1, 1]]] } },
      { type: "Feature", properties: { NAME: "Square" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.4]]] } },
      { type: "Feature", properties: null, geometry: { type: "LineString", coordinates: [[5, 5]] } },
      { type: "Feature", properties: null, geometry: null }
    ]
  };
  const result = importGeoJson(data, "trip.geojson");
  // A place keeps the properties its file gave it, for the feature browser to filter on.
  assert.deepEqual(result.places, [{ name: "Dhaka", lng: 90.4, lat: 23.8, props: { name: "Dhaka" } }]);
  assert.deepEqual(
    result.lines.map((l) => [l.name, l.points.length, l.closed]),
    [
      ["trip 3 (1)", 2, false],
      ["Square", 5, true],
      ["trip 3 (2)", 2, false],
      ["Morning ride", 3, false]
    ]
  );
  assert.deepEqual(result.lines[3].times, [0, 600, 1800]);
  assert.equal(result.skipped, 2);
  assert.deepEqual(importGeoJson({ type: "LineString", coordinates: [[1, 2], [3, 4]] }, "bare.json").lines[0].name, "bare");
  assert.deepEqual(importGeoJson("nonsense"), { lines: [], places: [], areas: [], skipped: 0 });
  // Polygons are also kept whole, as areas that can be highlighted.
  assert.equal(result.areas.length, 1);
  assert.equal(result.areas[0].name, "Square");
  assert.deepEqual([result.areas[0].polygons.length, result.areas[0].polygons[0].length, result.areas[0].points], [1, 2, 9]);
  assert.deepEqual(result.areas[0].bbox, [0, 0, 1, 1]);
});

test("areas are thinned within a point budget, keep their outer rings and stay closed", () => {
  const circle = (cx: number, cy: number, r: number, n: number) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * (i % n)) / n), cy + r * Math.sin((2 * Math.PI * (i % n)) / n)]);
  const polygons = [[circle(90, 23, 2, 4000), circle(90, 23, 0.5, 1000)], [circle(95, 20, 0.01, 12)], [circle(80, 25, 1, 2000)]];
  const light = simplifyPolygons(polygons, 600);
  const count = light.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0);
  assert.ok(count <= 640 && count > 200, `points: ${count}`);
  assert.equal(light.length, 2, "the speck of an island is dropped");
  assert.equal(light[0].length, 2, "the large hole stays");
  for (const polygon of light) for (const ring of polygon) assert.deepEqual(ring[0], ring[ring.length - 1], "rings stay closed");
  assert.deepEqual(simplifyPolygons([], 100), []);
  // A single small polygon always survives.
  assert.equal(simplifyPolygons([[circle(1, 1, 0.001, 8)]], 600).length, 1);
});

test("a Tokyo to Los Angeles flow is one arc over the Pacific on a flat world map", () => {
  const tokyo = { lat: 35.6762, lng: 139.6503 };
  const losAngeles = { lat: 34.0522, lng: -118.2437 };
  // The points a flow layer bakes (Numbers sheet > Draw flows): the great circle with a low arc.
  const route = greatCircle(tokyo, losAngeles, 64, 0.08).map((p) => [p.lat, p.lng, p.altitude, 0]);
  const ref = referenceOf(route);
  assert.ok(Math.abs(ref - lineReferenceLongitude(route.map((p) => p[1]))) < 1e-6);
  assert.ok(ref > 180 && ref < 200, `the line is placed by its middle, over the Pacific east of 180: ${ref}`);
  const route3 = route.map((p) => p.slice(0, 3));
  const traveller = travellerExpressions(route3);

  // A world view on Greenwich (the line lies near the edge of the world, beside a world copy) and one
  // on the Pacific (the line in the middle of the frame); the map is flat (Globe off).
  for (const lng of [0, 10, -60, 150, 179.9, -179.9]) {
    const view: View = { center: { lat: 20, lng }, zoom: 1.6, bearing: 0, pitch: 0 };
    const rounded: View = { center: { lat: float32(view.center.lat), lng: float32(view.center.lng) }, zoom: float32(view.zoom), bearing: 0, pitch: 0 };
    const worldWidth = 512 * 2 ** rounded.zoom;
    const path = evaluate(routePathExpression(route), {}, view, null) as number[][];
    assert.equal(path.length, route.length);
    for (let i = 0; i < path.length; i++) {
      // Every point equals the core projection on the world copy chosen for the whole line (the baked
      // points are rounded to 6 decimals).
      const want = projectPoint(rounded, hd, { lat: route[i][0], lng: route[i][1] }, { altitudeMeters: route[i][2], referenceLng: ref });
      assert.ok(Math.abs(path[i][0] - want.x) < 1e-3 && Math.abs(path[i][1] - want.y) < 1e-3, `camera at ${lng}, point ${i}: ${path[i]} vs ${want.x}, ${want.y}`);
      if (i === 0) continue;
      // Eastwards in small steps: no stroke across the whole map at ±180.
      const step = path[i][0] - path[i - 1][0];
      assert.ok(step > 0 && step < worldWidth / 40, `camera at ${lng}, point ${i}: a step of ${step} px`);
    }
    // Tokyo and Los Angeles land on the same world copy: about 102 degrees apart, east of Tokyo.
    const span = path[path.length - 1][0] - path[0][0];
    assert.ok(Math.abs(span / worldWidth - (360 - 139.6503 - 118.2437) / 360) < 0.01, `camera at ${lng}: span ${span} px`);
    // The line sits on the copy nearest the camera, so its middle is within half a world of the centre.
    const middle = (path[0][0] + path[path.length - 1][0]) / 2;
    assert.ok(Math.abs(middle - hd.width / 2) <= worldWidth / 2 + 1, `camera at ${lng}: middle at ${middle}`);

    // The traveller rides the same line.
    const at = (progress: number) => evaluate(traveller.position, { Progress: progress, "Rotate along Route": 1 }, view, [0, 0]) as number[];
    const start = at(0);
    const end = at(100);
    assert.ok(Math.abs(start[0] - path[0][0]) < 0.01 && Math.abs(end[0] - path[path.length - 1][0]) < 0.01, `camera at ${lng}: traveller ends ${start}, ${end}`);
    const halfway = at(50);
    assert.ok(halfway[0] > path[0][0] && halfway[0] < path[path.length - 1][0], `camera at ${lng}: traveller halfway at ${halfway}`);
  }
});

test("a line given in wrapped longitudes is unwrapped before it is drawn", () => {
  // An imported track that crosses ±180 as GeoJSON stores it: 179 then -179.
  const track = [
    [-17, 177, 0],
    [-17.5, 179, 0],
    [-18, -179, 0],
    [-18.5, -177, 0]
  ];
  const view: View = { center: { lat: 0, lng: 0 }, zoom: 1.6, bearing: 0, pitch: 0 };
  const path = evaluate(routePathExpression(track), {}, view, null) as number[][];
  for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i][0] - path[i - 1][0]) < 20, `step ${i}: ${path[i - 1]} to ${path[i]}`);
  assert.equal(referenceOf([[0, 170], [0, 190]]), 180);
});
