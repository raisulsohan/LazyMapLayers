import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygons } from "../../src/core/geo/pointInPolygon.ts";

const square = (w: number, s: number, e: number, n: number) => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s]
];

test("a point is inside a polygon, but not inside its hole", () => {
  const area = [[square(0, 0, 10, 10), square(4, 4, 6, 6)]];
  assert.equal(pointInPolygons({ lng: 2, lat: 2 }, area), true);
  assert.equal(pointInPolygons({ lng: 5, lat: 5 }, area), false);
  assert.equal(pointInPolygons({ lng: 12, lat: 5 }, area), false);
  assert.equal(pointInPolygons({ lng: 5, lat: -1 }, area), false);
});

test("any polygon of a multi-polygon counts, and an island inside a hole too", () => {
  const area = [[square(0, 0, 10, 10), square(3, 3, 7, 7)], [square(4.5, 4.5, 5.5, 5.5)], [square(20, 20, 21, 21)]];
  assert.equal(pointInPolygons({ lng: 5, lat: 5 }, area), true);
  assert.equal(pointInPolygons({ lng: 3.5, lat: 3.5 }, area), false);
  assert.equal(pointInPolygons({ lng: 20.5, lat: 20.5 }, area), true);
  assert.equal(pointInPolygons({ lng: 0, lat: 0 }, []), false);
  assert.equal(pointInPolygons({ lng: 0, lat: 0 }, [[]]), false);
});
