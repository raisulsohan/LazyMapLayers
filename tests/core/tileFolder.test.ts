import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTileFolder, folderTilePath, zoomFolders } from "../../src/core/imagery/tileFolder.ts";
import { latFromMercatorY, lngFromMercatorX } from "../../src/core/geo/mercator.ts";

test("zoom folders are the names that are numbers", () => {
  assert.deepEqual(zoomFolders(["12", "10", "11", "leaflet.html", "tilemapresource.xml", "9a", "031"]), [10, 11, 12]);
});

test("an XYZ folder: format, zooms and the area its lowest zoom covers", () => {
  const result = describeTileFolder({ names: ["14", "15", "16", "openlayers.html"], lowest: { z: 14, columns: [{ x: "11700", files: ["7000.png", "7001.png", "notes.txt"] }, { x: "11701", files: ["7000.png", "7001.jpg"] }] } });
  assert.ok(result.ok);
  const { layout } = result;
  assert.equal(layout.ext, "png");
  assert.equal(layout.tms, false);
  assert.equal(layout.minZoom, 14);
  assert.equal(layout.maxZoom, 16);
  assert.equal(layout.template, "{z}/{x}/{y}.png");
  const n = 2 ** 14;
  assert.deepEqual(layout.bounds, [lngFromMercatorX(11700 / n), latFromMercatorY(7002 / n), lngFromMercatorX(11702 / n), latFromMercatorY(7000 / n)]);
});

test("gdal2tiles' TMS folder counts rows from the south", () => {
  const result = describeTileFolder({ names: ["2", "3", "tilemapresource.xml"], lowest: { z: 2, columns: [{ x: "2", files: ["3.jpg", "2.jpg"] }] } });
  assert.ok(result.ok);
  assert.equal(result.layout.tms, true);
  assert.equal(result.layout.template, "{z}/{x}/{-y}.jpg");
  // TMS rows 2 and 3 of zoom 2 are the northern half.
  assert.equal(result.layout.bounds![3], latFromMercatorY(0));
  assert.equal(result.layout.bounds![1], latFromMercatorY(0.5));
  assert.equal(folderTilePath("D:\\Tiles\\{z}\\{x}\\{-y}.jpg", 2, 2, 0), "D:\\Tiles\\2\\2\\3.jpg");
  assert.equal(folderTilePath("/data/{z}/{x}/{y}.png", 5, 17, 9), "/data/5/17/9.png");
});

test("a folder without tiles says what is missing", () => {
  const none = describeTileFolder({ names: ["photos", "readme.txt"], lowest: null });
  assert.ok(!none.ok && /no zoom folders/.test(none.error));
  const empty = describeTileFolder({ names: ["3"], lowest: { z: 3, columns: [{ x: "1", files: ["a.tif", "2.tif"] }] } });
  assert.ok(!empty.ok && /no \.png/.test(empty.error));
});
