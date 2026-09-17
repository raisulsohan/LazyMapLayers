// E1: end-to-end alignment inside After Effects' own render.
// The basemap is rendered with solid red dots at five landmarks; AE pins (hollow green rings, no
// fill) sit on the same coordinates. After Effects renders the scene comp, and the pixel at each
// pin centre must be red, i.e. the ring is centred exactly on the dot the renderer drew.
// The same landmarks are also 3D pins under the matched 3D camera, checked the same way.

import type { View } from "../core/camera/camera.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { evalScript, fs, path } from "./cep.ts";
import { addCameraRig, addPin, createMapComp, setView } from "./mapApi.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { DEFAULT_FINAL_SETTINGS } from "../core/render/plan.ts";
import { runRenderJob } from "./render/renderJob.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const landmarks = [
  { name: "Eiffel Tower", lat: 48.85837, lng: 2.294481 },
  { name: "Arc de Triomphe", lat: 48.873792, lng: 2.295028 },
  { name: "Louvre", lat: 48.860611, lng: 2.337644 },
  { name: "Notre-Dame", lat: 48.852968, lng: 2.349902 },
  { name: "Sacre-Coeur", lat: 48.886705, lng: 2.343104 }
];

const start: View = { center: { lng: 2.3222, lat: 48.8666 }, zoom: 12.6, bearing: 0, pitch: 0 };
const end: View = { center: { lng: 2.3122, lat: 48.8626 }, zoom: 13.4, bearing: 35, pitch: 50 };

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

export async function runEndToEnd(log: SpikeLog): Promise<Record<string, unknown>> {
  const region = fs().existsSync(regionArchivePath("paris")) ? "paris" : null;
  if (!region) {
    log("E1 skipped: no Paris region archive", "muted");
    return { skipped: "no paris region" };
  }
  const width = 1280;
  const height = 720;
  const map = await createMapComp({ name: "E1 end to end", width, height, duration: 2, frameRate: 25, view: start, newScene: true });
  await host(`LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.time = 0; return "1";`);
  await setView(map.id, start, true);
  await host(`LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.time = 1.96; return "1";`);
  await setView(map.id, end, true);
  for (const l of landmarks) {
    await addPin(map.id, l, { name: l.name, style: { radius: 9, fill: false, strokeColor: [0, 1, 0], strokeWidth: 3 } });
  }
  await addCameraRig(map.id, start);
  for (const l of landmarks) {
    await addPin(map.id, l, { name: l.name, threeD: true, style: { radius: 8, fill: false, strokeColor: [0, 1, 1], strokeWidth: 2 } });
  }
  // Where AE's camera puts each 3D pin's centre.
  await host(`
    var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp;
    for (var i = 1; i <= scene.numLayers; i++) {
      var tag = LML.tag.read(scene.layer(i));
      if (!tag || tag.kind !== "pin" || !tag.threeD) continue;
      var probe = scene.layer(i).property("ADBE Effect Parade").addProperty("ADBE Point Control");
      probe.name = "E1 Probe";
      probe.property(1).expression = "const p = toComp([0, 0, 0]); [p[0], p[1]];";
    }
    return "1";`);

  const render = await runRenderJob({
    mapId: map.id,
    quality: "final",
    settings: DEFAULT_FINAL_SETTINGS,
    basemap: { kind: "region", name: region },
    markers: landmarks.map((l) => ({ lat: l.lat, lng: l.lng, radius: 4, color: "#ff0000" }))
  });
  const msPerFrame = render.msPerRenderedFrame;
  log(`E1 rendered ${render.rendered} of ${render.frames} basemap frames at ${msPerFrame.toFixed(0)} ms/frame (2x supersampling) and imported them`, "ok");

  const results: { time: number; name: string; x: number; y: number; centre: number[]; hit: boolean }[] = [];
  for (const time of [0, 0.64, 1.28, 1.92]) {
    const file = path().join(spikeDir(), `E1-frame-${time.toFixed(2)}.png`).split(String.fromCharCode(92)).join("/");
    fs().rmSync(file, { force: true });
    const pins = await host<{ name: string; x: number; y: number }[]>(`
      var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
      var scene = mapLayer.containingComp;
      scene.time = ${time};
      var out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "pin") continue;
        var p = tag.threeD
          ? layer.property("ADBE Effect Parade").property("E1 Probe").property(1).valueAtTime(${time}, false)
          : layer.property("ADBE Transform Group").property("ADBE Position").valueAtTime(${time}, false);
        out.push({ name: layer.name, x: p[0], y: p[1] });
      }
      scene.saveFrameToPng(${time}, new File(${JSON.stringify(file)}));
      return LML.json.stringify(out);`);
    for (let wait = 0; wait < 100 && !fs().existsSync(file); wait++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    const image = decodePng(new Uint8Array(fs().readFileSync(file)));
    for (const pin of pins) {
      const x = Math.round(pin.x);
      const y = Math.round(pin.y);
      if (x < 2 || y < 2 || x >= image.width - 2 || y >= image.height - 2) continue;
      const i = (y * image.width + x) * 4;
      const centre = [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]];
      const hit = centre[0] > 170 && centre[1] < 80 && centre[2] < 80;
      results.push({ time, name: pin.name, x: pin.x, y: pin.y, centre, hit });
    }
  }
  const hits = results.filter((r) => r.hit).length;
  const threeD = results.filter((r) => r.name.startsWith("3D Pin"));
  const hits3d = threeD.filter((r) => r.hit).length;
  const passed = results.length >= 20 && threeD.length >= 10 && hits === results.length;
  log(`E1 pins centred on renderer dots in AE's own frames: ${hits}/${results.length} (3D pins ${hits3d}/${threeD.length})`, passed ? "ok" : "fail");
  for (const miss of results.filter((r) => !r.hit)) log(`  miss: ${miss.name} at ${miss.time}s (${miss.x.toFixed(1)}, ${miss.y.toFixed(1)}) rgb ${miss.centre}`, "fail");
  return { frames: render.frames, msPerFrame: Math.round(msPerFrame), checks: results.length, hits, checks3d: threeD.length, hits3d, passed, results };
}
