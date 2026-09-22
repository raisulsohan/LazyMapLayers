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
