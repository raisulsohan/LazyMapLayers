import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionMesh, cutHole, explodeArea, MAX_MESH_LINES, pointsInside } from "../../src/core/geo/shapeOps.ts";
import { areaKm2 } from "../../src/core/geo/combine.ts";

/** A square of `size` degrees with its bottom-left corner at (lng, lat). */
const square = (lng: number, lat: number, size: number) => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat]
];

const big = [[square(0, 0, 10)]];
const small = [[square(2, 2, 2)]];
const apart = [[square(40, 40, 1)]];

test("an outline breaks into its parts, largest first", () => {
  const parts = explodeArea([[square(0, 0, 10)], [square(20, 0, 2)], [square(30, 0, 5)]]);
  assert.equal(parts.length, 3);
  assert.ok(parts[0].km2 > parts[1].km2 && parts[1].km2 > parts[2].km2);
  assert.deepEqual(parts.map((part) => part.polygons[0][0][0][0]), [0, 30, 20]);
  assert.ok(parts[0].centre && Math.abs(parts[0].centre.lng - 5) < 0.6);
  // A part keeps the holes of the polygon it came from.
  const holed = explodeArea([[square(0, 0, 10), square(2, 2, 2)]]);
  assert.equal(holed[0].polygons[0].length, 2);
  assert.equal(explodeArea([]).length, 0);
});

test("one area is cut out of another as a hole, and a shape that sits outside is left alone", () => {
  const cut = cutHole(big, small);
  assert.equal(cut.cut, 1);
  assert.equal(cut.outside, 0);
  assert.equal(cut.polygons[0].length, 2, "the outline plus its new hole");
  assert.ok(areaKm2(cut.polygons) < areaKm2(big), "the hole takes its area out");
  assert.ok(Math.abs(areaKm2(cut.polygons) - (areaKm2(big) - areaKm2(small))) < 1, "exactly the area of the shape cut out");
  // A shape that is not inside cannot be cut, and says so instead of cutting the wrong thing.
  const missed = cutHole(big, apart);
  assert.equal(missed.cut, 0);
  assert.equal(missed.outside, 1);
  assert.deepEqual(missed.polygons, big);
  // A shape that only half overlaps is clipped: only the overlap goes.
  const half = cutHole(big, [[square(8, 8, 4)]]);
  assert.equal(half.cut, 1);
  assert.equal(half.clipped, 1);
  assert.equal(half.outside, 0);
  const overlap = areaKm2([[square(8, 8, 2)]]);
  assert.ok(Math.abs(areaKm2(half.polygons) - (areaKm2(big) - overlap)) < areaKm2(big) * 0.002, "the overlap, and no more, is taken away");
});

test("a band across an area cuts it in two, and a hole and a clip can come in one cut", () => {
  // A 10 x 10 square with a band 2 wide right across it: two pieces are left.
  const band = [[[[4, -1], [6, -1], [6, 11], [4, 11], [4, -1]]]];
  const split = cutHole(big, band);
  assert.equal(split.clipped, 1);
  assert.equal(split.polygons.length, 2, "the square falls into two pieces");
  const both = cutHole(big, [small[0], [square(8, 8, 4)]]);
  assert.equal(both.cut, 2);
  assert.equal(both.clipped, 1);
  assert.ok(areaKm2(both.polygons) < areaKm2(big) - areaKm2(small));
});

test("the points inside an area are the ones a polygon really holds", () => {
  const points = [
    { lat: 5, lng: 5 },
    { lat: 3, lng: 3 },
    { lat: 50, lng: 50 },
    { lat: 9.5, lng: 9.5 }
  ];
  assert.deepEqual(pointsInside(big, points), [0, 1, 3]);
  // A hole is not inside: the point in it drops out.
  assert.deepEqual(pointsInside(cutHole(big, small).polygons, points), [0, 3]);
  assert.deepEqual(pointsInside([], points), []);
});

test("the mesh joins every pair, or only the nearest neighbours, shortest first", () => {
  const places = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
    { lat: 0, lng: 30 }
  ];
  const all = connectionMesh(places, { steps: 8 });
  assert.equal(all.lines.length, 6);
  assert.equal(all.dropped, 0);
  assert.ok(all.lines[0].km < all.lines[5].km, "shortest first");
  assert.equal(all.lines[0].points.length, 8);
  // Each place to its nearest neighbour only.
  const near = connectionMesh(places, { neighbours: 1, steps: 4 });
  assert.ok(near.lines.length < 6 && near.lines.length >= 2, `${near.lines.length} lines`);
  assert.ok(near.dropped > 0);
  // A limit on the length leaves the long one out.
  const close = connectionMesh(places, { maxKm: 500, steps: 4 });
  assert.equal(close.lines.every((line) => line.km <= 500), true);
  assert.equal(close.lines.length, 3);
  assert.equal(close.dropped, 3);
});

test("a crowd of places never makes more lines than a scene can carry", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ lat: (i % 8) * 0.5, lng: Math.floor(i / 8) * 0.5 }));
  const mesh = connectionMesh(many, { steps: 4 });
  assert.equal(mesh.lines.length, MAX_MESH_LINES);
  assert.equal(mesh.dropped, (40 * 39) / 2 - MAX_MESH_LINES);
  assert.equal(connectionMesh([{ lat: 1, lng: 1 }]).lines.length, 0);
});
