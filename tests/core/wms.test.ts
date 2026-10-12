import { test } from "node:test";
import assert from "node:assert/strict";
import { childText, parseXml, pathOf } from "../../src/core/data/xml.ts";
import { capabilitiesUrl, defaultFormat, getMapBase, parseWmsCapabilities, SCALE_AT_ZOOM_0, wmsTemplate, wmsTemplateInfo, wmsZooms, withTileSize, zoomOfScale } from "../../src/core/imagery/wms.ts";

test("the XML reader: elements, attributes, text, prefixes, entities, CDATA and what it skips", () => {
  const root = parseXml(`﻿<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE WMT_MS_Capabilities SYSTEM "http://x/capabilities_1_1_1.dtd" [ <!ELEMENT VendorSpecificCapabilities EMPTY> ]>
<!-- a comment with <tags> -->
<wms:Root xmlns:wms="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink" version='1.3.0'>
  <wms:Title>Ortho &amp; more &#169; &#x263A;</wms:Title>
  <Link xlink:href="https://example.org/wms?a=1&amp;b=2" />
  <Note><![CDATA[<not a tag> & raw]]></Note>
  <Empty></Empty>
  <Attr a="x > y" b='quote "inside"'/>
</wms:Root>`);
  assert.equal(root.name, "Root");
  assert.equal(root.attrs.version, "1.3.0");
  assert.equal(childText(root, "Title"), "Ortho & more © ☺");
  assert.equal(pathOf(root, "Link")?.attrs.href, "https://example.org/wms?a=1&b=2");
  assert.equal(childText(root, "note"), "<not a tag> & raw");
  assert.equal(childText(root, "Empty"), "");
  assert.deepEqual(pathOf(root, "Attr")?.attrs, { a: "x > y", b: 'quote "inside"' });
  assert.throws(() => parseXml("<a><b></a>"), /closes nothing open|never closed/);
  assert.throws(() => parseXml("<a>"), /never closed/);
  assert.throws(() => parseXml("just text"), /no element/);
});

const CAPABILITIES_130 = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Service><Name>WMS</Name><Title>National orthophoto</Title><AccessConstraints>CC BY 4.0</AccessConstraints><Fees>none</Fees></Service>
  <Capability>
    <Request>
      <GetCapabilities><Format>text/xml</Format></GetCapabilities>
      <GetMap>
        <Format>image/jpeg</Format><Format>image/png</Format><Format>image/png; mode=8bit</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="https://maps.example.org/ows?map=/srv/ortho.map&amp;"/></Get></HTTP></DCPType>
      </GetMap>
    </Request>
    <Layer>
      <Title>All layers</Title>
      <CRS>EPSG:4326</CRS><CRS>EPSG:25832</CRS>
      <EX_GeographicBoundingBox><westBoundLongitude>5.5</westBoundLongitude><eastBoundLongitude>15.5</eastBoundLongitude><southBoundLatitude>47</southBoundLatitude><northBoundLatitude>55.1</northBoundLatitude></EX_GeographicBoundingBox>
      <Attribution><Title>© Example Survey</Title></Attribution>
      <Layer queryable="0"><Name>ortho_rgb</Name><Title>Orthophoto (colour)</Title><CRS>EPSG:3857</CRS><MaxScaleDenominator>1000000</MaxScaleDenominator><MinScaleDenominator>500</MinScaleDenominator></Layer>
      <Layer><Name>ortho_cir</Name><Title>Infrared</Title></Layer>
      <Layer><Title>Group</Title><CRS>EPSG:900913</CRS>
        <Layer><Name>old_photos</Name><Title>1950s</Title><Attribution><Title>Archive</Title></Attribution>
          <EX_GeographicBoundingBox><westBoundLongitude>6</westBoundLongitude><eastBoundLongitude>7</eastBoundLongitude><southBoundLatitude>50</southBoundLatitude><northBoundLatitude>51</northBoundLatitude></EX_GeographicBoundingBox>
        </Layer>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

test("a WMS 1.3.0 answer: the GetMap address, formats, and each named layer with what it inherits", () => {
  const parsed = parseWmsCapabilities(CAPABILITIES_130);
  assert.ok(parsed.ok);
  const cap = parsed.value;
  assert.equal(cap.version, "1.3.0");
  assert.equal(cap.title, "National orthophoto");
  assert.equal(cap.access, "CC BY 4.0");
  assert.equal(cap.getMap, "https://maps.example.org/ows?map=/srv/ortho.map&");
  assert.deepEqual(cap.formats, ["image/jpeg", "image/png", "image/png; mode=8bit"]);
  assert.deepEqual(cap.layers.map((l) => [l.name, l.crs, l.attribution]), [["ortho_rgb", "EPSG:3857", "© Example Survey"], ["ortho_cir", null, "© Example Survey"], ["old_photos", "EPSG:900913", "Archive"]]);
  assert.deepEqual(cap.layers[0].bounds, [5.5, 47, 15.5, 55.1]);
  assert.deepEqual(cap.layers[2].bounds, [6, 50, 7, 51]);
  assert.equal(cap.layers[0].maxScale, 1000000);
  assert.equal(cap.layers[0].minScale, 500);
  assert.equal(cap.layers[1].maxScale, null);
});

test("a WMS 1.1.1 answer: SRS lists, LatLonBoundingBox and scale hints", () => {
  const parsed = parseWmsCapabilities(`<?xml version="1.0"?>
<!DOCTYPE WMT_MS_Capabilities SYSTEM "http://schemas.opengis.net/wms/1.1.1/WMS_MS_Capabilities.dtd">
<WMT_MS_Capabilities version="1.1.1">
  <Service><Title>City aerials</Title></Service>
  <Capability><Request><GetMap><Format>image/jpeg</Format>
    <DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="http://10.0.0.5:8080/geoserver/wms?"/></Get></HTTP></DCPType></GetMap></Request>
    <Layer><Title>root</Title><SRS>EPSG:4326 EPSG:102100</SRS>
      <Layer><Name>aerial</Name><Title>Aerial 2024</Title><LatLonBoundingBox minx="-74.3" miny="40.4" maxx="-73.6" maxy="41"/><ScaleHint min="0.0989" max="989.9"/></Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`);
  assert.ok(parsed.ok);
  const layer = parsed.value.layers[0];
  assert.equal(parsed.value.version, "1.1.1");
  assert.equal(layer.crs, "EPSG:102100");
  assert.deepEqual(layer.bounds, [-74.3, 40.4, -73.6, 41]);
  // A pixel diagonal of 0.0989 m is a scale of about 1:250.
  assert.ok(Math.abs(layer.minScale! - 0.0989 / Math.SQRT2 / 0.00028) < 1e-6);
  // The server named an address inside its own network: requests go to the address the user gave.
  assert.equal(getMapBase(parsed.value.getMap, "https://gis.example.gov/geoserver/wms"), "https://gis.example.gov/geoserver/wms");
  const template = wmsTemplate(parsed.value, "https://gis.example.gov/geoserver/wms", layer, "image/jpeg", 256);
  assert.equal(template, "https://gis.example.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=aerial&STYLES=&FORMAT=image%2Fjpeg&SRS=EPSG:102100&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}");
});

test("errors: an exception report, a WMTS answer, something else", () => {
  const exception = parseWmsCapabilities('<ServiceExceptionReport version="1.3.0"><ServiceException code="InvalidParameterValue">Unknown service</ServiceException></ServiceExceptionReport>');
  assert.deepEqual(exception, { ok: false, error: "the service answered with an error: Unknown service" });
  const ows = parseWmsCapabilities('<ows:ExceptionReport xmlns:ows="x"><ows:Exception><ows:ExceptionText>No such layer</ows:ExceptionText></ows:Exception></ows:ExceptionReport>');
  assert.deepEqual(ows, { ok: false, error: "the service answered with an error: No such layer" });
  const wmts = parseWmsCapabilities('<Capabilities xmlns="http://www.opengis.net/wmts/1.0" version="1.0.0"></Capabilities>');
  assert.ok(!wmts.ok && /WMTS/.test(wmts.error));
  assert.ok(!parseWmsCapabilities("<html><body>Not found</body></html>").ok);
  assert.ok(!parseWmsCapabilities("{\"json\": true}").ok);
});

test("the GetMap template keeps the address's own parameters and asks one Web Mercator tile at a time", () => {
  const parsed = parseWmsCapabilities(CAPABILITIES_130);
  assert.ok(parsed.ok);
  const [rgb, cir] = parsed.value.layers;
  const template = wmsTemplate(parsed.value, "https://maps.example.org/ows?map=/srv/ortho.map&SERVICE=WMS&request=GetCapabilities", rgb, "image/png", 512);
  assert.equal(template, "https://maps.example.org/ows?map=%2Fsrv%2Fortho.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortho_rgb&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=512&HEIGHT=512&BBOX={bbox-epsg-3857}");
  assert.throws(() => wmsTemplate(parsed.value, "https://maps.example.org/ows", cir, "image/png", 256), /not offered in Web Mercator/);
  assert.deepEqual(wmsTemplateInfo(template), { address: "https://maps.example.org/ows?map=%2Fsrv%2Fortho.map", layer: "ortho_rgb", format: "image/png", version: "1.3.0" });
  assert.equal(wmsTemplateInfo("https://t.example.org/{z}/{x}/{y}.png"), null);
  assert.equal(withTileSize(template, 256).match(/WIDTH=256&HEIGHT=256/)?.length, 1);
  assert.equal(capabilitiesUrl("https://maps.example.org/ows?map=/srv/ortho.map&REQUEST=GetMap&version=1.1.1"), "https://maps.example.org/ows?map=%2Fsrv%2Fortho.map&SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0");
  assert.equal(getMapBase("http://maps.example.org/ows", "https://maps.example.org/ows"), "https://maps.example.org/ows", "https is kept on the same host");
  assert.equal(getMapBase("", "https://a.example.org/wms"), "https://a.example.org/wms");
});

test("PNG first, then JPEG, then any picture format", () => {
  assert.equal(defaultFormat(["image/jpeg", "image/png"]), "image/png");
  assert.equal(defaultFormat(["image/jpeg", "image/png; mode=8bit"]), "image/png; mode=8bit");
  assert.equal(defaultFormat(["image/tiff", "image/jpeg"]), "image/jpeg");
  assert.equal(defaultFormat(["image/svg+xml", "image/webp"]), "image/webp");
  assert.equal(defaultFormat(["application/pdf"]), null);
});

test("scale limits become zooms: a scale denominator at zoom z is 559,082,264 / 2^z", () => {
  assert.equal(zoomOfScale(SCALE_AT_ZOOM_0), 0);
  assert.ok(Math.abs(zoomOfScale(SCALE_AT_ZOOM_0 / 2 ** 15) - 15) < 1e-9);
  assert.ok(Math.abs(zoomOfScale(SCALE_AT_ZOOM_0 / 2 ** 15, 512) - 14) < 1e-9, "a 512-pixel tile reaches that scale one zoom earlier");
  // 1:1,000,000 is between zoom 9 (1:1.09 M) and 10: first drawn at 10. 1:500 is past zoom 20 (1:533).
  assert.deepEqual(wmsZooms({ maxScale: 1000000, minScale: 500 }), { minZoom: 10, maxZoom: 20 });
  assert.deepEqual(wmsZooms({ maxScale: null, minScale: null }), { minZoom: null, maxZoom: null });
  assert.deepEqual(wmsZooms({ maxScale: SCALE_AT_ZOOM_0 * 4, minScale: null }), { minZoom: null, maxZoom: null }, "drawn from zoom 0");
});
