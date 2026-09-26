import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_FOLLOW, followExpression, followExpressions, normaliseFollow } from "../../src/core/ae/followExpressions.ts";

const envSource = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "tools", "expression-env.js"), "utf8");
const fake = new Function(`${envSource}\nreturn lmlRunExpression;`)() as (code: string, env: unknown) => number;

const leader = { Latitude: 23.8, Longitude: 90.4, Zoom: 6.5, Bearing: 30, Pitch: 45 };
const run = (code: string, offset: number) =>
  fake(code, { own: { Follows: "MAP", "Follow Zoom Offset": offset }, map: { width: 1920, height: 1080, scale: 1, controls: leader, toComp: [1, 0, 0, 0, 1, 0] }, comp: { width: 1920, height: 1080 }, value: 0 });

test("a follower's camera reads its leader's, with the zoom offset", () => {
  const all = followExpressions({ zoomOffset: -2, bearing: true, pitch: true });
  assert.equal(run(all.Latitude!, -2), 23.8);
  assert.equal(run(all.Longitude!, -2), 90.4);
  assert.equal(run(all.Zoom!, -2), 4.5);
  assert.equal(run(all.Bearing!, -2), 30);
  assert.equal(run(all.Pitch!, -2), 45);
});

test("a follower keeps its own turn and tilt when asked", () => {
  assert.equal(followExpression("Bearing", { ...DEFAULT_FOLLOW, bearing: false }), null);
  assert.equal(followExpression("Pitch", { ...DEFAULT_FOLLOW, pitch: false }), null);
  assert.ok(followExpression("Latitude", { zoomOffset: 0, bearing: false, pitch: false }));
  // The leader is reached through the Layer Control, never by a layer's name.
  for (const code of Object.values(followExpressions(DEFAULT_FOLLOW))) assert.match(code!, /effect\("Follows"\)\(1\)/);
});

test("a follow setting read back from a tag is put right", () => {
  assert.equal(normaliseFollow(null), null);
  assert.equal(normaliseFollow({ zoomOffset: 2 }), null);
  assert.deepEqual(normaliseFollow({ mapId: "m1", zoomOffset: 40, bearing: false }), { mapId: "m1", zoomOffset: 12, bearing: false, pitch: true });
  assert.deepEqual(normaliseFollow({ mapId: "m1", zoomOffset: "x" }), { mapId: "m1", zoomOffset: 0, bearing: true, pitch: true });
});
