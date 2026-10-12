import { test } from "node:test";
import assert from "node:assert/strict";
import { bandAlong, boxAround, planRoadAreas, roadQuery, snapToGrid, type RoadBox } from "../../src/core/routing/areas.ts";
import { greatCircle } from "../../src/core/geo/greatCircle.ts";
import { pointInPolygons } from "../../src/core/geo/pointInPolygon.ts";
import type { LngLat } from "../../src/core/geo/mercator.ts";

const dhaka = { lat: 23.7104, lng: 90.4074 };
const chittagong = { lat: 22.3569, lng: 91.7832 };
const eiffel = { lat: 48.8584, lng: 2.2945 };
const louvre = { lat: 48.8611, lng: 2.3358 };

const inBox = (p: LngLat, box: RoadBox) => p.lat >= box[0] && p.lat <= box[2] && p.lng >= box[1] && p.lng <= box[3];
const inPolygon = (p: LngLat, polygon: LngLat[]) => pointInPolygons(p, [[polygon.map((q) => [q.lng, q.lat])]]);

test("ends close together: one area, every road, a band along the way with a margin round both ends", () => {
  const plan = planRoadAreas(eiffel, louvre, "foot");
  assert.equal(plan.areas.length, 1);
  assert.ok(Math.abs(plan.km - 3.05) < 0.05, String(plan.km));
  const part = plan.areas[0].parts[0];
  assert.equal(part.tier, "all");
  assert.ok(part.classes.includes("footway") && part.classes.includes("steps"));
  // A fifth of the distance (610 m) to each side and past each end: in; 1.5 km to the side: out.
  const polygon = part.polygon!;
  const north = (p: LngLat, km: number) => ({ lat: p.lat + km / 111.32, lng: p.lng });
  const east = (p: LngLat, km: number) => ({ lat: p.lat, lng: p.lng + km / (111.32 * Math.cos((p.lat * Math.PI) / 180)) });
  for (const p of [eiffel, louvre, { lat: 48.86, lng: 2.315 }]) {
    assert.ok(inPolygon(north(p, 0.6), polygon) && inPolygon(north(p, -0.6), polygon), `${p.lat},${p.lng} with 600 m to each side`);
    assert.ok(!inPolygon(north(p, 1.5), polygon) && !inPolygon(north(p, -1.5), polygon), "and not much more");
  }
  assert.ok(inPolygon(east(eiffel, -0.6), polygon) && inPolygon(east(louvre, 0.6), polygon), "past both ends");
  const query = plan.areas[0].query;
  assert.match(query, /^\[out:json\]\[timeout:60\]\[maxsize:268435456\];\n\(\n {2}way\["highway"~"\^\(trunk\|trunk_link\|.*\|steps\)\$"\]\(poly:"48\.\d+ 2\.\d+ [^"]+"\);\n {2}way\["route"="ferry"\]\(poly:"[^"]+"\);\n\);\nout geom qt;$/);
  assert.ok(!query.includes("motorway"));
});

test("a long drive: every road round each end, the linking roads further out, major roads along a band between", () => {
  const plan = planRoadAreas(dhaka, chittagong, "car");
  assert.ok(Math.abs(plan.km - 206) < 2, String(plan.km));
  assert.deepEqual(plan.areas.map((area) => area.label), ["around the start", "on the way", "around the end"]);
  const [start, band, end] = plan.areas;
  assert.deepEqual(start.parts.map((part) => part.tier), ["all", "linking"]);
  assert.ok(inBox(dhaka, start.parts[0].box!) && inBox(chittagong, end.parts[0].box!));
  // Every road 1.5 km round (and the grid's slack, 420 m), the linking roads 10.3 km round.
  const all = start.parts[0].box!;
  assert.ok(all[2] - all[0] > 0.034 && all[2] - all[0] < 0.04, JSON.stringify(all));
  const linking = start.parts[1].box!;
  assert.ok(linking[2] - linking[0] > 0.19 && linking[2] - linking[0] < 0.2, JSON.stringify(linking));
  assert.ok(start.parts[1].classes.includes("tertiary") && !start.parts[1].classes.includes("residential"));
  // The band holds primary roads and above, and the whole way between: N1 swings 33 km east of the straight line at Comilla.
  assert.equal(band.parts[0].tier, "major");
  assert.ok(!band.parts[0].classes.includes("secondary"));
  const polygon = band.parts[0].polygon!;
  for (const p of greatCircle(dhaka, chittagong, 20)) assert.ok(inPolygon(p, polygon), `${p.lat},${p.lng} is in the band`);
  for (const town of [{ lat: 23.4607, lng: 91.1809 }, { lat: 23.0159, lng: 91.3976 }]) assert.ok(inPolygon(town, polygon), "Comilla and Feni are in the band");
  assert.ok(!inPolygon({ lat: 24.9, lng: 91.87 }, polygon), "Sylhet is not");
  assert.match(band.query, /\[timeout:90\]\[maxsize:268435456\];/);
  assert.match(band.query, /way\["highway"~"\^\(motorway\|motorway_link\|trunk\|trunk_link\|primary\|primary_link\)\$"\]\(poly:"2\d\.\d+ 9\d(\.\d+)? /);
  assert.match(band.query, /way\["route"="ferry"\]\(poly:"/);
});

test("the band narrows to motorways and trunk roads on very long drives, and stays on linking roads for short ones", () => {
  assert.equal(planRoadAreas({ lat: 48.8566, lng: 2.3522 }, { lat: 52.52, lng: 13.405 }, "car").areas[1].parts[0].tier, "trunk");
  assert.equal(planRoadAreas(dhaka, { lat: 24.0958, lng: 90.4125 }, "car").areas[1].parts[0].tier, "linking");
  // A bicycle never asks for motorways, even on the band.
  const ride = planRoadAreas(dhaka, chittagong, "bicycle");
  assert.ok(ride.areas.every((area) => area.parts.every((part) => !part.classes.includes("motorway"))));
  assert.ok(ride.areas[1].parts[0].classes.includes("cycleway"));
});

test("nearby clicks ask the same questions, so the answers on disk are found again", () => {
  const a = planRoadAreas({ lat: 23.7101, lng: 90.4071 }, chittagong, "car");
  const b = planRoadAreas({ lat: 23.7108, lng: 90.4078 }, { lat: 22.3562, lng: 91.7838 }, "car");
  assert.deepEqual(a.areas.map((area) => area.query), b.areas.map((area) => area.query));
  // The band between is planned from coarser ends: a start in the next street asks for the same band.
  const c = planRoadAreas({ lat: 23.7254, lng: 90.4152 }, chittagong, "car");
  assert.notEqual(c.areas[0].query, a.areas[0].query);
  assert.equal(c.areas[1].query, a.areas[1].query);
  assert.deepEqual(snapToGrid({ lat: 23.7104, lng: 90.4074 }, 0.01), { lat: 23.715, lng: 90.405 });
});

test("too far for the mode, the same place, and across the 180th meridian are refused before anything is sent", () => {
  assert.throws(() => planRoadAreas(dhaka, chittagong, "foot"), /206 km apart: a route on foot can be at most 60 km/);
  assert.throws(() => planRoadAreas(dhaka, { lat: 51.5, lng: -0.12 }, "car"), /at most 1500 km/);
  assert.throws(() => planRoadAreas(dhaka, dhaka, "car"), /same place/);
  assert.throws(() => planRoadAreas({ lat: -16.8, lng: 179.6 }, { lat: -16.6, lng: -179.9 }, "car"), /180th meridian/);
});

test("boxes and bands are drawn on whole thousandths of a degree, never narrower for it", () => {
  const box = boxAround(dhaka, 3);
  assert.deepEqual(box.map((value) => Math.round(value * 1000) / 1000), box);
  assert.ok(inBox(dhaka, box));
  assert.ok(box[2] - dhaka.lat >= 3 / 111.32 && dhaka.lat - box[0] >= 3 / 111.32);
  const band = bandAlong({ lat: 23.75, lng: 90.45 }, { lat: 22.35, lng: 91.75 }, 50);
  assert.ok(band.every((p) => Math.abs(p.lat * 1000 - Math.round(p.lat * 1000)) < 1e-6));
  // 50 km to each side: a point 45 km off the middle is in, 60 km off is not.
  const middle = { lat: 23.05, lng: 91.1 };
  assert.ok(inPolygon({ lat: middle.lat + 0.3, lng: middle.lng + 0.32 }, band));
  assert.ok(!inPolygon({ lat: middle.lat + 0.4, lng: middle.lng + 0.43 }, band));
  assert.match(roadQuery([{ tier: "all", classes: ["residential"], box: [1, 2, 3, 4] }], 25), /way\["highway"~"\^\(residential\)\$"\]\(1,2,3,4\);/);
});
