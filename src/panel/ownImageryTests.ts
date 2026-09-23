// OI1: imagery of the user's own. Tiles served from this computer stand in for a provider: the
// render draws them over land and sea, under the lines, at the opacity asked, and the credit the
// user typed reaches the scene. Nothing leaves the machine.

import { project, type View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { encodePng } from "../core/image/png.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import type { OwnImagery } from "../core/style/ownImagery.ts";
import { fs, nodeRequire, path } from "./cep.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";

type NodeHttp = typeof import("node:http");

const SIZE = { width: 1280, height: 720 };

/** A tile server on this computer: every tile is the same solid magenta square. */
function serveTiles(): Promise<{ port: number; requests: () => number; close: () => void }> {
  const http = nodeRequire<NodeHttp>("http");
  const rgba = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = 0;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  const tile = encodePng(rgba, 256, 256, { level: 1, opaque: true });
  let count = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      count++;
      if (!/^\/\d+\/\d+\/\d+\.png$/.test(request.url ?? "")) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "image/png", "content-length": String(tile.length) });
      response.end(Buffer.from(tile));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve({ port, requests: () => count, close: () => server.close() });
    });
  });
}

export async function runOwnImageryTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const server = await serveTiles();
  const samples: Record<string, number[]> = {};
  let requests = 0;
  try {
    const view: View = { center: { lat: 47, lng: 8 }, zoom: 3.2, bearing: 0, pitch: 0 };
    const map = await createMapComp({ name: "OI1 own imagery", ...SIZE, duration: 1, frameRate: 25, view, newScene: true });
    const own: OwnImagery = { url: `http://127.0.0.1:${server.port}/{z}/{x}/{y}.png`, attribution: "Test tiles", opacity: 1, tileSize: 256, maxZoom: null };
    const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base", "landMatte"] }, DEFAULT_FINAL_SETTINGS);
    const rendered = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "daylight", own });
    requests = server.requests();
    if (!requests) problems.push("no tile was asked for");
    const at = (folder: string, place: { lat: number; lng: number }) => {
      const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(folder, sequenceFileName(0))))).rgba;
      const p = project(view, SIZE, place);
      const i = (Math.round(p.y) * SIZE.width + Math.round(p.x)) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    };
    const base = rendered.sequences.find((s) => s.pass === "base");
    const matte = rendered.sequences.find((s) => s.pass === "landMatte");
    if (!base || !matte) problems.push(`passes rendered: ${rendered.passes.join(",")}`);
    else {
      samples.land = at(base.folder, { lat: 48.5, lng: 9 });
      samples.sea = at(base.folder, { lat: 42.8, lng: 5 });
      samples.matteLand = at(matte.folder, { lat: 48.5, lng: 9 });
      samples.matteSea = at(matte.folder, { lat: 42.8, lng: 5 });
      // The tiles cover land and sea alike, in the base pass.
      const magenta = (c: number[]) => c[0] > 200 && c[1] < 60 && c[2] > 200;
      if (!magenta(samples.land)) problems.push(`land is ${samples.land}, not the tiles' magenta`);
      if (!magenta(samples.sea)) problems.push(`the sea is ${samples.sea}, not the tiles' magenta`);
      // The mattes never see imagery: land stays white where land is and clear where it is not.
      if (samples.matteLand[3] < 200 || samples.matteLand[0] < 200) problems.push(`the land matte on land is ${samples.matteLand}`);
      if (samples.matteSea[3] !== 0 && samples.matteSea[0] > 60) problems.push(`the land matte at sea is ${samples.matteSea}`);
    }
    if (!rendered.imported.attribution || rendered.imported.attribution.state === "none") problems.push(`the credit was not added: ${JSON.stringify(rendered.imported.attribution)}`);

    // Half see-through: the ground shows through the tiles.
    const faint = await runRenderJob({ mapId: map.id, quality: "final", settings, basemap: { kind: "world" }, theme: "daylight", own: { ...own, opacity: 0.5 } });
    const faintBase = faint.sequences.find((s) => s.pass === "base");
    if (faintBase) {
      samples.faintLand = at(faintBase.folder, { lat: 48.5, lng: 9 });
      if (!(samples.faintLand[1] > 60 && samples.faintLand[1] < 220)) problems.push(`at half opacity land is ${samples.faintLand}: green should be between the tiles and the ground`);
    } else problems.push("the half-opacity render has no base pass");
  } finally {
    server.close();
  }
  const passed = problems.length === 0;
  log(`OI1 own imagery: ${requests} tiles served, land ${samples.land?.join("/") ?? "-"}, sea ${samples.sea?.join("/") ?? "-"}, half ${samples.faintLand?.join("/") ?? "-"}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, requests, samples, problems };
}
