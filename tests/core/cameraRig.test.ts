import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraRigExpressions,
  groundFrameFor,
  groundPoint,
  groundUnitsPerMeter,
  pin3dPositionExpression,
  projectThroughRig,
  rigPose,
  PIN3D_MARKER,
  RIG_MARKER,
  type GroundFrame
} from "../../src/core/ae/cameraRig.ts";
import { float32 } from "../../src/core/ae/pinExpressions.ts";
import { project, type View, type Viewport } from "../../src/core/camera/camera.ts";

let seed = 5;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const randomView = (): View => ({
  center: { lng: random() * 340 - 170, lat: random() * 140 - 70 },
  zoom: 1 + random() * 19,
  bearing: random() * 360 - 180,
  pitch: random() * 80
});

/** Map controls as AE stores them (float32 sliders). */
const float32View = (view: View): View => ({
  center: { lat: float32(view.center.lat), lng: float32(view.center.lng) },
  zoom: float32(view.zoom),
  bearing: float32(view.bearing),
  pitch: float32(view.pitch)
});

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 }
] as Viewport[]) {
  test(`the camera rig reproduces the map projection at ${viewport.width}x${viewport.height}`, () => {
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const view = randomView();
      // The rig is usually built at one view and then animated: shift the zoom away from the frame's.
      const frame = groundFrameFor({ ...view, zoom: Math.max(0, view.zoom + (random() - 0.5) * 6) }, viewport);
      const pose = rigPose(view, viewport, frame);
      const ground = {
        lat: view.center.lat + ((random() - 0.5) * 40) / 2 ** view.zoom,
        lng: view.center.lng + ((random() - 0.5) * 60) / 2 ** view.zoom
      };
      const expected = project(view, viewport, ground);
      if (!expected.visible || expected.scale > 50) continue;
      const got = projectThroughRig(pose, viewport, groundPoint(frame, ground));
      assert.ok(got.visible, `case ${i}: rig hides a visible point`);
      // Tolerance relative to how many ground units one screen pixel spans.
      const tolerance = 1e-6 * Math.max(1, 2 ** Math.abs(view.zoom - frame.referenceZoom));
      assert.ok(Math.hypot(got.x - expected.x, got.y - expected.y) < tolerance, `case ${i}: ${got.x},${got.y} vs ${expected.x},${expected.y}`);
      checked++;
    }
    assert.ok(checked > 300, `only ${checked} cases checked`);
  });
}

test("a scaled map layer is matched by the camera zoom", () => {
  const map = { width: 1920, height: 1080 };
  const view: View = { center: { lat: 35.6812, lng: 139.7671 }, zoom: 15.2, bearing: -35, pitch: 60 };
  const frame = groundFrameFor(view, map);
  const pose = rigPose(view, map, frame, 1.5);
  for (const point of [
    { lat: 35.684, lng: 139.77 },
    { lat: 35.679, lng: 139.763 }
  ]) {
    const flat = project(view, map, point);
    const got = projectThroughRig(pose, map, groundPoint(frame, point));
    assert.ok(Math.abs(got.x - (960 + (flat.x - 960) * 1.5)) < 1e-6);
    assert.ok(Math.abs(got.y - (540 + (flat.y - 540) * 1.5)) < 1e-6);
  }
});

test("the ground origin survives float32 sliders", () => {
  const frame = groundFrameFor({ center: { lat: -33.856784, lng: 151.215297 }, zoom: 13.7, bearing: 0, pitch: 0 }, { width: 1920, height: 1080 });
  assert.equal(float32(frame.origin.lat), frame.origin.lat);
  assert.equal(float32(frame.origin.lng), frame.origin.lng);
  assert.equal(frame.referenceZoom, 13);
  assert.deepEqual(groundPoint(frame, frame.origin), [960, 540, -0]);
});

test("altitude rises towards the camera at MapLibre's metre scale", () => {
  const frame: GroundFrame = { origin: { lat: 0, lng: 0 }, referenceZoom: 16, scene: { width: 1920, height: 1080 } };
  const perMeter = groundUnitsPerMeter(frame, 0);
  // At the equator one world is 2*pi*6371008.8 m wide in MapLibre.
  assert.ok(Math.abs(perMeter - (512 * 2 ** 16) / (2 * Math.PI * 6371008.8)) < 1e-12);
  const up = groundPoint(frame, { lat: 0, lng: 0 }, 100);
  assert.ok(up[2] < 0);
  assert.ok(Math.abs(up[2] + 100 * perMeter) < 1e-9);
});

type Controls = Record<string, number>;

function mapStub(controls: Controls, map: Viewport, scale: number) {
  return {
    source: { width: map.width, height: map.height },
    transform: { scale: [scale * 100, scale * 100] },
    effect: (name: string) => (index: number) => {
      assert.equal(index, 1);
      if (!(name in controls)) throw new Error(`unknown map control ${name}`);
      return { value: controls[name] };
    }
  };
}

/** Evaluates an expression like AE's JavaScript engine: the last statement is the result. */
function evaluate(code: string, env: { own: Record<string, unknown>; parentOwn?: Record<string, unknown>; scene: Viewport }) {
  const effectsOf = (own: Record<string, unknown>) => (name: string) => (index: number) => {
    assert.equal(index, 1);
    if (!(name in own)) throw new Error(`unknown effect ${name}`);
    const found = own[name];
    return typeof found === "number" ? { value: found } : found;
  };
  const parent = env.parentOwn ? { effect: effectsOf(env.parentOwn) } : undefined;
  const run = new Function("effect", "parent", "thisComp", "return eval(arguments[3]);");
  return run(effectsOf(env.own), parent, { width: env.scene.width, height: env.scene.height }, code);
}

test("rig expressions evaluate to the rig pose", () => {
  const code = cameraRigExpressions();
  for (const text of Object.values(code)) {
    assert.ok(text.startsWith(RIG_MARKER));
    assert.ok(![...text].some((c) => c.charCodeAt(0) > 126));
  }
  for (let i = 0; i < 100; i++) {
    const map = random() < 0.5 ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 };
    const scene = map;
    const view = float32View(randomView());
    const frame = groundFrameFor({ ...view, zoom: view.zoom + (random() - 0.5) * 4 }, scene);
    const scale = random() < 0.5 ? 1 : 0.5 + random();
    const controls: Controls = {
      Latitude: view.center.lat,
      Longitude: view.center.lng,
      Zoom: view.zoom,
      Bearing: view.bearing,
      Pitch: view.pitch,
      "3D Origin Latitude": float32(frame.origin.lat),
      "3D Origin Longitude": float32(frame.origin.lng),
      "3D Reference Zoom": frame.referenceZoom
    };
    const own = { Map: mapStub(controls, map, scale) };
    const pose = rigPose(view, map, frame, scale);
    const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
    const targetPosition = evaluate(code.targetPosition, { own, scene }) as number[];
    pose.target.position.forEach((v, k) => assert.ok(close(targetPosition[k], v), `target ${k}: ${targetPosition[k]} vs ${v}`));
    assert.equal(evaluate(code.targetRotationZ, { own, scene }), pose.target.rotationZ);
    const cameraPosition = evaluate(code.cameraPosition, { own: {}, parentOwn: own, scene }) as number[];
    pose.camera.position.forEach((v, k) => assert.ok(close(cameraPosition[k], v), `camera ${k}: ${cameraPosition[k]} vs ${v}`));
    assert.equal(evaluate(code.cameraRotationX, { own: {}, parentOwn: own, scene }), pose.camera.rotationX);
    assert.ok(close(evaluate(code.cameraZoom, { own: {}, parentOwn: own, scene }) as number, pose.camera.zoom));
  }
});

test("3D pin expression places the exact coordinates on the ground and lifts by altitude", () => {
  const scene = { width: 1920, height: 1080 };
  const frame = groundFrameFor({ center: { lat: 40.7484, lng: -73.9857 }, zoom: 16.4, bearing: 0, pitch: 0 }, scene);
  const controls: Controls = {
    "3D Origin Latitude": frame.origin.lat,
    "3D Origin Longitude": frame.origin.lng,
    "3D Reference Zoom": frame.referenceZoom
  };
  const pinLat = 40.7484405;
  const pinLng = -73.9856644;
  const code = pin3dPositionExpression(pinLat, pinLng);
  assert.ok(code.startsWith(PIN3D_MARKER));
  const result = evaluate(code, {
    own: { Map: mapStub(controls, scene, 1), Latitude: float32(pinLat), Longitude: float32(pinLng), "Altitude (m)": 381 },
    scene
  }) as number[];
  const expected = groundPoint(frame, { lat: pinLat, lng: pinLng }, 381);
  expected.forEach((v, k) => assert.ok(Math.abs(result[k] - v) < 1e-6, `${k}: ${result[k]} vs ${v}`));
});
