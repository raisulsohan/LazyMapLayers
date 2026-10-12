import { test } from "node:test";
import assert from "node:assert/strict";
import { countsRowsFromSouth, describeOwnImagery, imageryKind, isTileAddress, localPathOf, normaliseOwnImagery, ownImageryFromWms, OWN_IMAGERY_LAYER, OWN_IMAGERY_SOURCE, ownImageryLayer, ownImagerySource } from "../../src/core/style/ownImagery.ts";

test("only web addresses with a tile template, or a PMTiles archive, are tile addresses", () => {
  assert.ok(isTileAddress("https://tiles.example.org/ortho/{z}/{x}/{y}.jpg?key=abc"));
  assert.ok(isTileAddress("http://127.0.0.1:8123/{z}/{x}/{y}.png"));
  assert.ok(isTileAddress("https://example.org/ortho.pmtiles"));
  assert.ok(isTileAddress("https://example.org/ortho.pmtiles?token=1"));
  assert.ok(!isTileAddress("https://tiles.example.org/ortho/{z}/{x}.jpg"), "no {y}");
  assert.ok(isTileAddress("https://tiles.example.org/tms/{z}/{x}/{-y}.png"), "rows counted from the south");
  assert.ok(countsRowsFromSouth("https://tiles.example.org/tms/{z}/{x}/{-y}.png") && !countsRowsFromSouth("https://t.example.org/{z}/{x}/{y}.png"));
  assert.ok(!isTileAddress("C:/tiles/photos.png"), "a local path that is neither a tile folder nor MBTiles");
  assert.ok(!isTileAddress("tiles/{z}/{x}/{y}.png"), "a relative path");
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
  assert.equal(own.minZoom, null);
  assert.equal(normaliseOwnImagery({ url: own.url, minZoom: 14, maxZoom: 18 })!.minZoom, 14);
  assert.equal(normaliseOwnImagery({ url: own.url, minZoom: 20, maxZoom: 18 })!.minZoom, null, "a first zoom past the last is dropped");
  const plain = normaliseOwnImagery({ url: "https://t.example.org/{z}/{x}/{y}.png", tileSize: 512, opacity: 0.5 })!;
  assert.equal(plain.attribution, "");
  assert.equal(plain.tileSize, 512);
  assert.equal(plain.opacity, 0.5);
  assert.equal(plain.maxZoom, null);
  assert.equal(plain.minZoom, null);
});

test("the source and the layer the style gets", () => {
  const xyz = normaliseOwnImagery({ url: "https://t.example.org/{z}/{x}/{y}.png", attribution: "Example", opacity: 0.8, maxZoom: 17 })!;
  assert.deepEqual(ownImagerySource(xyz), { type: "raster", tiles: ["https://t.example.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "Example", maxzoom: 17 });
  const archive = normaliseOwnImagery({ url: "https://example.org/ortho.pmtiles", tileSize: 512 })!;
  assert.deepEqual(ownImagerySource(archive), { type: "raster", url: "pmtiles://https://example.org/ortho.pmtiles", tileSize: 512, attribution: "" });
  const tms = ownImagerySource(normaliseOwnImagery({ url: "https://tiles.example.org/tms/{z}/{x}/{-y}.png" })!);
  assert.deepEqual(tms, { type: "raster", tiles: ["https://tiles.example.org/tms/{z}/{x}/{y}.png"], tileSize: 256, attribution: "", scheme: "tms" });
  const layer = ownImageryLayer(xyz);
  assert.equal(layer.id, OWN_IMAGERY_LAYER);
  assert.equal(layer.source, OWN_IMAGERY_SOURCE);
  assert.equal(layer.metadata["lml:group"], "imagery");
  assert.equal(layer.paint["raster-opacity"], 0.8);
  assert.equal(layer.paint["raster-fade-duration"], 0, "no cross-fade: frames must not depend on the frame before");
  assert.equal(describeOwnImagery(xyz), "tiles from t.example.org (Example) at 80 %");
});

test("the kinds of address (D103): web tiles, PMTiles, WMS, satellite areas, tile folders and MBTiles", () => {
  assert.equal(imageryKind("https://t.example.org/{z}/{x}/{y}.png"), "web");
  assert.equal(imageryKind("https://example.org/a.pmtiles"), "pmtiles");
  assert.equal(imageryKind("https://maps.example.org/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=a&BBOX={bbox-epsg-3857}"), "wms");
  assert.equal(imageryKind("satellite://dhaka"), "satellite");
  assert.equal(imageryKind("D:\\Drone tiles\\{z}\\{x}\\{y}.png"), "folder", "spaces are fine in a path");
  assert.equal(imageryKind("\\\\server\\share\\tiles\\{z}\\{x}\\{-y}.jpg"), "folder");
  assert.equal(imageryKind("/Users/me/tiles/{z}/{x}/{y}.webp"), "folder");
  assert.equal(imageryKind("E:/maps/city.MBTiles"), "mbtiles");
  assert.equal(imageryKind("file:///D:/maps/city%20centre.mbtiles"), "mbtiles");
  assert.equal(localPathOf("file:///D:/maps/city%20centre.mbtiles"), "D:/maps/city centre.mbtiles");
  assert.equal(localPathOf("file:///home/me/a.mbtiles"), "/home/me/a.mbtiles");
  assert.equal(imageryKind("https://maps.example.org/wms"), null, "a WMS address before a layer is picked");
  assert.equal(imageryKind("D:\\tiles"), null, "a folder before its layout is read");
});

test("local sources go through the panel's protocol; WMS keeps its template at the tile size; bounds limit every kind", () => {
  const local = (path: string, kind: "folder" | "mbtiles") => `lmllocal://${kind}-${path.length}/{z}/{x}/{y}`;
  const folder = normaliseOwnImagery({ url: "D:\\Tiles\\{z}\\{x}\\{-y}.png", attribution: "Drone survey", minZoom: 14, maxZoom: 19, bounds: [90.3, 23.7, 90.5, 23.9] })!;
  assert.deepEqual(ownImagerySource(folder, { local }), { type: "raster", tiles: ["lmllocal://folder-25/{z}/{x}/{y}"], tileSize: 256, attribution: "Drone survey", minzoom: 14, maxzoom: 19, bounds: [90.3, 23.7, 90.5, 23.9] });
  assert.equal(ownImagerySource(folder, { local }).scheme, undefined, "the protocol turns the rows itself");
  const mbtiles = normaliseOwnImagery({ url: "C:/maps/city.mbtiles" })!;
  assert.deepEqual(ownImagerySource(mbtiles, { local }).tiles, ["lmllocal://mbtiles-20/{z}/{x}/{y}"]);
  const wms = normaliseOwnImagery({ url: "https://m.example.org/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=a&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}", tileSize: 512 })!;
  assert.deepEqual(ownImagerySource(wms).tiles, ["https://m.example.org/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=a&WIDTH=512&HEIGHT=512&BBOX={bbox-epsg-3857}"]);
  assert.equal(normaliseOwnImagery({ url: "C:/maps/city.mbtiles", bounds: [10, 50, 5, 60] })!.bounds, undefined, "west past east is no bounds");
  assert.deepEqual(normaliseOwnImagery({ url: "C:/maps/city.mbtiles", bounds: [-200, -90, 200, 90] })!.bounds, [-180, -85.051129, 180, 85.051129]);
  assert.equal(describeOwnImagery(folder), 'tiles from the folder "Tiles" (Drone survey) at 100 %');
  assert.equal(describeOwnImagery(mbtiles), 'the MBTiles file "city.mbtiles" at 100 %');
  assert.equal(describeOwnImagery(wms), 'the WMS layer "a" from m.example.org at 100 %');
  // A satellite area still resolves by name, with the old function form too.
  assert.equal(ownImagerySource(normaliseOwnImagery({ url: "satellite://dhaka" })!, (name) => `pmtiles://lml-satellite-${name}`).url, "pmtiles://lml-satellite-dhaka");
});

test("a WMS layer becomes a setting with its template, credit, zooms and bounds", () => {
  const capabilities = { version: "1.3.0", getMap: "https://m.example.org/wms?" };
  const layer = { name: "ortho", title: "Ortho", crs: "EPSG:3857", bounds: [5, 45, 10, 48] as [number, number, number, number], attribution: "© Survey", minScale: 500, maxScale: 1000000 };
  const own = ownImageryFromWms(capabilities, "https://m.example.org/wms", layer, "image/jpeg", 256, 0.5)!;
  assert.equal(own.url, "https://m.example.org/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortho&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}");
  assert.deepEqual([own.attribution, own.opacity, own.tileSize, own.minZoom, own.maxZoom, own.bounds], ["© Survey", 0.5, 256, 10, 20, [5, 45, 10, 48]]);
});
