import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLabelTemplate } from "../../src/core/labels/labelTemplate.ts";
import { capsFor, dotStyle, isCountryLabel, restylePlan, textStyle, type PlacedLabel } from "../../src/core/labels/restyle.ts";
import { themeById } from "../../src/core/style/themes.ts";

const paper = themeById("paper");
const placed: PlacedLabel[] = [
  { labelId: "country:FRA:France", part: "text", text: "FRANCE", raw: "France" },
  { labelId: "country:FRA:France", part: "subtitle", text: "France" },
  { labelId: "country:GRC:Greece", part: "text", text: "ΕΛΛΆΔΑ", raw: "Ελλάδα" },
  { labelId: "country:JPN:Japan", part: "text", text: "日本", raw: "日本" },
  { labelId: "place:1", part: "text", text: "Paris", raw: "Paris" },
  { labelId: "place:1", part: "dot", text: "" },
  { labelId: "place:2", part: "text", text: "Lyon" },
  { labelId: "value:BGD", part: "text", text: "171" }
];

test("a name's style follows the template and its script, at the comp's scale", () => {
  const template = resolveLabelTemplate(paper, { color: "#ff3399", countryColor: null, haloColor: null, halo: 4, size: 20, caps: true, dots: true, font: "MyFont-Bold" });
  const city = textStyle(template, 2, { country: false, script: "latin", part: "text" });
  assert.equal(city.size, 40);
  assert.deepEqual(city.color, [1, 0.2, 0.6]);
  assert.equal(city.haloWidth, 8);
  assert.equal(city.fonts[0], "MyFont-Bold", "the user's font leads for Latin");
  assert.equal(city.tracking, 0);
  const country = textStyle(template, 1, { country: true, script: "latin", part: "text" });
  assert.equal(country.size, template.countrySize);
  assert.equal(country.tracking, 160, "capitals get letter spacing");
  const bengali = textStyle(template, 1, { country: true, script: "bengali", part: "text" });
  assert.notEqual(bengali.fonts[0], "MyFont-Bold", "a font that cannot shape the script is not used for it");
  assert.equal(bengali.tracking, 0, "no capitals in Bengali, so no spacing either");
  const arabic = textStyle(template, 1, { country: false, script: "arabic", part: "text" });
  assert.ok(arabic.rtl);
  const sub = textStyle(template, 1, { country: true, script: "latin", part: "subtitle" });
  assert.equal(sub.size, Math.round(template.countrySize * 0.62));
  assert.equal(sub.tracking, 20);
  assert.deepEqual(dotStyle(template, 2), { radius: 9, color: [1, 0.2, 0.6], strokeColor: dotStyle(template, 2).strokeColor, strokeWidth: 4 });
  assert.ok(isCountryLabel("country:FRA:France") && !isCountryLabel("place:1") && !isCountryLabel("value:BGD"));
  assert.ok(capsFor(template, true, "cyrillic") && !capsFor(template, false, "latin") && !capsFor(template, true, "han"));
});

test("the plan restyles every part, puts capitals on and takes them off from the words a name was placed with", () => {
  const caps = resolveLabelTemplate(paper, { color: null, countryColor: null, haloColor: null, halo: null, size: 30, caps: true, dots: true, font: null });
  const on = restylePlan(placed, caps, 1);
  assert.equal(on.texts.length, 7, "every text layer, subtitles and values too");
  const france = on.texts.find((t) => t.labelId === "country:FRA:France" && t.part === "text")!;
  assert.equal(france.text, "FRANCE");
  assert.equal(france.style.size, caps.countrySize);
  assert.equal(on.texts.find((t) => t.labelId === "country:JPN:Japan")!.text, "日本", "no capitals in a script without them");
  assert.equal(on.texts.find((t) => t.labelId === "value:BGD")!.text, "171", "a value is not a country");
  assert.equal(on.texts.find((t) => t.part === "subtitle")!.text, "France", "subtitles are never capitals");
  assert.deepEqual(on.dots.map((d) => d.labelId), ["place:1"]);
  assert.deepEqual(on.remove, []);
  assert.equal(on.dotsMissing, 2, "Lyon and the value have no dot (the value is not a place, but the caller decides that)");

  const off = resolveLabelTemplate(paper, { color: null, countryColor: null, haloColor: null, halo: null, size: 30, caps: false, dots: false, font: null });
  const plain = restylePlan(placed, off, 1);
  assert.equal(plain.texts.find((t) => t.labelId === "country:FRA:France" && t.part === "text")!.text, "France", "the words it was placed with come back");
  assert.equal(plain.texts.find((t) => t.labelId === "country:GRC:Greece")!.text, "Ελλάδα");
  assert.equal(plain.texts.find((t) => t.labelId === "place:2")!.text, "Lyon", "an older label without raw words keeps what it shows");
  assert.deepEqual(plain.dots, []);
  assert.deepEqual(plain.remove, ["place:1"]);
  assert.equal(plain.dotsMissing, 0);
});
