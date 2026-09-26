import { strict as assert } from "node:assert";
import test from "node:test";
import { fitScale, imageFor, imageIndex, imageKey } from "../../src/core/labels/designImages.ts";

test("file names are compared without case, accents or punctuation", () => {
  assert.equal(imageKey("Côte_d'Ivoire.PNG"), "cote d ivoire");
  assert.equal(imageKey("BGD.png"), "bgd");
});

test("a picture is found by the place's codes first, then by its names", () => {
  const index = imageIndex(["C:/flags/bd.png", "C:/flags/FRA.png", "C:/flags/Japan flag.jpg", "C:/flags/Côte d'Ivoire.png", "C:/flags/readme.txt"]);
  assert.equal(imageFor(index, ["BGD", "BD"], ["Bangladesh"]), "C:/flags/bd.png");
  assert.equal(imageFor(index, ["FRA", "FR"], ["France"]), "C:/flags/FRA.png");
  assert.equal(imageFor(index, ["JPN", "JP"], ["Japan", "日本"]), "C:/flags/Japan flag.jpg");
  assert.equal(imageFor(index, ["CIV", "CI"], ["Cote d'Ivoire"]), "C:/flags/Côte d'Ivoire.png");
  assert.equal(imageFor(index, ["NPL", "NP"], ["Nepal"]), null);
  assert.equal(imageFor(index, [], ["readme"]), null, "a text file is not a picture");
});

test("a picture fits its placeholder's box and keeps its shape", () => {
  // A 3:2 flag in a square 100 x 100 placeholder at 100 %: as wide as the box.
  assert.ok(Math.abs(fitScale({ width: 100, height: 100 }, { width: 300, height: 200 }, 100) - 100 / 3) < 1e-9);
  // A tall picture in a wide box: as tall as the box.
  assert.equal(fitScale({ width: 200, height: 100 }, { width: 100, height: 400 }, 50), 12.5);
});
