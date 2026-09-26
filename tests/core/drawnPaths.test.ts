import { strict as assert } from "node:assert";
import test from "node:test";
import type { View } from "../../src/core/camera/camera.ts";
import { projectPoint, unprojectPoint, type MapProjection } from "../../src/core/camera/globe.ts";
import { drawnPathsToGeoJson, intoTransform, samplePath, throughTransform, type DrawnPath, type Transform2D } from "../../src/core/geo/drawnPaths.ts";

const viewport = { width: 1920, height: 1080 };
const close = (a: number, b: number, slack: number, what: string) => assert.ok(Math.abs(a - b) <= slack, `${what}: ${a} against ${b}`);

test("a ground point comes back from its pixel, on the flat map, the globe and in between", () => {
  const cases: [View, MapProjection][] = [
    [{ center: { lat: 23.7, lng: 90.4 }, zoom: 9, bearing: 25, pitch: 50 }, "mercator"],
    [{ center: { lat: 20, lng: 80 }, zoom: 2.2, bearing: -15, pitch: 35 }, "globe"],
    [{ center: { lat: 48, lng: 11 }, zoom: 7.4, bearing: 10, pitch: 40 }, "globe"],
    [{ center: { lat: -33, lng: 151 }, zoom: 11, bearing: 0, pitch: 0 }, "globe"]
  ];
  for (const [view, projection] of cases) {
    const reach = 40 / Math.pow(2, view.zoom);
    let checked = 0;
    for (let i = 0; i < 25; i++) {
      const point = { lat: view.center.lat + ((i % 5) - 2) * reach, lng: view.center.lng + (Math.floor(i / 5) - 2) * reach };
      const p = projectPoint(view, viewport, point, { projection });
      if (!p.visible || p.x < 0 || p.y < 0 || p.x > viewport.width || p.y > viewport.height) continue;
      const back = unprojectPoint(view, viewport, p, { projection });
      assert.ok(back, `no ground under ${JSON.stringify(p)} at zoom ${view.zoom}`);
      close(back.lat, point.lat, 1e-4, `latitude at zoom ${view.zoom}`);
      close(back.lng, point.lng, 1e-4, `longitude at zoom ${view.zoom}`);
      checked++;
    }
    assert.ok(checked >= 15, `only ${checked} points in view at zoom ${view.zoom}`);
  }
});

test("the sky and the space around a globe have no ground", () => {
  const globe: View = { center: { lat: 0, lng: 0 }, zoom: 1, bearing: 0, pitch: 0 };
  assert.equal(unprojectPoint(globe, viewport, { x: 5, y: 5 }, { projection: "globe" }), null);
  const tilted: View = { center: { lat: 40, lng: -74 }, zoom: 10, bearing: 0, pitch: 80 };
  assert.equal(unprojectPoint(tilted, viewport, { x: 960, y: 2 }, { projection: "mercator" }), null);
});

test("a point goes through a transform and back", () => {
  const t: Transform2D = { anchor: [30, -12], position: [960, 540], scale: [50, 200], rotation: 33 };
  const p = throughTransform(t, [100, 40]);
  const back = intoTransform(t, p);
  close(back[0], 100, 1e-9, "x");
  close(back[1], 40, 1e-9, "y");
  const turned = throughTransform({ anchor: [0, 0], position: [960, 540], scale: [50, 50], rotation: 90 }, [100, 0]);
  close(turned[0], 960, 1e-9, "a quarter turn keeps x");
  close(turned[1], 590, 1e-9, "and moves y by half of 100");
});

const straight = (points: number[][], closed = false, chain: Transform2D[] = []): DrawnPath => ({
  name: "Path",
  closed,
  vertices: points,
  inTangents: points.map(() => [0, 0]),
  outTangents: points.map(() => [0, 0]),
  chain
});

test("a drawn curve is cut into short steps where it lies on screen", () => {
  const line = samplePath(straight([[0, 0], [120, 0]], false, [{ anchor: [0, 0], position: [960, 540], scale: [100, 100], rotation: 0 }]), null, 6);
  assert.equal(line.length, 21);
  assert.deepEqual(line[0], [960, 540]);
  assert.deepEqual(line[20], [1080, 540]);
  // A bezier half circle of radius 100 stays about 100 from its centre.
  const k = 55.23;
  const arc: DrawnPath = { name: "Arc", closed: false, vertices: [[-100, 0], [0, -100], [100, 0]], inTangents: [[0, 0], [-k, 0], [0, -k]], outTangents: [[0, -k], [k, 0], [0, 0]], chain: [] };
  for (const [x, y] of samplePath(arc, null, 4)) close(Math.hypot(x, y), 100, 0.5, "on the arc");
  // A closed square does not repeat its first point.
  const ring = samplePath(straight([[0, 0], [60, 0], [60, 60], [0, 60]], true), null, 6);
  assert.equal(ring.length, 40);
  assert.notDeepEqual(ring[ring.length - 1], ring[0]);
});

test("a path drawn over the map becomes the line and the area under it", () => {
  const view: View = { center: { lat: 23.7, lng: 90.4 }, zoom: 8, bearing: 20, pitch: 30 };
  const dhaka = { lat: 23.81, lng: 90.41 };
  const narayanganj = { lat: 23.62, lng: 90.5 };
  const a = projectPoint(view, viewport, dhaka);
  const b = projectPoint(view, viewport, narayanganj);
  // The map layer sits in a scene twice its size, scaled to 50 % at the scene's centre; the shape
  // layer's origin is the scene's top left.
  const mapLayer: Transform2D = { anchor: [960, 540], position: [1920, 1080], scale: [50, 50], rotation: 0 };
  const toScene = (p: { x: number; y: number }) => throughTransform(mapLayer, [p.x, p.y]);
  const layer: Transform2D = { anchor: [0, 0], position: [0, 0], scale: [100, 100], rotation: 0 };
  const found = {
    time: 1,
    view,
    width: viewport.width,
    height: viewport.height,
    mapLayer,
    paths: [
      { ...straight([toScene(a), toScene(b)], false, [layer]), name: "Road" },
      { ...straight([toScene(a), toScene(b), toScene({ x: a.x, y: b.y })], true, [layer]), name: "Field" }
    ],
    skipped: []
  };
  const { collection, offGround } = drawnPathsToGeoJson(found, "mercator");
  assert.deepEqual(offGround, []);
  assert.equal(collection.features.length, 2);
  const road = collection.features[0].geometry;
  assert.equal(road.type, "LineString");
  const coords = road.coordinates as number[][];
  close(coords[0][0], dhaka.lng, 1e-4, "starts at Dhaka");
  close(coords[0][1], dhaka.lat, 1e-4, "starts at Dhaka");
  close(coords[coords.length - 1][1], narayanganj.lat, 1e-4, "ends at Narayanganj");
  const field = collection.features[1].geometry;
  assert.equal(field.type, "Polygon");
  const ring = (field.coordinates as number[][][])[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("a path drawn on the sky is reported, not made up", () => {
  const view: View = { center: { lat: 40, lng: -74 }, zoom: 10, bearing: 0, pitch: 80 };
  const found = { time: 0, view, width: 1920, height: 1080, mapLayer: null, paths: [{ ...straight([[100, 2], [1800, 3]]), name: "Sky" }], skipped: [] };
  const { collection, offGround } = drawnPathsToGeoJson(found, "mercator");
  assert.equal(collection.features.length, 0);
  assert.deepEqual(offGround, ["Sky"]);
});
