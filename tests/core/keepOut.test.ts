import { test } from "node:test";
import assert from "node:assert/strict";
import { addZones, hasZone, KEEP_OUT_PRESETS, MAX_KEEP_OUT, normaliseKeepOut, togglePreset, zoneBoxes, zonesOnFrame, type KeepOutZone } from "../../src/core/labels/keepOut.ts";
import { placeLabels, type LabelCandidate } from "../../src/core/labels/placement.ts";
import type { View } from "../../src/core/camera/camera.ts";
import { projectPoint } from "../../src/core/camera/globe.ts";

const zone = (over: Partial<KeepOutZone> = {}): KeepOutZone => ({ id: "z", name: "Zone", x: 0, y: 0.6, width: 1, height: 0.4, from: null, to: null, ...over });

test("every preset is a rectangle inside the frame", () => {
  for (const preset of KEEP_OUT_PRESETS) {
    assert.ok(preset.width > 0 && preset.height > 0, preset.id);
    assert.ok(preset.x + preset.width <= 1 + 1e-9 && preset.y + preset.height <= 1 + 1e-9, preset.id);
  }
  assert.equal(new Set(KEEP_OUT_PRESETS.map((p) => p.id)).size, KEEP_OUT_PRESETS.length);
});

test("what a map carries is cleaned up before it is used", () => {
  assert.deepEqual(normaliseKeepOut(null), []);
  assert.deepEqual(normaliseKeepOut([{ id: "a", x: -1, y: 0.5, width: 5, height: 0.2 }]), [{ id: "a", name: "a", x: 0, y: 0.5, width: 1, height: 0.2, from: null, to: null }]);
  // No size, off the frame, no id, or the same id twice.
  assert.deepEqual(normaliseKeepOut([{ id: "a", width: 0, height: 1 }, { id: "b", x: 1, y: 0, width: 0.5, height: 0.5 }, { x: 0, y: 0, width: 1, height: 1 }, zone({ id: "c" }), zone({ id: "c", name: "again" })]).map((z) => z.id), ["c"]);
  assert.equal(normaliseKeepOut([zone({ from: 2, to: 1 })])[0].to, null, "a range that ends before it starts is no range");
  assert.equal(normaliseKeepOut(Array.from({ length: 30 }, (_, i) => zone({ id: `z${i}` }))).length, MAX_KEEP_OUT);
});

test("presets go on and off, and a layer replaces its own zone", () => {
  const lowerThird = KEEP_OUT_PRESETS[0];
  const on = togglePreset([], lowerThird);
  assert.ok(hasZone(on, lowerThird.id));
  assert.deepEqual(togglePreset(on, lowerThird), []);
  const withLayer = addZones(on, [zone({ id: "layer:Title", name: "Title", y: 0.1, height: 0.2 })]);
  assert.equal(withLayer.length, 2);
  const again = addZones(withLayer, [zone({ id: "layer:Title", name: "Title", y: 0.3, height: 0.2 })]);
  assert.equal(again.length, 2, "the layer keeps one zone");
  assert.equal(again.find((z) => z.id === "layer:Title")?.y, 0.3);
});

test("zones become frame pixels and hold only while they are on screen", () => {
  const boxes = zoneBoxes([zone({ id: "always" }), zone({ id: "title", from: 1, to: 2, y: 0, height: 0.25 })], { width: 1920, height: 1080 }, 25, 100);
  assert.deepEqual(boxes[0], { id: "always", box: { x: 0, y: 648, width: 1920, height: 432 }, fromFrame: 0, toFrame: 100 });
  assert.deepEqual(boxes[1].box, { x: 0, y: 0, width: 1920, height: 270 });
  assert.deepEqual([boxes[1].fromFrame, boxes[1].toFrame], [25, 50]);
  assert.equal(zonesOnFrame(boxes, 0).length, 1);
  assert.equal(zonesOnFrame(boxes, 30).length, 2);
  assert.equal(zonesOnFrame(boxes, 50).length, 1, "the title is gone again");
});

test("the placement keeps names out of a zone", () => {
  const view: View = { center: { lat: 0, lng: 0 }, zoom: 3, bearing: 0, pitch: 0 };
  const views = Array.from({ length: 10 }, () => view);
  const viewport = { width: 1920, height: 1080 };
  // A grid of names over the whole frame.
  const candidates: LabelCandidate[] = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      candidates.push({ id: `${i}-${j}`, lat: 62 - j * 25, lng: -150 + i * 60, priority: i * 10 + j, width: 120, height: 30, anchor: "center", minZoom: 0, maxZoom: 22 });
    }
  }
  const boxes = zoneBoxes([zone({ id: "lower-third" })], viewport, 25, views.length);
  const free = placeLabels(candidates, views, { viewport });
  const blocked = placeLabels(candidates, views, { viewport, keepOut: (frame) => zonesOnFrame(boxes, frame) });
  assert.ok(free.length > blocked.length, "the zone costs some names");
  // Nothing placed reaches into the bottom of the frame.
  const inZone = blocked.filter((track) => {
    const candidate = candidates.find((c) => c.id === track.id)!;
    const point = projectPoint(view, viewport, candidate, { projection: "mercator" });
    return point.y + candidate.height / 2 > 648;
  });
  assert.equal(inZone.length, 0);
});
