import { test } from "node:test";
import assert from "node:assert/strict";
import { labelText, localLanguage, scriptOf } from "../../src/core/labels/language.ts";
import { opacityKeys, placeLabels, type LabelCandidate } from "../../src/core/labels/placement.ts";
import { projectPoint } from "../../src/core/camera/globe.ts";
import type { View } from "../../src/core/camera/camera.ts";
import { flightKeys } from "../../src/core/camera/flight.ts";

test("local languages, regional exceptions and English subtitles", () => {
  assert.equal(localLanguage("JPN"), "ja");
  assert.equal(localLanguage("EGY"), "ar");
  assert.equal(localLanguage("IND"), "hi");
  assert.equal(localLanguage("IND", "West Bengal"), "bn");
  assert.equal(localLanguage("USA"), "en");
  const cairo = labelText({ en: "Cairo", ar: "القاهرة" }, "EGY", undefined);
  assert.deepEqual(cairo, { text: "القاهرة", subtitle: "Cairo", language: "ar" });
  assert.deepEqual(labelText({ en: "Paris", fr: "Paris" }, "FRA", undefined), { text: "Paris", subtitle: null, language: "fr" });
  assert.deepEqual(labelText({ en: "Lagos" }, "NGA", undefined), { text: "Lagos", subtitle: null, language: "en" });
  assert.equal(labelText({ en: "Tokyo", ja: "東京" }, "JPN", undefined, { kind: "fixed", language: "en" }).text, "Tokyo");
});

test("scripts are detected for font choice", () => {
  assert.equal(scriptOf("東京"), "han");
  assert.equal(scriptOf("トウキョウ東京"), "japanese");
  assert.equal(scriptOf("서울"), "hangul");
  assert.equal(scriptOf("القاهرة"), "arabic");
  assert.equal(scriptOf("ঢাকা"), "bengali");
  assert.equal(scriptOf("नई दिल्ली"), "devanagari");
  assert.equal(scriptOf("Москва"), "cyrillic");
  assert.equal(scriptOf("São Paulo"), "latin");
});

const hd = { width: 1920, height: 1080 };

function randomCandidates(count: number, seed: number): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  let s = seed;
  const random = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    out.push({
      id: `c${i}`,
      lat: 30 + random() * 30,
      lng: -10 + random() * 60,
      priority: Math.floor(random() * 20),
      width: 60 + random() * 120,
      height: 24,
      anchor: i % 2 ? "center" : "right",
      offset: 8,
      markerRadius: 4,
      minZoom: random() * 5,
      maxZoom: 6 + random() * 6
    });
  }
  return out;
}

test("placement over a flight: no overlaps on any frame, no short appearances, stable", () => {
  const from: View = { center: { lng: -20, lat: 30 }, zoom: 2, bearing: 0, pitch: 0 };
  const to: View = { center: { lng: 30, lat: 45 }, zoom: 9, bearing: 20, pitch: 40 };
  const views = flightKeys(from, to, hd, { duration: 8, frameRate: 25 }).map((k) => k.view);
  const candidates = randomCandidates(400, 7);
  const tracks = placeLabels(candidates, views, { viewport: hd, projection: "globe", margin: 20, padding: 4, minFrames: 12 });
  assert.ok(tracks.length > 20, `${tracks.length} labels shown`);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (let f = 0; f < views.length; f++) {
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const track of tracks) {
      if (!track.intervals.some(([a, b]) => f >= a && f < b)) continue;
      const c = byId.get(track.id)!;
      const p = projectPoint(views[f], hd, c, { projection: "globe" });
      assert.ok(p.visible, `hidden label shown at frame ${f}`);
      const x0 = c.anchor === "center" ? p.x - c.width / 2 : p.x - 4;
      const x1 = c.anchor === "center" ? p.x + c.width / 2 : p.x + 8 + c.width;
      const box = { x0, y0: p.y - 12, x1, y1: p.y + 12 };
      assert.ok(box.x0 >= 20 && box.x1 <= 1900 && box.y0 >= 20 && box.y1 <= 1060, `label outside the margin at frame ${f}`);
      for (const other of boxes) assert.ok(box.x1 <= other.x0 || other.x1 <= box.x0 || box.y1 <= other.y0 || other.y1 <= box.y0, `overlap at frame ${f}`);
      boxes.push(box);
    }
  }
  for (const track of tracks) for (const [a, b] of track.intervals) assert.ok(b - a >= 12, `${track.id} shown for ${b - a} frames`);
  // Stability: few appearances per label.
  const appearances = tracks.reduce((sum, t) => sum + t.intervals.length, 0);
  assert.ok(appearances / tracks.length < 2, `on average ${appearances / tracks.length} appearances per label`);
});

test("a label on screen keeps its place against a higher-priority newcomer", () => {
  const views: View[] = Array.from({ length: 40 }, (_, i) => ({ center: { lng: 0, lat: 0 }, zoom: 5, bearing: 0, pitch: 0, i }) as View);
  const a: LabelCandidate = { id: "a", lat: 0, lng: 0, priority: 5, width: 200, height: 30, anchor: "center", minZoom: 0, maxZoom: 20 };
  const b: LabelCandidate = { ...a, id: "b", priority: 1, lng: 0.2, minZoom: 5.0001 };
  // b becomes eligible later by zooming in slightly.
  const zooming = views.map((v, i) => ({ ...v, zoom: i < 20 ? 5 : 5.001 }));
  const tracks = placeLabels([a, b], zooming, { viewport: hd, minFrames: 1 });
  assert.deepEqual(tracks.find((t) => t.id === "a")!.intervals, [[0, 40]]);
  assert.equal(tracks.find((t) => t.id === "b"), undefined);
});

test("opacity keys fade inside each appearance", () => {
  assert.deepEqual(opacityKeys({ id: "x", intervals: [[10, 40]] }, 5), [
    [10, 0],
    [15, 100],
    [35, 100],
    [40, 0]
  ]);
  // Short in the middle of the comp: it peaks halfway.
  assert.deepEqual(opacityKeys({ id: "y", intervals: [[20, 26]] }, 5), [
    [20, 0],
    [23, 100],
    [26, 0]
  ]);
});

test("a name on screen when the comp begins or ends is there in full at that edge", () => {
  // On from the first frame: no fade in, only the fade out.
  assert.deepEqual(opacityKeys({ id: "a", intervals: [[0, 40]] }, 5, 100), [
    [0, 100],
    [35, 100],
    [40, 0]
  ]);
  // On until the last frame: the fade in, then held to the end.
  assert.deepEqual(opacityKeys({ id: "b", intervals: [[60, 100]] }, 5, 100), [
    [60, 0],
    [65, 100],
    [100, 100]
  ]);
  // The whole comp: full all the way.
  assert.deepEqual(opacityKeys({ id: "c", intervals: [[0, 100]] }, 5, 100), [
    [0, 100],
    [100, 100]
  ]);
  // A second appearance after a gap still fades in.
  assert.deepEqual(opacityKeys({ id: "d", intervals: [[0, 20], [50, 100]] }, 5, 100), [
    [0, 100],
    [15, 100],
    [20, 0],
    [50, 0],
    [55, 100],
    [100, 100]
  ]);
});
