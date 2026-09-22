import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, fromHex, luminance, palette, readableOn, saturation, toHex } from "../../src/core/style/palette.ts";

/** A picture of flat blocks: `counts` says how many pixels each colour fills. */
const picture = (blocks: { hex: string; count: number }[]): Uint8Array => {
  const total = blocks.reduce((n, block) => n + block.count, 0);
  const out = new Uint8Array(total * 4);
  let at = 0;
  for (const block of blocks) {
    const [r, g, b] = fromHex(block.hex);
    for (let i = 0; i < block.count; i++) {
      out[at++] = r;
      out[at++] = g;
      out[at++] = b;
      out[at++] = 255;
    }
  }
  return out;
};

test("the colours of a picture come back, the commonest first", () => {
  const found = palette(picture([{ hex: "#102040", count: 500 }, { hex: "#e0c080", count: 300 }, { hex: "#a03020", count: 100 }]), 3);
  assert.equal(found.length, 3);
  const near = (hex: string, want: string, slack = 10) => {
    const a = fromHex(hex);
    const b = fromHex(want);
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= slack;
  };
  assert.ok(near(found[0], "#102040"), found.join(", "));
  assert.ok(near(found[1], "#e0c080"), found.join(", "));
  assert.ok(near(found[2], "#a03020"), found.join(", "));
});

test("the same picture always gives the same palette, and an empty one gives none", () => {
  const image = picture([{ hex: "#123456", count: 40 }, { hex: "#abcdef", count: 60 }]);
  assert.deepEqual(palette(image, 4), palette(image, 4));
  assert.deepEqual(palette(new Uint8Array(0)), []);
  // Nearly transparent pixels are not part of the picture.
  const ghost = new Uint8Array([255, 0, 0, 10, 255, 0, 0, 10]);
  assert.deepEqual(palette(ghost), []);
  // Asking for more colours than the picture holds gives what there is.
  assert.ok(palette(picture([{ hex: "#ffffff", count: 5 }]), 8).length <= 8);
});

test("light and dark are measured the way a screen shows them", () => {
  assert.ok(luminance(fromHex("#ffffff")) > 0.99);
  assert.ok(luminance(fromHex("#000000")) < 0.01);
  // Green looks far lighter than blue at the same value.
  assert.ok(luminance(fromHex("#00ff00")) > luminance(fromHex("#0000ff")) * 5);
  assert.ok(Math.abs(contrast(fromHex("#ffffff"), fromHex("#000000")) - 21) < 0.01);
  assert.equal(saturation(fromHex("#808080")), 0);
  assert.ok(saturation(fromHex("#ff0000")) > 0.99);
  assert.equal(toHex([300, -5, 12.6]), "#ff000d");
});

test("a colour is pushed until it can be read on its background", () => {
  const onDark = readableOn(fromHex("#333a44"), fromHex("#1a1f28"));
  assert.ok(contrast(onDark, fromHex("#1a1f28")) >= 4.5, toHex(onDark));
  assert.ok(luminance(onDark) > luminance(fromHex("#333a44")), "on a dark map it goes lighter");
  const onLight = readableOn(fromHex("#d8d4cc"), fromHex("#f4f1ea"));
  assert.ok(contrast(onLight, fromHex("#f4f1ea")) >= 4.5, toHex(onLight));
  assert.ok(luminance(onLight) < luminance(fromHex("#d8d4cc")), "on a light map it goes darker");
  // A colour that already reads is left alone.
  assert.deepEqual(readableOn(fromHex("#ffffff"), fromHex("#000000")), fromHex("#ffffff"));
});
