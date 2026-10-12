import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGERY_SERVICES, imageryService, ownImageryFromService } from "../../src/core/style/imageryCatalogue.ts";
import { imageryKind, isTileAddress, normaliseOwnImagery, ownImagerySource } from "../../src/core/style/ownImagery.ts";

test("every open service in the catalogue is a usable, credited address", () => {
  assert.ok(IMAGERY_SERVICES.length >= 10);
  const ids = new Set<string>();
  for (const service of IMAGERY_SERVICES) {
    assert.ok(!ids.has(service.id), `${service.id} twice`);
    ids.add(service.id);
    assert.ok(isTileAddress(service.url), `${service.id}: ${service.url}`);
    assert.ok(service.url.startsWith("https://"), `${service.id} is not https`);
    assert.ok(service.attribution.length > 3 && service.licence.length > 3 && service.terms.startsWith("https://"), `${service.id} lacks its credit or terms`);
    assert.ok(service.maxZoom >= 14 && service.maxZoom <= 24, `${service.id} max zoom ${service.maxZoom}`);
    if (service.minZoom !== null) assert.ok(service.minZoom < service.maxZoom, `${service.id} zooms`);
    const own = normaliseOwnImagery(ownImageryFromService(service));
    assert.ok(own, `${service.id} does not survive normalising`);
    assert.equal(own!.attribution, service.attribution);
    assert.equal(own!.maxZoom, service.maxZoom);
    assert.equal(own!.minZoom, service.minZoom);
  }
  assert.equal(imageryService("nope"), null);
  assert.equal(imageryService("gsi")!.country, "Japan");
});

test("a service that has no tiles below a zoom asks for none there", () => {
  const gsi = ownImageryFromService(imageryService("gsi")!);
  const source = ownImagerySource(normaliseOwnImagery(gsi)!);
  assert.equal(source.minzoom, 14);
  assert.equal(source.maxzoom, 18);
  const usgs = ownImagerySource(normaliseOwnImagery(ownImageryFromService(imageryService("usgs")!))!);
  assert.equal(usgs.minzoom, undefined);
  const estonia = ownImagerySource(normaliseOwnImagery(ownImageryFromService(imageryService("maaamet")!))!);
  assert.equal(estonia.scheme, "tms", "Estonia counts rows from the south");
  assert.ok(estonia.tiles![0].endsWith("/{z}/{x}/{y}.png"));
});

test("every entry has its licence on record, with the date it was checked; the WMS services are asked in Web Mercator inside their area (D103)", () => {
  assert.ok(IMAGERY_SERVICES.length >= 17);
  for (const service of IMAGERY_SERVICES) {
    assert.match(service.checked, /^\d{4}-\d{2}-\d{2}$/, `${service.id} has no check date`);
    assert.ok(service.licence.length > 3 && service.terms.startsWith("https://"), `${service.id} lacks its licence or terms`);
    assert.ok(!/esri|bing|google|virtualearth|arcgisonline/i.test(new URL(service.url.replace("{bbox-epsg-3857}", "0")).host), `${service.id}: no Esri, Bing or Google (D2)`);
    if (imageryKind(service.url) !== "wms") continue;
    assert.ok(service.url.includes("CRS=EPSG:3857") && service.url.includes("REQUEST=GetMap"), service.id);
    assert.ok(service.bounds, `${service.id} has no area`);
    const own = normaliseOwnImagery(ownImageryFromService(service))!;
    assert.deepEqual(own.bounds, service.bounds);
    assert.deepEqual(ownImagerySource(own).bounds, service.bounds);
  }
  assert.equal(IMAGERY_SERVICES.filter((s) => imageryKind(s.url) === "wms").length, 7);
});
