// OI1: imagery of the user's own. Tiles served from this computer stand in for a provider: the
// render draws them over land and sea, under the lines, at the opacity asked, and the credit the
// user typed reaches the scene. Since D103 the same holds for a WMS (served here too, capabilities
// and GetMap), a folder of tiles and an MBTiles file, both written to disk by the test, each also
// checked in the preview. Nothing leaves the machine.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { encodePng } from "../core/image/png.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { OWN_IMAGERY_SOURCE, ownImageryFromWms, type OwnImagery } from "../core/style/ownImagery.ts";
import { writeSqlite } from "../core/tiles/sqliteWrite.ts";
import { evalScript, fs, nodeRequire, os, path } from "./cep.ts";
import { inspectMbtiles, inspectTileFolder } from "./imagery/localTiles.ts";
import { readWmsCapabilities } from "./imagery/wmsService.ts";
import { createMapComp } from "./mapApi.ts";
import { previewMap, setPreviewStyle, showCompView } from "./preview.ts";
import { runRenderJob } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";
import { refreshPreview } from "./store.ts";

type NodeHttp = typeof import("node:http");
type Rgb = [number, number, number];

const SIZE = { width: 1280, height: 720 };
const MAGENTA: Rgb = [255, 0, 255];
const CYAN: Rgb = [0, 255, 255];
const YELLOW: Rgb = [255, 255, 0];
const ORANGE: Rgb = [255, 128, 0];
/** Tiles of the southern half: if rows were turned the wrong way, the north would show this. */
const SOUTH: Rgb = [0, 0, 255];
const HALF_WORLD = 20037508.342789244;

/** A tile of one colour. */
function solidPng([r, g, b]: Rgb, size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return encodePng(rgba, size, size, { level: 1, opaque: true });
}

const capabilitiesXml = (port: number) => `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Service><Name>WMS</Name><Title>OI1 test WMS</Title><AccessConstraints>none</AccessConstraints><Fees>none</Fees></Service>
  <Capability>
    <Request><GetMap><Format>image/png</Format><Format>image/jpeg</Format>
      <DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="http://127.0.0.1:${port}/wms?"/></Get></HTTP></DCPType>
    </GetMap></Request>
    <Layer><Title>Root</Title><CRS>EPSG:4326</CRS>
      <Layer><Name>utm_only</Name><Title>UTM only</Title><CRS>EPSG:25832</CRS></Layer>
      <Layer><Name>oi1</Name><Title>OI1 cyan</Title><CRS>EPSG:3857</CRS><Attribution><Title>Test WMS</Title></Attribution></Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

/** A tile server on this computer: magenta XYZ tiles, and a WMS whose GetMap answers in cyan. */
function serveTiles(): Promise<{ port: number; requests: () => number; getMaps: () => URLSearchParams[]; close: () => void }> {
  const http = nodeRequire<NodeHttp>("http");
  const tile = solidPng(MAGENTA, 256);
  const cyan = { 256: solidPng(CYAN, 256), 512: solidPng(CYAN, 512) };
  let count = 0;
  const getMaps: URLSearchParams[] = [];
  let port = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      count++;
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const send = (status: number, type: string, body: Uint8Array | string) => {
        const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
        response.writeHead(status, { "content-type": type, "content-length": String(bytes.length) });
        response.end(bytes);
      };
      if (url.pathname === "/wms") {
        // Parameter names in any case, as WMS allows.
        const params = new URLSearchParams([...url.searchParams].map(([k, v]) => [k.toUpperCase(), v]));
        const asked = (params.get("REQUEST") ?? "").toLowerCase();
        if (asked === "getcapabilities") return send(200, "text/xml", capabilitiesXml(port));
        if (asked === "getmap") {
          getMaps.push(params);
          return send(200, "image/png", params.get("WIDTH") === "512" ? cyan[512] : cyan[256]);
        }
        return send(400, "text/xml", '<ServiceExceptionReport version="1.3.0"><ServiceException>unknown request</ServiceException></ServiceExceptionReport>');
      }
      if (!/^\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) return send(404, "text/plain", "");
      send(200, "image/png", tile);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      port = address && typeof address === "object" ? address.port : 0;
      resolve({ port, requests: () => count, getMaps: () => getMaps, close: () => server.close() });
    });
  });
}

/** Every tile of zooms 0 to `top`: the northern half of the world in `north`, the southern in SOUTH. */
function* pyramid(top: number): Generator<{ z: number; x: number; y: number; north: boolean }> {
  for (let z = 0; z <= top; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) yield { z, x, y, north: z === 0 || y < 2 ** (z - 1) };
}

/** A folder of tiles as gdal2tiles writes it: rows from the south, with tilemapresource.xml beside them. */
function writeTileFolder(root: string): void {
  const north = solidPng(YELLOW, 256);
  const south = solidPng(SOUTH, 256);
  fs().rmSync(root, { recursive: true, force: true });
  for (const t of pyramid(4)) {
    const folder = path().join(root, String(t.z), String(t.x));
    fs().mkdirSync(folder, { recursive: true });
    fs().writeFileSync(path().join(folder, `${2 ** t.z - 1 - t.y}.png`), t.north ? north : south);
  }
  fs().writeFileSync(path().join(root, "tilemapresource.xml"), '<?xml version="1.0"?><TileMap version="1.0.0"><SRS>EPSG:3857</SRS><TileSets profile="mercator"></TileSets></TileMap>');
}

/** An MBTiles file of 512-pixel tiles, rows from the south as the specification says. */
function writeMbtilesFile(file: string): void {
  const north = solidPng(ORANGE, 512);
  const south = solidPng(SOUTH, 512);
  const rows = [...pyramid(4)].map((t) => [t.z, t.x, 2 ** t.z - 1 - t.y, t.north ? north : south]);
  const bytes = writeSqlite([
    { name: "metadata", sql: "CREATE TABLE metadata (name text, value text)", rows: [["name", "OI1"], ["format", "png"], ["minzoom", "0"], ["maxzoom", "4"], ["attribution", '<a href="https://example.org">Test MBTiles</a>']] },
    { name: "tiles", sql: "CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)", rows }
  ], { pageSize: 65536, applicationId: 0x4d504258 });
  fs().writeFileSync(file, bytes);
}

const near = (c: number[] | undefined, rgb: Rgb) => !!c && Math.abs(c[0] - rgb[0]) < 40 && Math.abs(c[1] - rgb[1]) < 40 && Math.abs(c[2] - rgb[2]) < 40;

/** The colours of the preview at some places once it has drawn this setting (null without a preview). */
async function previewColours(own: OwnImagery, view: View, places: { lat: number; lng: number }[]): Promise<number[][] | null> {
  const m = previewMap();
  if (!m) return null;
  setPreviewStyle({ kind: "world" }, "mercator", { theme: "daylight", relief: false, own });
  showCompView(view);
  const started = Date.now();
  // Loaded means the new style, its source and every tile in view.
  await new Promise<void>((resolve) => {
    const check = () => {
      if ((m.isStyleLoaded() && m.getSource(OWN_IMAGERY_SOURCE) && m.areTilesLoaded()) || Date.now() - started > 30000) resolve();
      else setTimeout(check, 200);
    };
    setTimeout(check, 300);
  });
  return new Promise((resolve) => {
    // Read inside the render event, while the drawing buffer is still there.
    m.once("render", () => {
      const canvas = m.getCanvas();
      const ratio = canvas.width / Math.max(1, canvas.clientWidth);
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      const context = probe.getContext("2d");
      if (!context) return resolve(null);
      resolve(
        places.map((place) => {
          const p = m.project([place.lng, place.lat]);
          context.clearRect(0, 0, 1, 1);
          context.drawImage(canvas, Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1, 0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        })
      );
    });
    m.triggerRepaint();
  });
}

export async function runOwnImageryTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const server = await serveTiles();
  const samples: Record<string, number[] | null> = {};
  const work = path().join(os().tmpdir(), "LazyMapLayers", "oi1");
  const view: View = { center: { lat: 47, lng: 8 }, zoom: 3.2, bearing: 0, pitch: 0 };
  const LAND = { lat: 48.5, lng: 9 };
  const SEA = { lat: 42.8, lng: 5 };
  let requests = 0;
  const kinds: Record<string, string> = {};
  try {
    const map = await createMapComp({ name: "OI1 own imagery", ...SIZE, duration: 1, frameRate: 25, view, newScene: true });
    const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base", "landMatte"] }, DEFAULT_FINAL_SETTINGS);
    const at = (folder: string, place: { lat: number; lng: number }) => {
      const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(folder, sequenceFileName(0))))).rgba;
      const p = project(view, SIZE, place);
      const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    };
    const credit = () =>
      evalScript(
        `(function () { var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp; for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "attribution") return String(scene.layer(i).property("ADBE Text Properties").property("ADBE Text Document").value.text); } return ""; })()`
      );

    /** One source: over land and sea in the base pass, never in the land matte, credited, and in the preview. */
    const check = async (name: string, own: OwnImagery, colour: Rgb, preview: boolean) => {
      const rendered = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "daylight", own });
      const base = rendered.sequences.find((s) => s.pass === "base");
      const matte = rendered.sequences.find((s) => s.pass === "landMatte");
      if (!base || !matte) {
        problems.push(`${name}: passes rendered: ${rendered.passes.join(",")}`);
        return;
      }
      samples[`${name}Land`] = at(base.folder, LAND);
      samples[`${name}Sea`] = at(base.folder, SEA);
      const matteLand = at(matte.folder, LAND);
      const matteSea = at(matte.folder, SEA);
      if (!near(samples[`${name}Land`]!, colour)) problems.push(`${name}: land is ${samples[`${name}Land`]}, not ${colour}`);
      if (!near(samples[`${name}Sea`]!, colour)) problems.push(`${name}: the sea is ${samples[`${name}Sea`]}, not ${colour}`);
      // The mattes never see imagery: land stays white where land is and clear where it is not.
      if (matteLand[3] < 200 || matteLand[0] < 200) problems.push(`${name}: the land matte on land is ${matteLand}`);
      if (matteSea[3] !== 0 && matteSea[0] > 60) problems.push(`${name}: the land matte at sea is ${matteSea}`);
      if (!rendered.imported.attribution || rendered.imported.attribution.state === "none") problems.push(`${name}: the credit was not added: ${JSON.stringify(rendered.imported.attribution)}`);
      const text = await credit();
      if (!text.includes(own.attribution)) problems.push(`${name}: the credit reads "${text}", without "${own.attribution}"`);
      if (preview) {
        // Several places, as the preview draws names over the map: most must show the tiles.
        const shown = await previewColours(own, view, [LAND, SEA, { lat: 45.5, lng: 2.5 }, { lat: 47.6, lng: 4.6 }, { lat: 46.2, lng: 1.6 }]);
        samples[`${name}Preview`] = shown?.[0] ?? null;
        const matching = shown?.filter((c) => near(c, colour)).length ?? 0;
        if (matching < 4) problems.push(`${name}: the preview shows the tiles at ${matching} of 5 places (${shown?.map((c) => c.join("/")).join(", ") ?? "no preview"})`);
      }
      return rendered;
    };

    // XYZ from a web address (D59).
    const xyz: OwnImagery = { url: `http://127.0.0.1:${server.port}/{z}/{x}/{y}.png`, attribution: "Test tiles", opacity: 1, tileSize: 256, minZoom: null, maxZoom: null };
    await check("xyz", xyz, MAGENTA, false);
    requests = server.requests();
    if (!requests) problems.push("no tile was asked for");

    // Half see-through: the ground shows through the tiles.
    const faint = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "daylight", own: { ...xyz, opacity: 0.5 } });
    const faintBase = faint.sequences.find((s) => s.pass === "base");
    if (faintBase) {
      samples.faintLand = at(faintBase.folder, LAND);
      if (!(samples.faintLand[1] > 60 && samples.faintLand[1] < 220)) problems.push(`at half opacity land is ${samples.faintLand}: green should be between the tiles and the ground`);
    } else problems.push("the half-opacity render has no base pass");

    // WMS: the capabilities read by the panel, the first layer offered in Web Mercator picked.
    const address = `http://127.0.0.1:${server.port}/wms`;
    const capabilities = await readWmsCapabilities(address);
    const layer = capabilities.layers.find((l) => l.crs);
    if (capabilities.layers.length !== 2 || layer?.name !== "oi1") problems.push(`wms: layers read ${JSON.stringify(capabilities.layers.map((l) => [l.name, l.crs]))}`);
    const wms = layer ? ownImageryFromWms(capabilities, address, layer, "image/png", 256) : null;
    if (!wms) problems.push("wms: no setting");
    else {
      kinds.wms = wms.url;
      await check("wms", wms, CYAN, true);
      const asked = server.getMaps();
      if (!asked.length) problems.push("wms: no GetMap request");
      for (const p of asked) {
        const box = (p.get("BBOX") ?? "").split(",").map(Number);
        const z = Math.log2((2 * HALF_WORLD) / (box[2] - box[0]));
        const tileBox = box.length === 4 && box.every((v) => Math.abs(v) <= HALF_WORLD + 1) && Math.abs(z - Math.round(z)) < 1e-6 && Math.abs(box[3] - box[1] - (box[2] - box[0])) < 1e-3;
        if (p.get("CRS") !== "EPSG:3857" || p.get("LAYERS") !== "oi1" || p.get("FORMAT") !== "image/png" || p.get("WIDTH") !== "256" || p.get("HEIGHT") !== "256" || p.get("VERSION") !== "1.3.0" || !tileBox) {
          problems.push(`wms: a GetMap asked ${[...p].map(([k, v]) => `${k}=${v}`).join("&")}`);
          break;
        }
      }
      samples.getMaps = [asked.length];
    }

    // A folder of tiles on disk, rows from the south.
    const folder = path().join(work, "tiles");
    writeTileFolder(folder);
    const fromFolder = inspectTileFolder(folder);
    kinds.folder = fromFolder.url;
    if (!fromFolder.url.includes("{-y}") || fromFolder.maxZoom !== 4 || fromFolder.tileSize !== 256 || !fromFolder.bounds) problems.push(`folder: read as ${JSON.stringify(fromFolder)}`);
    await check("folder", { ...fromFolder, attribution: "Test folder", opacity: 1, tileSize: fromFolder.tileSize, minZoom: fromFolder.minZoom, maxZoom: fromFolder.maxZoom }, YELLOW, true);

    // An MBTiles file on disk, written by our own writer, read by our own reader.
    const file = path().join(work, "oi1.mbtiles");
    writeMbtilesFile(file);
    const found = await inspectMbtiles(file);
    kinds.mbtiles = found.setting.url;
    if (found.setting.attribution !== "Test MBTiles" || found.setting.tileSize !== 512 || found.setting.maxZoom !== 4 || found.format !== "png") problems.push(`mbtiles: read as ${JSON.stringify(found)}`);
    await check("mbtiles", { ...found.setting, opacity: 1 }, ORANGE, true);
  } finally {
    server.close();
    try {
      refreshPreview();
    } catch {
      // The preview goes back to the selected map when one is picked.
    }
  }
  const passed = problems.length === 0;
  const show = (key: string) => samples[key]?.join("/") ?? "-";
  log(`OI1 own imagery: ${requests} tiles served; land xyz ${show("xyzLand")}, wms ${show("wmsLand")}, folder ${show("folderLand")}, mbtiles ${show("mbtilesLand")}; preview wms ${show("wmsPreview")}, folder ${show("folderPreview")}, mbtiles ${show("mbtilesPreview")}; half ${show("faintLand")}; ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, requests, samples, kinds, problems };
}
