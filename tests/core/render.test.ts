import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, hash64, keyOf } from "../../src/core/render/frameKey.ts";
import { AE_DEFAULT_SHUTTER, shutterOffsets } from "../../src/core/render/shutter.ts";
import { downsampleBox, SampleAccumulator } from "../../src/core/render/pixels.ts";
import { composePasses, groupVisibleIn, rendersFor, PASS_IDS, type RenderId } from "../../src/core/render/passes.ts";
import { frameKey, normaliseSettings, outputGeometry, sampleOffsets, sequenceFileName, DEFAULT_FINAL_SETTINGS, type FrameKeyContext } from "../../src/core/render/plan.ts";
import { findPops, meanAbsDifference } from "../../src/core/render/temporal.ts";
import type { View } from "../../src/core/camera/camera.ts";

test("canonical JSON ignores key order and undefined fields", () => {
  assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined, e: "x" }] }), canonicalJson({ a: [1, { e: "x", d: 2 }], b: 1 }));
  assert.equal(keyOf({ x: 1, y: 2 }), keyOf({ y: 2, x: 1 }));
  assert.notEqual(keyOf({ x: 1, y: 2 }), keyOf({ x: 1, y: 2.0000001 }));
  assert.match(hash64("anything"), /^[0-9a-f]{16}$/);
});

test("hash64 spreads similar inputs", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20000; i++) seen.add(hash64(`frame ${i}`));
  assert.equal(seen.size, 20000);
});

test("shutter samples match After Effects' shutter interval", () => {
  const offsets = shutterOffsets(AE_DEFAULT_SHUTTER);
  assert.equal(offsets.length, 8);
  // 180 degrees at -90 degrees phase: open from -0.25 to +0.25 frames, sample centres inside.
  assert.ok(Math.abs(offsets[0] - (-0.25 + 0.5 / 16)) < 1e-12);
  assert.ok(Math.abs(offsets[7] - (0.25 - 0.5 / 16)) < 1e-12);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  assert.ok(Math.abs(mean) < 1e-12);
  assert.deepEqual(shutterOffsets({ angle: 0, phase: -90, samples: 8 }), [0]);
  assert.deepEqual(shutterOffsets({ angle: 360, phase: 0, samples: 2 }), [0.25, 0.75]);
  assert.deepEqual(sampleOffsets({ ...DEFAULT_FINAL_SETTINGS, motionBlur: false }, { angle: 180, phase: -90 }), [0]);
  assert.equal(sampleOffsets({ ...DEFAULT_FINAL_SETTINGS, motionBlur: true, motionBlurSamples: 16 }, { angle: 180, phase: -90 }).length, 16);
});

test("box downsampling averages each block with rounding", () => {
  const w = 4;
  const h = 2;
  const src = new Uint8Array(w * h * 4);
  // Left block: values 0, 10, 20, 31 in red; right block: all 255 alpha, red 100.
  const reds = [0, 10, 100, 100, 20, 31, 100, 100];
  reds.forEach((r, p) => {
    src[p * 4] = r;
    src[p * 4 + 3] = 255;
  });
  const out = downsampleBox(src, w, h, 2);
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
  assert.equal(out.rgba[0], Math.round((0 + 10 + 20 + 31) / 4));
  assert.equal(out.rgba[4], 100);
  assert.equal(out.rgba[3], 255);
  assert.equal(downsampleBox(src, w, h, 1).rgba, src);
  // Partial boxes at the edge are dropped.
  assert.equal(downsampleBox(new Uint8Array(5 * 5 * 4), 5, 5, 2).width, 2);
});

test("sample accumulator returns the rounded mean", () => {
  const acc = new SampleAccumulator(4);
  acc.add(Uint8Array.of(0, 255, 10, 255));
  acc.add(Uint8Array.of(255, 255, 11, 0));
  assert.deepEqual([...acc.mean()], [128, 255, 11, 128]);
});

test("pass renders: holdouts only with buildings, mattes share renders", () => {
  assert.deepEqual(rendersFor(["base"], true), ["base"]);
  assert.deepEqual(rendersFor(["roads"], false), ["roads"]);
  assert.deepEqual(rendersFor(["roads"], true), ["roads", "buildings"]);
  assert.deepEqual(rendersFor(["landMatte", "waterMatte"], true), ["land", "waterShapes"]);
  assert.deepEqual(rendersFor(["water"], false), ["land", "waterFill", "waterShapes"]);
  assert.deepEqual(rendersFor([...PASS_IDS], true), ["base", "land", "waterFill", "waterShapes", "boundaries", "roads", "buildings"]);
  assert.equal(groupVisibleIn("base", "labels", { labels: false }), false);
  assert.equal(groupVisibleIn("base", "overlay", { labels: false }), true);
  assert.equal(groupVisibleIn("waterFill", "background", { labels: false }), true);
  assert.equal(groupVisibleIn("waterShapes", "background", { labels: false }), false);
  assert.equal(groupVisibleIn("roads", "buildings", { labels: false }), false);
});

function pixel(values: number[][]): Uint8Array {
  return Uint8Array.from(values.flat());
}

test("composed mattes are complementary and passes respect holdouts", () => {
  // Four pixels: open sea, land, a lake on land, and land half covered by a building edge.
  const renders: Partial<Record<RenderId, Uint8Array>> = {
    land: pixel([[0, 0, 0, 0], [40, 60, 50, 255], [40, 60, 50, 255], [40, 60, 50, 255]]),
    waterShapes: pixel([[0, 0, 0, 0], [0, 0, 0, 0], [10, 20, 40, 255], [0, 0, 0, 0]]),
    waterFill: pixel([[10, 20, 40, 255], [10, 20, 40, 255], [10, 20, 40, 255], [10, 20, 40, 255]]),
    roads: pixel([[0, 0, 0, 0], [100, 100, 100, 255], [0, 0, 0, 0], [100, 100, 100, 255]]),
    buildings: pixel([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [60, 60, 60, 128]])
  };
  const out = composePasses(renders, ["land", "water", "roads", "buildings", "landMatte", "waterMatte"], 4);
  const alpha = (buffer: Uint8Array | undefined, p: number) => buffer![p * 4 + 3];
  for (let p = 0; p < 4; p++) assert.equal(alpha(out.landMatte, p) + alpha(out.waterMatte, p), 255);
  assert.deepEqual([0, 1, 2, 3].map((p) => alpha(out.landMatte, p)), [0, 255, 0, 255]);
  // Mattes are white (premultiplied: colour equals alpha).
  assert.equal(out.waterMatte![0], 255);
  // Water only where there is no land, land loses the lake.
  assert.deepEqual([0, 1, 2, 3].map((p) => alpha(out.water, p)), [255, 0, 255, 0]);
  assert.deepEqual([0, 1, 2, 3].map((p) => alpha(out.land, p)), [0, 255, 0, 127]);
  // Roads under the half-covering building keep half their coverage, premultiplied colour too.
  assert.equal(alpha(out.roads, 3), 127);
  assert.equal(out.roads![12], 50);
  assert.equal(out.buildings, renders.buildings);
  assert.throws(() => composePasses({}, ["roads"], 4), /missing/);
  // Without a buildings render there is no holdout and an empty buildings pass.
  const flat = composePasses({ roads: renders.roads }, ["roads", "buildings"], 4);
  assert.equal(alpha(flat.roads, 3), 255);
  assert.equal(flat.buildings!.every((v) => v === 0), true);
});

test("settings are clamped and always render the base pass", () => {
  const s = normaliseSettings({ scale: 7, supersample: 9, motionBlurSamples: 1000, passes: ["roads", "nope" as never, "landMatte"] });
  assert.equal(s.scale, 1);
  assert.equal(s.supersample, 4);
  assert.equal(s.motionBlurSamples, 64);
  assert.deepEqual(s.passes, ["base", "roads", "landMatte"]);
  assert.deepEqual(normaliseSettings(null), DEFAULT_FINAL_SETTINGS);
});

test("output geometry keeps the canvas an exact multiple and within limits", () => {
  const hd = outputGeometry({ width: 1920, height: 1080 }, 1, 2);
  assert.deepEqual([hd.width, hd.height, hd.supersample, hd.canvasWidth, hd.canvasHeight], [1920, 1080, 2, 3840, 2160]);
  const uhd = outputGeometry({ width: 3840, height: 2160 }, 1, 4);
  assert.ok(uhd.canvasWidth <= 16384 && uhd.canvasWidth * uhd.canvasHeight <= 75_000_000);
  assert.equal(uhd.canvasWidth, 3840 * uhd.supersample);
  assert.equal(uhd.supersample, 3);
  const proxy = outputGeometry({ width: 3840, height: 2160 }, 0.5, 1);
  assert.deepEqual([proxy.width, proxy.height, proxy.canvasWidth, proxy.canvasHeight], [1920, 1080, 1920, 1080]);
  // MapLibre floors width * pixelRatio; the nudge keeps odd ratios from losing a pixel.
  for (const [w, h, scale, ss] of [[1280, 720, 0.5, 3], [1000, 1000, 1, 3], [7, 5, 1, 3], [1920, 1080, 1 / 3, 1]]) {
    const g = outputGeometry({ width: w, height: h }, scale, ss);
    assert.equal(Math.floor(w * g.pixelRatio), g.width * g.supersample);
  }
});

const view = (lat: number): View => ({ center: { lat, lng: 2 }, zoom: 12, bearing: 0, pitch: 30 });
const context: FrameKeyContext = { style: "s", data: "d", width: 1920, height: 1080, supersample: 2, labels: false };

test("frame keys change with the camera and settings, not with time or held blur samples", () => {
  const a = frameKey(context, "base", [view(48)], 0);
  assert.equal(frameKey(context, "base", [view(48)], 5000), a);
  assert.equal(frameKey(context, "base", [view(48), view(48), view(48)], 0), a);
  assert.notEqual(frameKey(context, "base", [view(48), view(48.0001)], 0), a);
  assert.notEqual(frameKey(context, "roads", [view(48)], 0), a);
  assert.notEqual(frameKey({ ...context, supersample: 3 }, "base", [view(48)], 0), a);
  assert.notEqual(frameKey({ ...context, data: "e" }, "base", [view(48)], 0), a);
  // Renderer labels are keyed by time too.
  const labelled = { ...context, labels: true };
  assert.notEqual(frameKey(labelled, "base", [view(48)], 0), frameKey(labelled, "base", [view(48)], 40));
  assert.equal(sequenceFileName(42), "frame_00042.png");
});

test("pop detection flags isolated jumps, not motion, starts or stops", () => {
  const steady = Array.from({ length: 30 }, () => 2);
  assert.deepEqual(findPops(steady), []);
  const startAfterHold = [...Array(10).fill(0), ...Array(20).fill(3)];
  assert.deepEqual(findPops(startAfterHold), []);
  const easeIn = Array.from({ length: 30 }, (_, i) => (i / 29) ** 2 * 4);
  assert.deepEqual(findPops(easeIn), []);
  const withPop = [...steady];
  withPop[12] = 14;
  assert.deepEqual(findPops(withPop).map((p) => p.frame), [13]);
  const flash = [...steady];
  flash[20] = 12;
  flash[21] = 12;
  assert.deepEqual(findPops(flash).map((p) => p.frame), [21, 22]);
  const a = Uint8Array.of(0, 0, 0, 255, 10, 10, 10, 255);
  const b = Uint8Array.of(3, 3, 3, 0, 10, 10, 10, 255);
  assert.equal(meanAbsDifference(a, b), 1.5);
});

test("animated style values are part of the frame key and of stillness", () => {
  const still = { center: { lat: 1, lng: 2 }, zoom: 3, bearing: 0, pitch: 0 };
  const a = frameKey(context, "base", [{ ...still, animation: { bordersDraw: 10 } }], 0);
  const b = frameKey(context, "base", [{ ...still, animation: { bordersDraw: 20 } }], 0);
  assert.notEqual(a, b);
  // Without animation values the key stays what it was before animations existed.
  assert.equal(frameKey(context, "base", [still], 0), frameKey(context, "base", [{ ...still }], 0));
});

test("regions fade in once the frame is about as large as the region", async () => {
  const { regionFadeZooms, EARLIEST_REGION_ZOOM } = await import("../../src/core/tiles/regionFade.ts");
  const paris = regionFadeZooms({ west: 2.2, south: 48.8, east: 2.48, north: 48.92 }, { width: 1920, height: 1080 });
  assert.ok(Math.abs(paris.to - 12.23) < 0.05, `paris ${paris.to}`);
  assert.ok(Math.abs(paris.to - paris.from - 0.8) < 1e-9);
  const country = regionFadeZooms({ west: -5, south: 42, east: 8, north: 51 }, { width: 1920, height: 1080 });
  assert.equal(country.to, EARLIEST_REGION_ZOOM);
  const uhd = regionFadeZooms({ west: 2.2, south: 48.8, east: 2.48, north: 48.92 }, { width: 3840, height: 2160 });
  assert.ok(Math.abs(uhd.to - paris.to - 1) < 1e-9, "a 4K frame covers the same area one zoom level later");
});

test("a wide region hands its detail lines over to the city region inside it", async () => {
  const { regionTiers } = await import("../../src/core/tiles/regionFade.ts");
  const hd = { width: 1920, height: 1080 };
  const tiers = regionTiers(
    [
      { name: "tokyo-wide", bounds: { west: 139, south: 35.1, east: 140.5, north: 36.2 }, maxZoom: 12 },
      { name: "tokyo", bounds: { west: 139.66, south: 35.61, east: 139.84, north: 35.73 }, maxZoom: 15 },
      { name: "paris", bounds: { west: 2.2, south: 48.8, east: 2.48, north: 48.92 }, maxZoom: 15 }
    ],
    hd
  );
  assert.ok(Math.abs(tiers["tokyo-wide"].fadeIn.to - 9.81) < 0.01, `tokyo-wide fades in until ${tiers["tokyo-wide"].fadeIn.to}`);
  assert.ok(tiers.tokyo.fadeIn.to > 12.5, `tokyo fades in until ${tiers.tokyo.fadeIn.to}`);
  assert.deepEqual(tiers["tokyo-wide"].fadeOut, tiers.tokyo.fadeIn);
  assert.equal(tiers.tokyo.fadeOut, null);
  assert.equal(tiers.paris.fadeOut, null, "Paris is not inside the Tokyo region");
});
