import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGERY_SERVICES, imageryService, ownImageryFromService } from "../../src/core/style/imageryCatalogue.ts";
import { isTileAddress, normaliseOwnImagery, ownImagerySource } from "../../src/core/style/ownImagery.ts";

test("every open service in the catalogue is a usable, credited address", () => {
  assert.ok(IMAGERY_SERVICES.length >= 6);
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
});
