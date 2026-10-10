import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applyCorrections,
  buildHistory,
  cutByProvinces,
  buildYear,
  readCorrections,
  readSnapshot,
  yearFile,
  yearLabel,
  yearOfSourceFile,
  HISTORY_ID_PREFIX,
  type Corrections,
  type CutResolver
} from "../../src/core/history/historyPack.ts";
import { HISTORY_PACK } from "../../src/core/history/packInfo.ts";
import { pointInPolygons } from "../../src/core/geo/pointInPolygon.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

const square = (west: number, south: number, size: number) => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south]
  ]
];

const feature = (props: Record<string, unknown>, ...polygons: number[][][][]) => ({
  type: "Feature",
  properties: props,
  geometry: polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons }
});

const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

// Two neighbours sharing the border at lng 10, an island far east, and land nobody held.
const snapshot = () =>
  collection(
    feature({ NAME: "West", SUBJECTO: "Empire", BORDERPRECISION: 3, PARTOF: null }, square(0, 0, 10)),
    feature({ NAME: "East", SUBJECTO: "East", BORDERPRECISION: 2 }, square(10, 0, 10)),
    feature({ NAME: "Islands", SUBJECTO: "Islands", BORDERPRECISION: 3 }, square(30, 0, 2), square(40, 0, 2)),
    feature({ NAME: null, SUBJECTO: null, BORDERPRECISION: 1 }, square(0, 20, 5))
  );

const names = (drafts: { name: string }[]) => drafts.map((d) => d.name);

test("years: source file names, labels and pack files", () => {
  assert.equal(yearOfSourceFile("world_1945.geojson"), 1945);
  assert.equal(yearOfSourceFile("world_bc323.geojson"), -323);
  assert.equal(yearOfSourceFile("world_bc1.geojson"), -1);
  assert.equal(yearOfSourceFile("places.geojson"), null);
  assert.equal(yearLabel(-123000), "123000 BC");
  assert.equal(yearLabel(100), "AD 100");
  assert.equal(yearLabel(1947), "1947");
  assert.equal(yearFile(-323), "bc323.json");
  assert.equal(yearFile(1971), "1971.json");
});

test("a snapshot: rulers, unclaimed land, precision and clean rings", () => {
  const ring = [
    [0.000001, 0],
    [0.000002, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ];
  const drafts = readSnapshot(
    collection(
      ...snapshot().features,
      feature({ NAME: "  Open  ", BORDERPRECISION: 7 }, [ring]),
      { type: "Feature", properties: { NAME: "Point" }, geometry: { type: "Point", coordinates: [0, 0] } },
      feature({ NAME: "Sliver" }, [[[0, 0], [1, 0], [0, 0]]])
    )
  );
  assert.deepEqual(names(drafts), ["West", "East", "Islands", "", "Open"]);
  assert.equal(drafts[0].ruler, "Empire");
  assert.equal(drafts[1].precision, 2);
  // Unclaimed land keeps no name and no ruler; a shape without a ruler rules itself.
  assert.equal(drafts[3].ruler, "");
  assert.equal(drafts[4].ruler, "Open");
  assert.equal(drafts[4].precision, 1);
  // Rounded to about 10 m, the repeated point gone, and the ring closed.
  assert.deepEqual(drafts[4].polygons[0][0], [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  assert.throws(() => readSnapshot({ type: "Feature" }), /FeatureCollection/);
});

test("merge: neighbours become one shape without the border between them", () => {
  const drafts = applyCorrections(readSnapshot(snapshot()), 1945, [{ op: "merge", names: ["West", "East"], into: { name: "Union", ruler: "Empire" } }]);
  assert.deepEqual(names(drafts), ["Union", "Islands", ""]);
  const union = drafts[0];
  assert.equal(union.ruler, "Empire");
  assert.equal(union.precision, 2, "the least precise part decides");
  assert.equal(union.polygons.length, 1);
  assert.equal(union.polygons[0].length, 1);
  const lngs = union.polygons[0][0].map((p) => p[0]);
  assert.equal(Math.min(...lngs), 0);
  assert.equal(Math.max(...lngs), 20);
  assert.ok(!lngs.includes(10) || union.polygons[0][0].filter((p) => p[0] === 10).every((p) => p[1] === 0 || p[1] === 10), "no border left inside");
});

test("merge without a ruler: the merged shape rules itself", () => {
  const drafts = applyCorrections(readSnapshot(snapshot()), 1947, [{ op: "merge", names: ["West", "Islands"], into: { name: "West" } }]);
  assert.equal(drafts[0].name, "West");
  assert.equal(drafts[0].ruler, "West");
  assert.equal(drafts[0].polygons.length, 3, "parts that stand apart stay separate polygons");
});

test("set: a renamed independent shape keeps ruling itself; a colony keeps its ruler", () => {
  const drafts = applyCorrections(readSnapshot(snapshot()), 1971, [
    { op: "set", name: "East", to: { name: "Eastland" } },
    { op: "set", name: "West", to: { name: "Westland" } },
    { op: "set", name: "Islands", to: { ruler: "Empire", precision: 1 } }
  ]);
  assert.deepEqual(drafts.slice(0, 3).map((d) => [d.name, d.ruler, d.precision]), [
    ["Westland", "Empire", 3],
    ["Eastland", "Eastland", 2],
    ["Islands", "Empire", 1]
  ]);
});

test("split: the parts inside the box become a shape of their own, next to the rest", () => {
  const drafts = applyCorrections(readSnapshot(snapshot()), 1971, [{ op: "split", name: "Islands", box: [35, -5, 45, 5], into: { name: "Far Island" } }]);
  assert.deepEqual(names(drafts), ["West", "East", "Islands", "Far Island", ""]);
  assert.equal(drafts[2].polygons.length, 1);
  assert.equal(drafts[3].polygons.length, 1);
  assert.equal(drafts[3].polygons[0][0][0][0], 40);
  assert.equal(drafts[3].ruler, "Far Island");
});

test("cut: a shape cut in two along a line the source does not have", () => {
  const drafts = applyCorrections(readSnapshot(snapshot()), 1971, [{ op: "cut", name: "West", by: { box: [-10, -10, 20, 4] }, into: { name: "South West", precision: 1 } }]);
  assert.deepEqual(names(drafts), ["West", "South West", "East", "Islands", ""]);
  const [north, south] = drafts;
  const lats = (polygons: number[][][][]) => polygons.flatMap((polygon) => polygon[0].map((p) => p[1]));
  assert.equal(Math.min(...lats(north.polygons)), 4);
  assert.equal(Math.max(...lats(south.polygons)), 4);
  assert.equal(south.precision, 1);
  assert.equal(south.ruler, "South West", "a part that is named rules itself");
  assert.equal(north.ruler, "Empire", "the rest keeps its ruler");
  assert.throws(() => applyCorrections(readSnapshot(snapshot()), 1971, [{ op: "cut", name: "West", by: { box: [50, 50, 60, 60] }, into: { name: "X" } }]), /takes no part/);
  assert.throws(() => applyCorrections(readSnapshot(snapshot()), 1971, [{ op: "cut", name: "West", by: { box: [-90, -90, 90, 90] }, into: { name: "X" } }]), /takes every part/);
  assert.throws(() => applyCorrections(readSnapshot(snapshot()), 1971, [{ op: "cut", name: "West", by: { provinces: { country: "XXX", names: ["A"] } }, into: { name: "X" } }]), /resolver/);
});

test("a cut by provinces reaches into the sea but not into the other provinces", () => {
  // Two provinces side by side: A west of lng 5, B east of it; the coast is their outer edge.
  const provinces = [
    { name: "A", polygons: [[[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]]] },
    { name: "B", polygons: [[[[5, 0], [10, 0], [10, 5], [5, 5], [5, 0]]]] }
  ];
  const kept = cutByProvinces(provinces, ["A"]);
  const xs = kept.flatMap((polygon) => polygon[0].map((p) => p[0]));
  const ys = kept.flatMap((polygon) => polygon[0].map((p) => p[1]));
  assert.ok(Math.min(...xs) < -0.2 && Math.min(...ys) < -0.2, "out into the sea by about 30 km");
  assert.ok(!pointInPolygons({ lat: 2.5, lng: 5.01 }, kept) && !pointInPolygons({ lat: 2.5, lng: 7 }, kept), "never into B");
  assert.ok(Math.max(...xs) < 5.4, "past B only by its corner, within the reach");
  assert.throws(() => cutByProvinces(provinces, ["C"]), /no province C/);
});

test("a correction that finds nothing stops the build", () => {
  const drafts = readSnapshot(snapshot());
  assert.throws(() => applyCorrections(drafts, 1945, [{ op: "set", name: "Nowhere", to: { ruler: "X" } }]), /1945: set Nowhere: no shape/);
  assert.throws(() => applyCorrections(drafts, 1945, [{ op: "merge", names: ["West", "Nowhere"], into: { name: "X" } }]), /no shape named Nowhere/);
  assert.throws(() => applyCorrections(drafts, 1945, [{ op: "split", name: "Islands", box: [100, 0, 110, 10], into: { name: "X" } }]), /takes no part/);
  assert.throws(() => applyCorrections(drafts, 1945, [{ op: "split", name: "Islands", box: [0, -90, 90, 90], into: { name: "X" } }]), /takes every part/);
});

test("a year: ids, label points inside the shape and bounds", () => {
  const year = buildYear(readSnapshot(snapshot()), -323);
  assert.equal(year.label, "323 BC");
  assert.deepEqual(year.features.map((f) => f.id), ["hbbc323-0", "hbbc323-1", "hbbc323-2", "hbbc323-3"]);
  assert.ok(year.features.every((f) => f.id.startsWith(HISTORY_ID_PREFIX) && f.id.length <= 24));
  const [lng, lat] = year.features[0].label;
  assert.ok(lng > 0 && lng < 10 && lat > 0 && lat < 10);
  assert.deepEqual(year.features[2].bounds, [30, 0, 42, 2]);
});

test("derived years start from the source as it came, not from the corrected year", () => {
  const corrections: Corrections = {
    v: 1,
    years: [
      { year: 1945, note: "fix", ops: [{ op: "merge", names: ["West", "East"], into: { name: "Union" } }] },
      { year: 1947, from: 1945, note: "derived", ops: [{ op: "set", name: "East", to: { name: "Free East" } }] }
    ]
  };
  const built = buildHistory(new Map([[1945, snapshot()], [1900, snapshot()]]), corrections);
  assert.deepEqual(built.map((b) => b.year.year), [1900, 1945, 1947]);
  assert.deepEqual(names(built[1].year.features), ["Union", "Islands", ""]);
  assert.deepEqual(names(built[2].year.features), ["West", "Free East", "Islands", ""]);
  assert.equal(built[2].info.from, 1945);
  assert.equal(built[2].info.note, "derived");
  assert.equal(built[0].info.note, undefined);
  assert.throws(() => buildHistory(new Map([[1945, snapshot()]]), { v: 1, years: [{ year: 1945, from: 1900, note: "x", ops: [{ op: "set", name: "West", to: {} }] }] }), /derived but the source has it/);
  assert.throws(() => buildHistory(new Map([[1945, snapshot()]]), { v: 1, years: [{ year: 1950, from: 1900, note: "x", ops: [{ op: "set", name: "West", to: {} }] }] }), /no source snapshot for 1900/);
});

test("one name per ruling power, before the year's own ops", () => {
  const source = collection(
    feature({ NAME: "Home", SUBJECTO: "Old Empire Name", BORDERPRECISION: 3 }, square(0, 0, 10)),
    feature({ NAME: "Colony", SUBJECTO: "Empire", BORDERPRECISION: 3 }, square(20, 0, 10)),
    feature({ NAME: "Other", SUBJECTO: "Other", BORDERPRECISION: 3 }, square(40, 0, 10))
  );
  const built = buildHistory(new Map([[1900, source]]), { v: 1, rulers: { "Old Empire Name": "Empire" }, years: [{ year: 1900, note: "x", ops: [{ op: "set", name: "Other", to: { ruler: "Old Empire Name" } }] }] });
  assert.deepEqual(built[0].year.features.map((f) => [f.name, f.ruler]), [["Home", "Empire"], ["Colony", "Empire"], ["Other", "Old Empire Name"]]);
  assert.throws(() => readCorrections({ v: 1, rulers: { A: "B", B: "C" }, years: [] }), /renamed again/);
  assert.throws(() => readCorrections({ v: 1, rulers: { A: "" }, years: [] }), /bad ruler/);
});

test("the corrections file is well formed and makes 1947 and 1971", () => {
  const corrections = readCorrections(JSON.parse(fs.readFileSync(path.join(root, "data", "history", "corrections.json"), "utf8")));
  const derived = corrections.years.filter((y) => y.from !== undefined).map((y) => [y.year, y.from]);
  assert.deepEqual(derived, [
    [1947, 1945],
    [1971, 1960]
  ]);
  assert.throws(() => readCorrections({ v: 1, years: [{ year: 1, note: "a", ops: [{ op: "set" }] }, { year: 1, note: "a", ops: [{ op: "set" }] }] }), /listed twice/);
  assert.throws(() => readCorrections({ v: 1, years: [{ year: 2, note: "", ops: [{ op: "set" }] }] }), /no note/);
  assert.throws(() => readCorrections({ v: 1, years: [{ year: 2, note: "a", ops: [{ op: "move" }] }] }), /unknown op/);
});

// The real source, when tools/build-history-pack.ts has downloaded it: every correction still finds
// what it names, and South Asia reads right in 1945, 1947 and 1971.
const sourceDir = path.join(root, ".cache", "history", `source-${HISTORY_PACK.commit}`);
test("South Asia in the real source, corrected", { skip: !fs.existsSync(path.join(sourceDir, "world_1960.geojson")) && "the source is not downloaded" }, () => {
  const read = (year: number) => JSON.parse(fs.readFileSync(path.join(sourceDir, `world_${year}.geojson`), "utf8"));
  const corrections = readCorrections(JSON.parse(fs.readFileSync(path.join(root, "data", "history", "corrections.json"), "utf8")));
  const snapshots = new Map<number, unknown>(corrections.years.map((y) => [y.from ?? y.year, read(y.from ?? y.year)]));
  // Cuts by provinces read the bundled provinces, as the build does.
  const resolve: CutResolver = (by) => ("provinces" in by ? cutByProvinces((JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "admin1", `${by.provinces.country}.json`), "utf8")) as { features: { name: string; polygons: number[][][][] }[] }).features, by.provinces.names) : []);
  const built = new Map(buildHistory(snapshots, corrections, resolve).map((b) => [b.year.year, b.year]));
  const shape = (year: number, name: string) => built.get(year)!.features.filter((f) => f.name === name);
  const ruler = (year: number, name: string) => shape(year, name).map((f) => f.ruler).join();

  assert.equal(shape(1945, "India").length + shape(1945, "Pakistan").length + shape(1945, "Bangladesh").length, 0);
  assert.equal(ruler(1945, "British Raj"), "United Kingdom");
  assert.equal(shape(1945, "British Raj")[0].polygons.length, 1, "one colony, no border inside");
  assert.equal(ruler(1945, "Ceylon"), "United Kingdom");
  assert.equal(ruler(1938, "Ceylon"), "United Kingdom");
  // The source spells the United Kingdom two ways in 1914; the pack has one.
  assert.ok(!built.get(1914)!.features.some((f) => f.ruler === "United Kingdom of Great Britain and Ireland"));
  assert.equal(ruler(1914, "Nigeria"), "United Kingdom");

  const pakistan1947 = shape(1947, "Pakistan");
  assert.equal(pakistan1947.length, 1);
  const east = pakistan1947[0].polygons.some((p) => p[0].every(([lng]) => lng > 85));
  const west = pakistan1947[0].polygons.some((p) => p[0].every(([lng]) => lng < 80));
  assert.ok(east && west, "Pakistan of 1947 has its western and eastern wings");
  assert.equal(shape(1947, "Bangladesh").length, 0);
  assert.equal(ruler(1947, "India"), "India");
  assert.equal(ruler(1947, "Burma"), "United Kingdom");

  const bangladesh = shape(1971, "Bangladesh");
  assert.equal(bangladesh.length, 1);
  assert.equal(bangladesh[0].ruler, "Bangladesh");
  const [w, s, e, n] = bangladesh[0].bounds;
  assert.ok(w > 87.5 && e < 93 && s > 20.5 && n < 27, `Bangladesh's bounds ${bangladesh[0].bounds}`);
  assert.ok(shape(1971, "Pakistan")[0].polygons.every((p) => p[0].every(([lng]) => lng < 80)), "Pakistan of 1971 is only the west");
  assert.equal(ruler(1971, "Angola"), "Portugal");
  assert.equal(shape(1971, "Tibet").length, 0);

  // Vietnam at the 17th parallel and Yemen north and south, in 1960 and 1971.
  for (const year of [1960, 1971]) {
    assert.equal(shape(year, "Vietnam").length, 0, `${year}: Vietnam whole`);
    assert.equal(shape(year, "North Vietnam")[0].bounds[1], 17);
    assert.equal(shape(year, "South Vietnam")[0].bounds[3], 17);
    assert.equal(shape(year, "Yemen").length, year === 1960 ? 1 : 0);
  }
  assert.equal(ruler(1960, "Aden Protectorate"), "United Kingdom");
  assert.equal(ruler(1971, "South Yemen"), "South Yemen");
  const north = shape(1971, "North Yemen")[0];
  const sanaa = { lat: 15.37, lng: 44.19 };
  // Inland of Aden: the source draws its coast coarser than the port.
  const aden = { lat: 13.06, lng: 44.88 };
  const inside = (f: { polygons: number[][][][] }, p: { lat: number; lng: number }) => pointInPolygons(p, f.polygons);
  assert.ok(inside(north, sanaa) && !inside(north, aden), "Sana'a in the north, Lahij not");
  assert.ok(inside(shape(1971, "South Yemen")[0], aden), "Lahij, by Aden, in the south");
});
