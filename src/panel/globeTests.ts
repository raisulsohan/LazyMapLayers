// G1: core globe projection against MapLibre's globe renderer.
//   CPU: random globe views (zoom 1 to 11) against map.project().
//   GPU: a red dot drawn by MapLibre at a known place, found in the rendered pixels, for globe views and
//        for the globe-to-Mercator transition (zoom 11 to 12), where map.project() does not mix like
//        the shaders do.

import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../core/camera/camera.ts";
import { GLOBE_TO_MERCATOR, globeProjectionSpec, projectPoint } from "../core/camera/globe.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import type { SpikeLog } from "./spikes.ts";

const WIDTH = 1920;
const HEIGHT = 1080;

function dotStyle(): StyleSpecification {
  return {
    version: 8,
    projection: globeProjectionSpec() as StyleSpecification["projection"],
    sources: { dot: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
    layers: [
      { id: "earth", type: "background", paint: { "background-color": "#203040" } },
      {
        id: "dot",
        type: "circle",
        source: "dot",
        paint: { "circle-radius": 6, "circle-color": "#ff0000", "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport" }
      }
    ]
  };
}

export async function runGlobeTests(log: SpikeLog): Promise<Record<string, unknown>> {
  let seed = 23;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const renderer = new FrameRenderer({ width: WIDTH, height: HEIGHT, style: dotStyle(), antialias: true });
  try {
    await renderer.init();
    const map = renderer.maplibre;

    // CPU: projection against map.project() for pure globe views.
    let cpuWorst = 0;
    let cpuChecks = 0;
    for (let i = 0; i < 300; i++) {
      const view: View = {
        center: { lng: random() * 360 - 180, lat: random() * 150 - 75 },
        zoom: 1 + random() * (GLOBE_TO_MERCATOR.from - 1),
        bearing: random() * 360 - 180,
        pitch: random() * 60
      };
      await renderer.setView(view, 0);
      const screen = { x: WIDTH * (0.2 + random() * 0.6), y: HEIGHT * (0.3 + random() * 0.6) };
      const ground = map.unproject([screen.x, screen.y]);
      const ours = projectPoint(view, { width: WIDTH, height: HEIGHT }, { lng: ground.lng, lat: ground.lat }, { projection: "globe" });
      if (!ours.visible) continue;
      const theirs = map.project(ground);
      cpuWorst = Math.max(cpuWorst, Math.hypot(ours.x - theirs.x, ours.y - theirs.y));
      cpuChecks++;
    }
    log(`G1 globe projection vs map.project: worst ${cpuWorst.toFixed(6)} px over ${cpuChecks} views`, cpuWorst < 0.01 ? "ok" : "fail");

    // GPU: rendered dot centres, including the transition zooms.
    const source = map.getSource("dot") as unknown as { setData: (data: unknown) => void };
    let gpuWorst = 0;
    let transitionWorst = 0;
    let gpuChecks = 0;
    const misses: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      const transition = i % 2 === 1;
      const view: View = {
        center: { lng: random() * 360 - 180, lat: random() * 140 - 70 },
        zoom: transition ? GLOBE_TO_MERCATOR.from + random() * (GLOBE_TO_MERCATOR.to - GLOBE_TO_MERCATOR.from) : 1.5 + random() * (GLOBE_TO_MERCATOR.from - 1.5),
        bearing: random() * 360 - 180,
        pitch: random() * 55
      };
      await renderer.setView(view, 0);
      const screen = { x: WIDTH * (0.25 + random() * 0.5), y: HEIGHT * (0.35 + random() * 0.5) };
      const ground = map.unproject([screen.x, screen.y]);
      const ours = projectPoint(view, { width: WIDTH, height: HEIGHT }, { lng: ground.lng, lat: ground.lat }, { projection: "globe" });
      if (!ours.visible) continue;
      source.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [ground.lng, ground.lat] } }] });
      await renderer.setView(view, 0);
      const frame = renderer.draw("base");
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const p = (y * frame.width + x) * 4;
          const red = frame.pixels[p];
          const green = frame.pixels[p + 1];
          if (red > 200 && green < 60) {
            sx += x + 0.5;
            // Rows come bottom-up from WebGL.
            sy += frame.height - y - 0.5;
            n++;
          }
        }
      }
      if (n < 20) {
        misses.push({ view, ground, ours, n });
        continue;
      }
      const error = Math.hypot(sx / n - ours.x, sy / n - ours.y);
      gpuWorst = Math.max(gpuWorst, error);
      if (transition) transitionWorst = Math.max(transitionWorst, error);
      gpuChecks++;
    }
    log(`G1 rendered dots vs core: worst ${gpuWorst.toFixed(3)} px (transition zooms ${transitionWorst.toFixed(3)} px) over ${gpuChecks} renders, ${misses.length} not found`, gpuWorst < 0.5 ? "ok" : "fail");
    return { cpuWorst, cpuChecks, gpuWorst, transitionWorst, gpuChecks, misses: misses.slice(0, 5), passed: cpuWorst < 0.01 && gpuWorst < 0.5 && gpuChecks >= 40 };
  } finally {
    renderer.destroy();
  }
}

// G2: pins on a globe map in After Effects' own render. The camera turns the globe, flies down to
// Paris through the globe-to-Mercator transition, and ends pitched. The basemap carries red dots at
// the pin places; wherever a pin is shown, its centre must be red, and a pin hidden behind the planet
// must have no dot under it either.

const cities = [
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "London", lat: 51.5072, lng: -0.1276 },
  { name: "Cairo", lat: 30.0444, lng: 31.2357 },
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { name: "Sao Paulo", lat: -23.5558, lng: -46.6396 },
  { name: "Versailles", lat: 48.8049, lng: 2.1204 }
];

export async function runGlobeEndToEnd(log: SpikeLog): Promise<Record<string, unknown>> {
  const { createMapComp, setView, addPin } = await import("./mapApi.ts");
  const { runRenderJob } = await import("./render/renderJob.ts");
  const { DEFAULT_FINAL_SETTINGS } = await import("../core/render/plan.ts");
  const { decodePng } = await import("../core/image/pngDecode.ts");
  const { evalScript, fs, path } = await import("./cep.ts");
  const { spikeDir } = await import("./spikes.ts");
  const host = async <T>(body: string): Promise<T> => JSON.parse(await evalScript(`(function () { ${body} })()`)) as T;

  const keys: [number, View][] = [
    [0, { center: { lng: -40, lat: 25 }, zoom: 1.6, bearing: 0, pitch: 0 }],
    [1.2, { center: { lng: 25, lat: 40 }, zoom: 2.8, bearing: 0, pitch: 10 }],
    [1.7, { center: { lng: 2.3522, lat: 48.8566 }, zoom: 7.5, bearing: 20, pitch: 30 }],
    [2.0, { center: { lng: 2.3522, lat: 48.8566 }, zoom: 11.5, bearing: 20, pitch: 40 }],
    [2.4, { center: { lng: 2.34, lat: 48.85 }, zoom: 12.6, bearing: 30, pitch: 50 }]
  ];
  const map = await createMapComp({ name: "G2 globe pins", width: 1280, height: 720, duration: 2.52, frameRate: 25, view: keys[0][1], newScene: true, projection: "globe" });
  for (const [time, view] of keys) {
    await host(`LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp.time = ${time}; return "1";`);
    await setView(map.id, view, true);
  }
  const errors: string[] = [];
  for (const city of cities) {
    const added = await addPin(map.id, city, { name: city.name, style: { radius: 8, fill: false, strokeColor: [0, 1, 0], strokeWidth: 3 } });
    errors.push(...added.expressionErrors);
  }
  const render = await runRenderJob({
    mapId: map.id,
    quality: "final",
    settings: DEFAULT_FINAL_SETTINGS,
    basemap: { kind: "world" },
    markers: cities.map((c) => ({ lat: c.lat, lng: c.lng, radius: 4, color: "#ff0000" }))
  });
  log(`G2 rendered ${render.rendered} globe frames at ${render.msPerRenderedFrame.toFixed(0)} ms each`, "muted");

  const results: { time: number; name: string; shown: boolean; centre: number[]; ok: boolean }[] = [];
  for (const time of [0, 0.6, 1.2, 1.6, 1.92, 2.08, 2.24, 2.4]) {
    const file = path().join(spikeDir(), `G2-frame-${time.toFixed(2)}.png`).split(String.fromCharCode(92)).join("/");
    fs().rmSync(file, { force: true });
    const pins = await host<{ name: string; x: number; y: number; opacity: number }[]>(`
      var mapLayer = LML.pins.findMapLayer(${JSON.stringify(map.id)});
      var scene = mapLayer.containingComp;
      scene.time = ${time};
      var out = [];
      for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "pin") continue;
        var t = layer.property("ADBE Transform Group");
        var p = t.property("ADBE Position").valueAtTime(${time}, false);
        out.push({ name: layer.name, x: p[0], y: p[1], opacity: t.property("ADBE Opacity").valueAtTime(${time}, false) });
      }
      scene.saveFrameToPng(${time}, new File(${JSON.stringify(file)}));
      return LML.json.stringify(out);`);
    for (let wait = 0; wait < 100 && !fs().existsSync(file); wait++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    const image = decodePng(new Uint8Array(fs().readFileSync(file)));
    for (const pin of pins) {
      const x = Math.round(pin.x);
      const y = Math.round(pin.y);
      if (x < 3 || y < 3 || x >= image.width - 3 || y >= image.height - 3) continue;
      const i = (y * image.width + x) * 4;
      const centre = [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]];
      const red = centre[0] > 170 && centre[1] < 80 && centre[2] < 80;
      const shown = pin.opacity > 0;
      results.push({ time, name: pin.name, shown, centre, ok: shown ? red : !red });
    }
  }
  const shown = results.filter((r) => r.shown);
  const hidden = results.filter((r) => !r.shown);
  const passed = errors.length === 0 && results.every((r) => r.ok) && shown.length >= 15 && hidden.length >= 3;
  log(`G2 globe pins in AE's render: ${shown.filter((r) => r.ok).length}/${shown.length} shown pins on their dots, ${hidden.filter((r) => r.ok).length}/${hidden.length} hidden pins without a dot`, passed ? "ok" : "fail");
  for (const miss of results.filter((r) => !r.ok)) log(`  miss: ${miss.name} at ${miss.time}s shown=${miss.shown} rgb ${miss.centre}`, "fail");
  return { passed, errors, shown: shown.length, hidden: hidden.length, failures: results.filter((r) => !r.ok) };
}
