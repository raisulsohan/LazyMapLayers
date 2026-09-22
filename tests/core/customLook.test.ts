import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLook, followsTheLook, lookFromPalette, lookFromPicture, NO_LOOK, normaliseLook } from "../../src/core/style/customLook.ts";
import { contrast, fromHex, luminance } from "../../src/core/style/palette.ts";
import { themeById, THEMES } from "../../src/core/style/themes.ts";

const midnight = themeById("midnight");
const paper = themeById("paper");

test("a look that overrides nothing is the look it started as", () => {
  assert.ok(followsTheLook(NO_LOOK));
  assert.equal(applyLook(midnight, NO_LOOK), midnight);
  assert.deepEqual(normaliseLook(null), NO_LOOK);
  assert.deepEqual(normaliseLook({ ocean: "#ABCDEF", land: "nonsense", accent: 7 }), { ...NO_LOOK, ocean: "#abcdef" });
  assert.equal(followsTheLook({ ...NO_LOOK, land: "#123456" }), false);
});

test("everything else is worked out from the colours chosen", () => {
  const look = applyLook(midnight, { ...NO_LOOK, ocean: "#0b1020", land: "#1d2636", accent: "#ff9d2e" });
  assert.equal(look.ocean, "#0b1020");
  assert.equal(look.land, "#1d2636");
  assert.equal(look.accent, "#ff9d2e");
  assert.equal(look.dark, true, "dark land makes a dark look");
  assert.equal(look.countryFills, null, "a look of your own paints the land in one colour");
  assert.equal(look.satellite, false);
  // Roads, buildings and borders are all told apart from the land.
  for (const key of ["roadMinor", "roadMajor", "highway", "border", "buildingMid"] as const) {
    const value = look[key] as string;
    assert.ok(/^#[0-9a-f]{6}$/.test(value), `${key} is ${value}`);
    assert.ok(contrast(fromHex(value), fromHex(look.land)) > 1.05, `${key} (${value}) cannot be seen on the land`);
  }
  assert.ok(look.coastGlow, "a dark look glows along its coasts");
});

test("the names can always be read on the land", () => {
  for (const land of ["#ffffff", "#000000", "#1d2636", "#e8e2d4", "#7a7a7a", "#c1440e"]) {
    const look = applyLook(paper, { ...NO_LOOK, land, ocean: "#123456", accent: "#ff3399" });
    assert.ok(contrast(fromHex(look.text), fromHex(land)) >= 4.5, `names ${look.text} on land ${land}`);
    assert.ok(contrast(fromHex(look.textCountry), fromHex(land)) >= 4.5, `country names ${look.textCountry} on land ${land}`);
  }
});

test("a light land gives a light look, a dark one a dark look", () => {
  const light = applyLook(midnight, { ...NO_LOOK, land: "#f2efe6", ocean: "#cfe3f5", accent: "#c1440e" });
  assert.equal(light.dark, false);
  assert.equal(light.halo, "#ffffff");
  assert.equal(light.coastGlow, "", "a light look does not glow");
  assert.ok(luminance(fromHex(light.text)) < 0.35, "dark names on a light map");
  const dark = applyLook(paper, { ...NO_LOOK, land: "#12161f", ocean: "#070b12", accent: "#36b3ff" });
  assert.equal(dark.dark, true);
  assert.ok(luminance(fromHex(dark.text)) > 0.6, "light names on a dark map");
});

test("a palette becomes a look: sea, land and an accent", () => {
  const look = lookFromPalette(["#0a1626", "#24384f", "#c8a26a", "#e8e8e8", "#ff5d3a"]);
  assert.equal(look.ocean, "#0a1626", "the darkest is the sea");
  assert.equal(look.land, "#24384f");
  assert.equal(look.accent, "#ff5d3a", "the most colourful of the rest");
  // Asked for a light look, the lightest becomes the sea instead.
  const light = lookFromPalette(["#0a1626", "#24384f", "#c8a26a", "#f4f1ea", "#ff5d3a"], { dark: false });
  assert.equal(light.ocean, "#f4f1ea");
  assert.ok(contrast(fromHex(light.land!), fromHex(light.ocean!)) >= 1.25, "the land can be told from the sea");
  assert.deepEqual(lookFromPalette([]), NO_LOOK);
  assert.deepEqual(lookFromPalette(["not a colour"]), NO_LOOK);
});

test("one colour still makes a usable look", () => {
  const look = lookFromPalette(["#203040"]);
  assert.equal(look.ocean, "#203040");
  assert.ok(look.land && contrast(fromHex(look.land), fromHex("#203040")) > 1.05, `land ${look.land}`);
  assert.ok(look.accent, "there is something to draw pins in");
  const full = applyLook(midnight, look);
  assert.ok(contrast(fromHex(full.text), fromHex(full.land)) >= 4.5);
});

test("a picture becomes a look", () => {
  const blocks = [
    { hex: "#0b1a2b", count: 600 },
    { hex: "#274b6d", count: 250 },
    { hex: "#f2b544", count: 150 }
  ];
  const total = blocks.reduce((n, block) => n + block.count, 0);
  const rgba = new Uint8Array(total * 4);
  let at = 0;
  for (const block of blocks) {
    const [r, g, b] = fromHex(block.hex);
    for (let i = 0; i < block.count; i++) {
      rgba[at++] = r;
      rgba[at++] = g;
      rgba[at++] = b;
      rgba[at++] = 255;
    }
  }
  const look = lookFromPicture(rgba, { colours: 3 });
  assert.ok(luminance(fromHex(look.ocean!)) < luminance(fromHex(look.land!)), `sea ${look.ocean} land ${look.land}`);
  assert.ok(look.accent && luminance(fromHex(look.accent)) > 0.3, `accent ${look.accent}`);
});

test("every bundled look survives being rebuilt from its own colours", () => {
  for (const theme of THEMES) {
    const look = applyLook(theme, { ...NO_LOOK, ocean: theme.ocean, land: theme.land, accent: theme.accent });
    assert.equal(look.ocean, theme.ocean, theme.id);
    assert.ok(contrast(fromHex(look.text), fromHex(look.land)) >= 4.5, `${theme.id}: names ${look.text} on ${look.land}`);
  }
});
