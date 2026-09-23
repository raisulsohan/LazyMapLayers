import { test } from "node:test";
import assert from "node:assert/strict";
import { describeOwnImagery, isTileAddress, normaliseOwnImagery, OWN_IMAGERY_LAYER, OWN_IMAGERY_SOURCE, ownImageryLayer, ownImagerySource } from "../../src/core/style/ownImagery.ts";

test("only web addresses with a tile template, or a PMTiles archive, are tile addresses", () => {
  assert.ok(isTileAddress("https://tiles.example.org/ortho/{z}/{x}/{y}.jpg?key=abc"));
  assert.ok(isTileAddress("http://127.0.0.1:8123/{z}/{x}/{y}.png"));
  assert.ok(isTileAddress("https://example.org/ortho.pmtiles"));
  assert.ok(isTileAddress("https://example.org/ortho.pmtiles?token=1"));
  assert.ok(!isTileAddress("https://tiles.example.org/ortho/{z}/{x}.jpg"), "no {y}");
  assert.ok(!isTileAddress("C:/tiles/{z}/{x}/{y}.png"), "a local path is not served");
  assert.ok(!isTileAddress("ftp://example.org/{z}/{x}/{y}.png"));
  assert.ok(!isTileAddress("https://example.org/{z}/{x}/{y} .png"), "no spaces");
});

test("a stored setting is repaired, and one without a usable address is none", () => {
  assert.equal(normaliseOwnImagery(null), null);
  assert.equal(normaliseOwnImagery({ url: "nonsense" }), null);
  const own = normaliseOwnImagery({ url: "  https://t.example.org/{z}/{x}/{y}.png ", attribution: "  © Example Survey ", opacity: 7, tileSize: 300, maxZoom: 18.6 })!;
  assert.equal(own.url, "https://t.example.org/{z}/{x}/{y}.png");
  assert.equal(own.attribution, "© Example Survey");
  assert.equal(own.opacity, 1);
  assert.equal(own.tileSize, 256);
  assert.equal(own.maxZoom, 19);
  const plain = normaliseOwnImagery({ url: "https://t.example.org/{z}/{x}/{y}.png", tileSize: 512, opacity: 0.5 })!;
  assert.equal(plain.attribution, "");
  assert.equal(plain.tileSize, 512);
  assert.equal(plain.opacity, 0.5);
  assert.equal(plain.maxZoom, null);
});

test("the source and the layer the style gets", () => {
  const xyz = normaliseOwnImagery({ url: "https://t.example.org/{z}/{x}/{y}.png", attribution: "Example", opacity: 0.8, maxZoom: 17 })!;
  assert.deepEqual(ownImagerySource(xyz), { type: "raster", tiles: ["https://t.example.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "Example", maxzoom: 17 });
  const archive = normaliseOwnImagery({ url: "https://example.org/ortho.pmtiles", tileSize: 512 })!;
  assert.deepEqual(ownImagerySource(archive), { type: "raster", url: "pmtiles://https://example.org/ortho.pmtiles", tileSize: 512, attribution: "" });
  const layer = ownImageryLayer(xyz);
  assert.equal(layer.id, OWN_IMAGERY_LAYER);
  assert.equal(layer.source, OWN_IMAGERY_SOURCE);
  assert.equal(layer.metadata["lml:group"], "imagery");
  assert.equal(layer.paint["raster-opacity"], 0.8);
  assert.equal(layer.paint["raster-fade-duration"], 0, "no cross-fade: frames must not depend on the frame before");
  assert.equal(describeOwnImagery(xyz), "tiles from t.example.org (Example) at 80 %");
});
