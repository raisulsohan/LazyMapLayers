import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HALO, DEFAULT_LABEL_SIZE, labelTemplateFollowsLook, normaliseLabelTemplate, NO_LABEL_OVERRIDE, resolveLabelTemplate, templateFonts } from "../../src/core/labels/labelTemplate.ts";
import { themeById } from "../../src/core/style/themes.ts";

test("without an override the names follow the look", () => {
  const midnight = themeById("midnight");
  const template = resolveLabelTemplate(midnight);
  assert.equal(template.color, midnight.text);
  assert.equal(template.countryColor, midnight.textCountry);
  assert.equal(template.haloColor, midnight.halo);
  assert.equal(template.size, DEFAULT_LABEL_SIZE);
  assert.equal(template.countrySize, 24);
  assert.equal(template.halo, DEFAULT_HALO);
  assert.equal(template.caps, true);
  assert.equal(template.dots, true);
  assert.equal(template.font, null);
  // A light look gives dark names.
  assert.notEqual(resolveLabelTemplate(themeById("paper")).color, template.color);
  assert.ok(labelTemplateFollowsLook(NO_LABEL_OVERRIDE));
});

test("country names grow with the city names, and an override wins field by field", () => {
  const template = resolveLabelTemplate(themeById("midnight"), { ...NO_LABEL_OVERRIDE, size: 42, caps: false, color: "#ff0088" });
  assert.equal(template.size, 42);
  assert.equal(template.countrySize, 48, "the country size keeps its ratio");
  assert.equal(template.caps, false);
  assert.equal(template.color, "#ff0088");
  assert.equal(template.countryColor, themeById("midnight").textCountry, "what is not set still follows the look");
  assert.equal(labelTemplateFollowsLook({ ...NO_LABEL_OVERRIDE, size: 42 }), false);
});

test("stored templates are cleaned up before they are used", () => {
  assert.deepEqual(normaliseLabelTemplate(null), NO_LABEL_OVERRIDE);
  assert.deepEqual(normaliseLabelTemplate({ color: "#ABCDEF", size: 33.33, halo: 2.5, caps: false, dots: true, font: " MyFont-Bold " }), {
    ...NO_LABEL_OVERRIDE,
    color: "#abcdef",
    size: 33.3,
    halo: 2.5,
    caps: false,
    dots: true,
    font: "MyFont-Bold"
  });
  assert.deepEqual(normaliseLabelTemplate({ color: "red", size: "20", halo: -4, font: 7 }), { ...NO_LABEL_OVERRIDE, halo: 0 });
  assert.equal(normaliseLabelTemplate({ size: 9999 }).size, 200);
});

test("a picked-up font is used where it can shape the script, and never where it cannot", () => {
  const template = resolveLabelTemplate(themeById("midnight"), { ...NO_LABEL_OVERRIDE, font: "BrandSans-Bold" });
  assert.deepEqual(templateFonts(template, ["NotoSans-Bold", "Arial-BoldMT"], "latin"), ["BrandSans-Bold", "NotoSans-Bold", "Arial-BoldMT"]);
  assert.deepEqual(templateFonts(template, ["NotoSansCyrillic"], "cyrillic"), ["BrandSans-Bold", "NotoSansCyrillic"]);
  assert.deepEqual(templateFonts(template, ["NotoSansBengali-Bold"], "bengali"), ["NotoSansBengali-Bold"], "Bengali keeps the fonts that shape it");
  assert.deepEqual(templateFonts(template, ["NotoSansArabic-Bold"], "arabic"), ["NotoSansArabic-Bold"]);
  const plain = resolveLabelTemplate(themeById("midnight"));
  assert.deepEqual(templateFonts(plain, ["NotoSans-Bold"], "latin"), ["NotoSans-Bold"]);
});
