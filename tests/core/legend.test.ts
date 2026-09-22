import { test } from "node:test";
import assert from "node:assert/strict";
import { legendLayout, legendPosition, type LegendRow } from "../../src/core/style/legend.ts";

const rows: LegendRow[] = [
  { color: "#111111", label: "0 - 25", width: 60 },
  { color: "#222222", label: "25 - 50", width: 70 },
  { color: "#333333", label: "50 - 1,000", width: 110 }
];

test("the box holds its rows, and the widest one decides how wide it is", () => {
  const layout = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80 });
  assert.equal(layout.rows.length, 3);
  // Padding, swatch, gap and the widest label.
  assert.equal(Math.round(layout.width), 22 * 2 + 22 + 12 + 110);
  assert.ok(layout.height > 150 && layout.height < 230, `${layout.height} px tall`);
  // Rows go down the box, evenly.
  const gaps = layout.rows.slice(1).map((row, i) => row.swatch.y - layout.rows[i].swatch.y);
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 0.001, `uneven rows: ${gaps.join(", ")}`);
  // Nothing sticks out of the box.
  for (const row of layout.rows) {
    assert.ok(row.swatch.x >= layout.padding - 0.001 && row.swatch.y + row.swatch.height <= layout.height - layout.padding + 0.001, JSON.stringify(row.swatch));
    assert.ok(row.text.x + rows[layout.rows.indexOf(row)].width <= layout.width - layout.padding + 0.001);
  }
  assert.ok(layout.title.y < layout.rows[0].swatch.y, "the title is above the rows");
});

test("a title that is wider than the rows makes the box wider", () => {
  const layout = legendLayout(rows, { height: 1080, title: "People per square kilometre", titleWidth: 400 });
  assert.equal(Math.round(layout.width), 22 * 2 + 400);
});

test("without a title the rows start at the top", () => {
  const withTitle = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80 });
  const without = legendLayout(rows, { height: 1080, title: "", titleWidth: 0 });
  assert.ok(without.height < withTitle.height);
  assert.equal(without.rows[0].swatch.y, without.padding + (Math.max(22, 20 * 1.2) - 22) / 2);
});

test("everything scales with the comp", () => {
  const small = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80 });
  const big = legendLayout(rows.map((row) => ({ ...row, width: row.width * 2 })), { height: 2160, title: "People", titleWidth: 160 });
  assert.equal(big.scale, 2);
  assert.ok(Math.abs(big.width - small.width * 2) < 0.001);
  assert.ok(Math.abs(big.height - small.height * 2) < 0.001);
});

test("the box sits in the corner it is asked for, inside the frame", () => {
  const layout = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80 });
  const comp = { width: 1920, height: 1080 };
  const bottomLeft = legendPosition(layout, comp, "bottomLeft");
  assert.equal(Math.round(bottomLeft.x), 48);
  assert.equal(Math.round(bottomLeft.y), Math.round(1080 - 48 - layout.height));
  const topRight = legendPosition(layout, comp, "topRight");
  assert.equal(Math.round(topRight.x), Math.round(1920 - 48 - layout.width));
  assert.equal(Math.round(topRight.y), 48);
});

test("a legend of bubble sizes draws circles under the colours", () => {
  const sizes = [
    { radius: 40, label: "1,000", width: 80 },
    { radius: 20, label: "250", width: 60 },
    { radius: 10, label: "62.5", width: 60 }
  ];
  const layout = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80, sizes, sizeColor: "#ff9d2e" });
  assert.equal(layout.rows.length, 6);
  assert.deepEqual(layout.rows.map((row) => row.shape), ["rect", "rect", "rect", "circle", "circle", "circle"]);
  // The column is as wide as the biggest circle, and every swatch is centred in it.
  const centres = layout.rows.map((row) => Math.round((row.swatch.x + row.swatch.width / 2) * 100) / 100);
  assert.equal(new Set(centres).size, 1, `swatches are not in one column: ${centres.join(", ")}`);
  assert.equal(layout.rows[3].swatch.width, 80);
  assert.equal(layout.rows[3].color, "#ff9d2e");
  // Nothing sticks out of the box.
  for (const row of layout.rows) {
    assert.ok(row.swatch.x >= layout.padding - 0.001, JSON.stringify(row.swatch));
    assert.ok(row.swatch.y + row.swatch.height <= layout.height - layout.padding + 0.001, JSON.stringify(row.swatch));
  }
  // Circles take the room they need, so the box grows.
  const withoutSizes = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80 });
  assert.ok(layout.height > withoutSizes.height + 100, `${layout.height} against ${withoutSizes.height}`);
});

test("a legend of sizes alone is as wide as its circles", () => {
  const layout = legendLayout([], { height: 1080, title: "", titleWidth: 0, sizes: [{ radius: 30, label: "100", width: 50 }] });
  assert.equal(layout.rows.length, 1);
  assert.equal(Math.round(layout.width), Math.round(22 * 2 + 60 + 12 + 50));
});

test("a legend of spike heights draws triangles in the same column as the circles", () => {
  const sizes = [
    { spike: { width: 10, height: 120 }, label: "1,000", width: 80 },
    { spike: { width: 10, height: 60 }, label: "500", width: 60 },
    { radius: 20, label: "250", width: 60 }
  ];
  const layout = legendLayout(rows, { height: 1080, title: "People", titleWidth: 80, sizes, sizeColor: "#ff9d2e" });
  assert.deepEqual(layout.rows.map((row) => row.shape), ["rect", "rect", "rect", "spike", "spike", "circle"]);
  const spike = layout.rows[3];
  assert.equal(spike.swatch.width, 10);
  assert.equal(spike.swatch.height, 120);
  assert.equal(spike.color, "#ff9d2e");
  // Every swatch is centred in the one column, and a spike takes the room its height needs.
  const centres = layout.rows.map((row) => Math.round((row.swatch.x + row.swatch.width / 2) * 100) / 100);
  assert.equal(new Set(centres).size, 1, "swatches are not in one column: " + centres.join(", "));
  assert.ok(layout.rows[4].swatch.y >= spike.swatch.y + 120 - 0.001, JSON.stringify([spike.swatch, layout.rows[4].swatch]));
  for (const row of layout.rows) {
    assert.ok(row.swatch.y + row.swatch.height <= layout.height - layout.padding + 0.001, JSON.stringify(row.swatch));
  }
});
