import { strict as assert } from "node:assert";
import test from "node:test";
import { labelPoint, poleOfInaccessibility } from "../../src/core/geo/polylabel.ts";

test("a square's deepest point is its centre", () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
  const pole = poleOfInaccessibility(square, 0.01);
  assert.ok(Math.abs(pole.x - 5) < 0.05 && Math.abs(pole.y - 5) < 0.05, JSON.stringify(pole));
  assert.ok(Math.abs(pole.distance - 5) < 0.05);
});

test("a U-shaped bay gets its name inside the water, where the centroid is not", () => {
  // A horseshoe: the centroid falls in the gap between the arms, which is outside the shape.
  const horseshoe = [[[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30], [0, 0]]];
  const pole = poleOfInaccessibility(horseshoe, 0.01);
  const inside = (x: number, y: number) => (y >= 0 && y <= 10 && x >= 0 && x <= 30) || (y > 10 && y <= 30 && ((x >= 0 && x <= 10) || (x >= 20 && x <= 30)));
  assert.ok(inside(pole.x, pole.y), `the name would sit at ${pole.x}, ${pole.y}`);
  assert.ok(pole.distance >= 4.9, `only ${pole.distance} from the shore`);
});

test("a hole in the middle pushes the name aside", () => {
  const ring = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]];
  const hole = [[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]];
  const pole = poleOfInaccessibility([ring, hole], 0.01);
  assert.ok(!(pole.x > 8 && pole.x < 12 && pole.y > 8 && pole.y < 12), "the name landed on the island in the lake");
  assert.ok(pole.distance > 3, `only ${pole.distance} from an edge`);
});

test("a multipolygon is named on its largest part, in longitude and latitude", () => {
  const small = [[[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]];
  const large = [[[10, 50], [30, 50], [30, 60], [10, 60], [10, 50]]];
  const [lng, lat] = labelPoint({ type: "MultiPolygon", coordinates: [small, large] });
  assert.ok(lng > 10 && lng < 30 && lat > 50 && lat < 60, `${lng}, ${lat}`);
  // At 55 degrees north a degree of longitude is about 0.57 of one of latitude, so the box is only
  // about 11.5 "ground" wide by 10 tall: the deepest point is still near the middle.
  assert.ok(Math.abs(lat - 55) < 0.5 && Math.abs(lng - 20) < 3, `${lng}, ${lat}`);
});
