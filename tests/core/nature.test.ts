import { strict as assert } from "node:assert";
import test from "node:test";
import { formatElevation, natureClassOf, natureLabelId, naturePriority, natureViewZoom, NATURE_CLASSES } from "../../src/core/labels/nature.ts";
import { resolveLabelTemplate } from "../../src/core/labels/labelTemplate.ts";
import { capsFor, dotStyle, restylePlan, textStyle } from "../../src/core/labels/restyle.ts";
import { buildPlaceIndex, searchPlaces, type PlaceRecord } from "../../src/core/search/placeSearch.ts";
import { contrast, fromHex } from "../../src/core/style/palette.ts";
import { THEMES, themeById } from "../../src/core/style/themes.ts";

test("a natural label's id carries its kind, and nothing else passes for one", () => {
  for (const kind of NATURE_CLASSES) assert.equal(natureClassOf(natureLabelId(kind, "1159115017")), kind);
  assert.equal(natureClassOf("place:123"), null);
  assert.equal(natureClassOf("country:IDN:Indonesia"), null);
  assert.equal(natureClassOf("nature:volcano:1"), null);
});

test("water is written in italic in the colour of water, the land in spaced capitals", () => {
  const template = resolveLabelTemplate(themeById("paper"));
  const sea = textStyle(template, 1, { country: false, script: "latin", part: "text", nature: "sea" });
  assert.equal(sea.fonts[0], "SegoeUI-SemiboldItalic");
  assert.deepEqual(sea.color, textStyle(template, 1, { country: false, script: "latin", part: "text", nature: "river" }).color);
  assert.equal(capsFor(template, false, "latin", "sea"), false);

  const ocean = textStyle(template, 1, { country: false, script: "latin", part: "text", nature: "ocean" });
  assert.equal(capsFor(template, false, "latin", "ocean"), true);
  assert.ok(ocean.tracking >= 400 && ocean.size > sea.size, JSON.stringify(ocean));

  const range = textStyle(template, 1, { country: false, script: "latin", part: "text", nature: "range" });
  assert.equal(capsFor(template, false, "latin", "range"), true);
  assert.ok(!range.fonts[0].includes("Italic") && range.tracking >= 300);
  assert.notDeepEqual(range.color, sea.color);
});

test("scripts without capitals or italics are left upright and unspaced", () => {
  const template = resolveLabelTemplate(themeById("paper"));
  for (const script of ["bengali", "arabic", "han"] as const) {
    const ocean = textStyle(template, 1, { country: false, script, part: "text", nature: "ocean" });
    assert.equal(capsFor(template, false, script, "ocean"), false);
    assert.equal(ocean.tracking, 0, script);
    assert.ok(!ocean.fonts.some((font) => font.includes("Italic")), `${script} got ${ocean.fonts.join(",")}`);
  }
});

test("on every look the water names read on the sea and the land names on the land", () => {
  for (const theme of THEMES) {
    const template = resolveLabelTemplate(theme);
    const onSea = contrast(fromHex(template.waterColor), fromHex(theme.ocean));
    const onLand = contrast(fromHex(template.natureColor), fromHex(theme.land));
    assert.ok(onSea >= 3, `${theme.id}: water names at ${onSea.toFixed(2)} on the sea`);
    assert.ok(onLand >= 3, `${theme.id}: land names at ${onLand.toFixed(2)} on the land`);
  }
});

test("a peak keeps its triangle when city dots are switched off", () => {
  const template = { ...resolveLabelTemplate(themeById("paper")), dots: false };
  assert.equal(dotStyle(template, 1, "peak").shape, "triangle");
  assert.equal(dotStyle(template, 1).shape, "circle");
  const plan = restylePlan(
    [
      { labelId: "nature:peak:1", part: "text", text: "Mount Everest" },
      { labelId: "nature:peak:1", part: "dot", text: "" },
      { labelId: "nature:sea:2", part: "text", text: "Bay of Bengal" },
      { labelId: "place:3", part: "dot", text: "" }
    ],
    template,
    1
  );
  assert.deepEqual(plan.dots.map((d) => d.labelId), ["nature:peak:1"]);
  assert.deepEqual(plan.remove, ["place:3"]);
  const bay = plan.texts.find((t) => t.labelId === "nature:sea:2")!;
  assert.equal(bay.text, "Bay of Bengal");
  assert.equal(bay.style.fonts[0], "SegoeUI-SemiboldItalic");
  assert.equal(plan.dotsMissing, 0);
});

test("oceans claim their room before seas, and seas before rivers of the same rank", () => {
  assert.ok(naturePriority("ocean", 0) < 15, "an ocean should come before the largest countries");
  assert.ok(naturePriority("sea", 3) < naturePriority("river", 3));
  assert.ok(naturePriority("peak", 1, 8848) < naturePriority("peak", 1, 2000));
});

test("heights are written with thousands separators and metres", () => {
  assert.equal(formatElevation(8848.4), "8,848 m");
  assert.equal(formatElevation(612), "612 m");
  assert.equal(formatElevation(-430), "-430 m");
});

test("the search finds seas, ranges and peaks and flies to a zoom that frames them", () => {
  const nature: PlaceRecord[] = [
    { id: "nature:sea:1", kind: "nature", nature: "sea", minZoom: 2, lat: 12.4, lng: 86.4, country: "", rank: 1, population: 0, names: { en: "Bay of Bengal", bn: "বঙ্গোপসাগর" } },
    { id: "nature:peak:2", kind: "nature", nature: "peak", minZoom: 4, elevation: 8848, lat: 27.98, lng: 86.88, country: "NPL", rank: 1, population: 0, names: { en: "Mount Everest" } }
  ];
  const countries: PlaceRecord[] = [{ id: "country:NPL:Nepal", kind: "country", lat: 28, lng: 84, country: "NPL", rank: 3, population: 30000000, names: { en: "Nepal" } }];
  const index = buildPlaceIndex({ countries, places: [], nature });
  const bay = searchPlaces(index, "bay of beng")[0];
  assert.equal(bay.kind, "nature");
  assert.equal(bay.detail, "Sea");
  assert.ok(bay.zoom! > 1.5 && bay.zoom! < 4, String(bay.zoom));
  const inBengali = searchPlaces(index, "বঙ্গোপ")[0];
  assert.equal(inBengali.id, "nature:sea:1");
  const everest = searchPlaces(index, "everest")[0];
  assert.equal(everest.detail, "Peak, 8,848 m · Nepal");
  assert.ok(everest.zoom! >= 8.5, String(everest.zoom));
  assert.ok(natureViewZoom("ocean", 1) < natureViewZoom("river", 4));
});
