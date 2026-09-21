// Runs the Phase 0 spikes inside the real After Effects and summarises the results.
//
//   node tools/ae-spikes.mjs
//
// 1. Refuses to start when After Effects is already running.
// 2. Writes test frames for S5 and a run request for the panel.
// 3. Starts After Effects with its UI running tools/ae/spikes.jsx (host spikes S3 and S5), which
//    then opens the panel; the panel runs S1, S2a and S6 and quits After Effects.
// 4. Waits for both result files, compares S5 frames, prints a summary.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/core/image/png.ts";
import { connectPanel } from "./cep-devtools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aeExe = process.env.LML_AFTERFX ?? "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.com";
const spikeDir = path.join(os.tmpdir(), "LazyMapLayers", "spikes");
const timeoutMs = Number(process.env.LML_SPIKE_TIMEOUT_MS ?? 15 * 60 * 1000);

function aeRunning() {
  const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
  return /"AfterFX\.(exe|com)"/i.test(out);
}

function writeSolidSequence(dir, width, height, frames, colorAt) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < frames; i++) {
    const [r, g, b] = colorAt(i);
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < rgba.length; p += 4) {
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = b;
      rgba[p + 3] = 255;
    }
    fs.writeFileSync(path.join(dir, `frame_${String(i).padStart(4, "0")}.png`), encodePng(rgba, width, height));
  }
}

/** Decodes 8-bit RGB/RGBA non-interlaced PNGs (all five filter types). */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];
  while (p < buf.length) {
    const length = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    p += 12 + length;
  }
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bpp = channels * bytesPerSample;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const v = raw[line + x];
      let out;
      if (filter === 0) out = v;
      else if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = out & 0xff;
    }
  }
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * bpp;
  return { width, height, channels, bytesPerSample, center: Array.from(px.subarray(center, center + bpp)).filter((_, i) => i % bytesPerSample === 0) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** U1: drives the real panel UI through DevTools and saves screenshots to .cache/ui. */
async function runUiScenario() {
  const out = path.join(root, ".cache", "ui");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const panel = await connectPanel();
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), await panel.screenshot());
  // Controls carry data-id attributes, so the test does not depend on their wording.
  const control = (id) => `document.querySelector(${JSON.stringify(`[data-id="${id}"]`)})`;
  const click = (id) =>
    panel.evaluate(`(() => { const b = ${control(id)}; if (!b) throw new Error("no control ${id}"); if (b.disabled) throw new Error("control ${id} is disabled"); b.click(); return true; })()`);
  const type = (selector, text, blur = false) =>
    panel.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input", { bubbles: true })); ${blur ? 'i.dispatchEvent(new Event("blur"));' : "i.focus();"} return true; })()`);
  const idle = async (timeoutMs = 180000) => {
    const started = Date.now();
    await sleep(400);
    while (Date.now() - started < timeoutMs) {
      if (!(await panel.evaluate("window.lmlDebug.busy()"))) return;
      await sleep(400);
    }
    throw new Error("panel stayed busy");
  };
  const showView = (view) => panel.evaluate(`(window.lmlDebug.showCompView(${JSON.stringify(view)}), true)`);
  await sleep(5000);
  await shot("01-start");
  await panel.evaluate(`(() => { const s = ${control("basemap")}; s.value = "region:paris"; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
  await idle();
  await showView({ center: { lat: 48.8626, lng: 2.3222 }, zoom: 13.2, bearing: 20, pitch: 45 });
  await sleep(2500);
  await shot("02-paris-preview");
  // Offline search: the Bengali spelling must find Paris.
  await type(`[data-id="search"]`, "প্যারিস");
  await sleep(700);
  const results = await panel.evaluate(`[...document.querySelectorAll(".search-result .search-name")].map((n) => n.textContent)`);
  console.log(`U1 search: ${JSON.stringify(results)}`);
  await shot("02a-search");
  await type(`[data-id="search"]`, "", true);
  // Region sheet: an existing name must warn and the zoom options must show tile estimates (no network).
  await click("download-area");
  await sleep(300);
  await type(`[data-id="region-sheet"] input`, "Paris", true);
  await sleep(300);
  const sheet = await panel.evaluate(
    `(() => { const s = ${control("region-sheet")}; return { name: s.querySelector("input").value, warning: [...s.querySelectorAll(".warning")].map((w) => w.textContent), options: [...s.querySelectorAll("select option")].map((o) => o.textContent), selected: s.querySelector("select").value }; })()`
  );
  console.log(`U1 region sheet: ${JSON.stringify(sheet)}`);
  await shot("02b-region-sheet");
  await panel.evaluate(`(() => { [...${control("region-sheet")}.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel").click(); return true; })()`);
  // New map: the screen proposes a name from the place in the preview.
  await click("new-map-header");
  await sleep(800);
  const proposed = await panel.evaluate(`${control("new-map-name")}.value`);
  console.log(`U1 proposed map name: ${proposed}`);
  await shot("02c-new-map");
  await click("create-map");
  await idle();
  for (const [lat, lng] of [[48.85837, 2.294481], [48.873792, 2.295028], [48.860611, 2.337644]]) {
    await panel.evaluate(`window.lmlDebug.addPin(${lat}, ${lng}).then(() => true)`);
    await idle();
  }
  // The same places as 3D pins under the matched 3D camera (added on the first 3D pin).
  for (const [lat, lng] of [[48.85837, 2.294481], [48.873792, 2.295028], [48.860611, 2.337644]]) {
    await panel.evaluate(`window.lmlDebug.addPin(${lat}, ${lng}, true).then(() => true)`);
    await idle();
  }
  // Looks and highlights: pick the Daylight look, highlight the country under the preview's centre.
  await click("look");
  await sleep(300);
  await click("theme-daylight");
  await idle();
  await sleep(1500);
  await shot("07-look-daylight");
  // Terrain: the Paris elevation pack (when TR1 has downloaded it) with shaded slopes and 3D height.
  const packs = await panel.evaluate(`[...${control("terrain-pack")}.options].map((o) => o.value)`);
  console.log(`U1 elevation packs: ${JSON.stringify(packs)}`);
  if (packs.includes("paris")) {
    await panel.evaluate(`(() => { const s = ${control("terrain-pack")}; s.value = "paris"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await idle();
    await panel.evaluate(`(() => { const s = ${control("terrain-height")}; s.value = "15"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await idle();
    await sleep(1500);
    await shot("07d-terrain");
    const terrainState = await panel.evaluate("JSON.stringify(window.lmlDebug.store.terrain.value)");
    console.log(`U1 terrain: ${terrainState}`);
    await panel.evaluate(`(() => { const s = ${control("terrain-pack")}; s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await idle();
  }
  await click("look");
  await click("tool-highlight");
  await sleep(300);
  const country = await panel.evaluate("window.lmlDebug.countryAtCentre()");
  console.log(`U1 country under the centre: ${JSON.stringify(country)}`);
  if (country) await panel.evaluate(`(window.lmlDebug.store.toggleCountryHighlight(${JSON.stringify(country.code)}, ${JSON.stringify(country.name)}), true)`);
  await sleep(1200);
  // A province from the search list, through its highlight button.
  await click("level-province");
  await type(`[data-id="search"]`, "Gironde");
  await sleep(900);
  const provinceRows = await panel.evaluate(`[...document.querySelectorAll(".search-result")].map((n) => n.querySelector(".search-name").textContent + " | " + n.querySelector(".search-detail").textContent)`);
  console.log(`U1 province search: ${JSON.stringify(provinceRows)}`);
  await click("highlight-fra5295");
  await idle();
  await type(`[data-id="search"]`, "", true);
  await showView({ center: { lat: 46.5, lng: 2.5 }, zoom: 5.2, bearing: 0, pitch: 0 });
  await sleep(2500);
  await shot("07a-highlight");
  // Districts are a download per country: the sheet lists what is installed (nothing goes online here).
  await click("level-district");
  await sleep(400);
  if (process.env.LML_ONLINE) {
    // With LML_ONLINE=1: ask geoBoundaries what it offers for France (a few kilobytes; nothing is downloaded).
    await panel.evaluate(`window.lmlDebug.store.offerDistricts({ code: "FRA", name: "France", iso: "FRA" }).then(() => true)`);
    await sleep(500);
    const offer = await panel.evaluate(`(() => { const p = window.lmlDebug.store.districtPrompt.value; return p && { state: p.state, count: p.offer && p.offer.count, unit: p.offer && p.offer.unit, size: p.offer && p.offer.sizeBytes, button: (document.querySelector('[data-id="district-download"]') || {}).textContent }; })()`);
    console.log(`U1 district offer: ${JSON.stringify(offer)}`);
  }
  await shot("07c-districts");
  await click("level-country");
  const highlighted = await panel.evaluate("window.lmlDebug.store.highlights.value.map((h) => h.name)");
  console.log(`U1 highlights: ${JSON.stringify(highlighted)}`);
  // France as an editable shape layer, drawn on over four seconds.
  await click("shape-draw-on");
  await click("shape-FRA");
  await idle();
  const shapeLog = await panel.evaluate("window.lmlDebug.log().slice(-1)[0]");
  console.log(`U1 shape layer: ${JSON.stringify(shapeLog)}`);
  await shot("07e-shape");
  await panel.evaluate(`(() => { [...${control("highlight-sheet")}.querySelectorAll("button")].find((b) => b.textContent.trim() === "Done").click(); return true; })()`);
  // Import: a flight log as CSV (one position column, times, no names) drawn at its recorded pace.
  const flight = ["Timestamp,UTC,Callsign,Position,Altitude"];
  // Slow for the first third of the rows, fast after it.
  for (let i = 0; i <= 60; i++) flight.push(`${1760000000 + (i < 20 ? i * 240 : 4800 + (i - 20) * 60)},,LML1,"${(48.86 + i * 0.02).toFixed(4)},${(2.35 + i * 0.12).toFixed(4)}",35000`);
  await panel.evaluate(`window.lmlDebug.store.importPicked(new File([${JSON.stringify(flight.join("\n"))}], "flight-log.csv")).then(() => true)`);
  await idle();
  await click("recorded-pace");
  await sleep(300);
  await shot("07b-import");
  await click("import-arrow-0");
  await idle();
  const importLog = await panel.evaluate(`window.lmlDebug.log().slice(-3)`);
  console.log(`U1 import: ${JSON.stringify(importLog)}`);
  await click("import-close");
  // Shots: three views, an opened move, playback in the preview, then Apply.
  for (const view of [
    { center: { lat: 48.8626, lng: 2.3222 }, zoom: 12.4, bearing: 0, pitch: 0 },
    { center: { lat: 48.8584, lng: 2.2945 }, zoom: 15.2, bearing: 30, pitch: 55 },
    { center: { lat: 48.8606, lng: 2.3376 }, zoom: 15.6, bearing: -20, pitch: 50 }
  ]) {
    await showView(view);
    await sleep(1500);
    await click("shot-add");
    await sleep(700);
  }
  await click("move-2");
  await sleep(300);
  await shot("06-shots");
  await click("shot-play");
  await sleep(2500);
  await shot("06a-shots-playing");
  await click("shot-play");
  await click("shot-apply");
  await idle();
  await sleep(500);
  await shot("06b-shots-applied");
  const shots = await panel.evaluate(
    `(() => { const s = window.lmlDebug.shots; return { state: s.hostState.value, needsApply: s.needsApply.value, names: s.shotList.value.shots.map((x) => x.name), thumbs: Object.keys(s.thumbs.value).length, end: s.endTime.value }; })()`
  );
  console.log(`U1 shots: ${JSON.stringify(shots)}`);
  await click("render-preview");
  await sleep(500);
  await shot("03a-rendering");
  await panel.evaluate(`window.lmlDebug.queueIdle()`);
  // Final render with two passes, set through the render settings.
  await panel.evaluate(`window.lmlDebug.setRenderSettings({ supersample: 2, passes: ["base", "roads", "waterMatte"] }).then(() => true)`);
  await sleep(500);
  await shot("03b-render-settings");
  await click("render");
  await panel.evaluate(`window.lmlDebug.queueIdle()`);
  await sleep(1500);
  await shot("03-after-render");
  const queue = await panel.evaluate(`window.lmlDebug.queue.jobs.map((j) => ({ status: j.status, summary: j.summary, error: j.error }))`);
  console.log(`U1 render queue: ${JSON.stringify(queue)}`);
  const frame = path.join(out, "04-ae-frame.png").split(String.fromCharCode(92)).join("/");
  await panel.evaluate(`new Promise((resolve) => window.__adobe_cep__.evalScript(${JSON.stringify(`(function(){ var c = app.project.activeItem; c.time = 0; c.saveFrameToPng(0, new File("${frame}")); return c.name; })()`)}, resolve))`);
  for (let i = 0; i < 60 && !fs.existsSync(frame); i++) await sleep(250);
  // Only the 3D pins: they must sit where the 2D pins were.
  const frame3d = path.join(out, "05-ae-frame-3d-pins.png").split(String.fromCharCode(92)).join("/");
  const hide2d = `(function(){ var c = app.project.activeItem; for (var i = 1; i <= c.numLayers; i++) { var t = LML.tag.read(c.layer(i)); if (t && t.kind === "pin" && !t.threeD) c.layer(i).enabled = false; } c.saveFrameToPng(0, new File("${frame3d}")); return "1"; })()`;
  await panel.evaluate(`new Promise((resolve) => window.__adobe_cep__.evalScript(${JSON.stringify(hide2d)}, resolve))`);
  for (let i = 0; i < 60 && !fs.existsSync(frame3d); i++) await sleep(250);
  console.log(["UI log:", (await panel.evaluate("window.lmlDebug.log()")).join(String.fromCharCode(10))].join(String.fromCharCode(10)));
  panel.close();
}

async function main() {
  if (!fs.existsSync(aeExe)) throw new Error(`After Effects not found at ${aeExe} (set LML_AFTERFX)`);
  if (aeRunning()) throw new Error("After Effects is already running. Close it first; the spikes need their own instance.");

  fs.mkdirSync(spikeDir, { recursive: true });
  for (const f of ["host-results.txt", "results.json", "host-frame-S3.png", "host-frame-S5-before.png", "host-frame-S5-after.png", "panel.log"]) {
    fs.rmSync(path.join(spikeDir, f), { force: true });
  }
  fs.rmSync(path.join(spikeDir, "..", "panel.log"), { force: true });
  writeSolidSequence(path.join(spikeDir, "seq"), 320, 180, 10, () => [220, 40, 40]);
  writeSolidSequence(path.join(spikeDir, "seq-proxy"), 160, 90, 10, () => [40, 40, 220]);
  writeSolidSequence(path.join(spikeDir, "seq-v2"), 320, 180, 10, () => [40, 200, 60]);
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex > 0 ? process.argv[onlyIndex + 1].split(",") : null;
  const hostScript = path.join(root, "tools", "ae", "spikes.jsx");
  for (const f of ["skip-host.flag", "host-done.flag"]) fs.rmSync(path.join(spikeDir, f), { force: true });
  const heartbeatFile = path.join(spikeDir, "..", "panel-alive.json");
  fs.rmSync(heartbeatFile, { force: true });
  fs.writeFileSync(path.join(spikeDir, "allow-quit.flag"), "created by tools/ae-spikes.mjs", "utf8");
  const uiMode = process.argv.includes("--ui");
  if (!uiMode) fs.writeFileSync(path.join(spikeDir, "run-request.json"), JSON.stringify({ quit: true, only, hostScript }), "utf8");
  else fs.rmSync(path.join(spikeDir, "run-request.json"), { force: true });

  // Start After Effects normally (no -r: a script given at launch can end the session with it).
  const guiExe = path.join(path.dirname(aeExe), "AfterFX.exe");
  console.log(`starting After Effects: ${guiExe}`);
  spawn(guiExe, [], { detached: true, stdio: "ignore" }).unref();

  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
  let openRequested = false;
  let uiStarted = false;
  let lastStatus = "";
  while (Date.now() - started < timeoutMs) {
    await sleep(3000);
    const alive = fs.existsSync(heartbeatFile);
    if (!alive && !openRequested && Date.now() - started > 45000 && aeRunning()) {
      console.log(`${elapsed()}: panel not open yet, asking After Effects to open it`);
      spawn(aeExe, ["-r", path.join(root, "tools", "ae", "open-panel.jsx")], { detached: true, stdio: "ignore" }).unref();
      openRequested = true;
    }
    if (uiMode && alive && !uiStarted) {
      uiStarted = true;
      try {
        await runUiScenario();
      } catch (error) {
        console.log(`UI scenario failed: ${error.message}`);
      }
      // Ask the panel to quit After Effects (no tests to run).
      fs.writeFileSync(path.join(spikeDir, "run-request.json"), JSON.stringify({ quit: true, only: [] }), "utf8");
    }
    const hostDone = fs.existsSync(path.join(spikeDir, "host-done.flag"));
    const panelDone = fs.existsSync(path.join(spikeDir, "results.json"));
    const running = aeRunning();
    const status = `AE ${running ? "running" : "not running"}, panel ${alive ? "alive" : "not seen"}, host spikes ${hostDone ? "done" : "pending"}, renderer spikes ${panelDone ? "done" : "pending"}`;
    if (status !== lastStatus) {
      console.log(`${elapsed()}: ${status}`);
      lastStatus = status;
    }
    if (panelDone && !running) break;
    if (!running && Date.now() - started > 60000) {
      console.log(`${elapsed()}: After Effects is not running any more`);
      break;
    }
  }

  // Give After Effects a moment to quit after the panel asked it to.
  for (let i = 0; i < 20 && aeRunning(); i++) await sleep(1500);

  console.log("\n==== host spikes (S3, S5) ====");
  const hostFile = path.join(spikeDir, "host-results.txt");
  console.log(fs.existsSync(hostFile) ? fs.readFileSync(hostFile, "utf8") : "no host results");

  const before = path.join(spikeDir, "host-frame-S5-before.png");
  const after = path.join(spikeDir, "host-frame-S5-after.png");
  if (fs.existsSync(before) && fs.existsSync(after)) {
    const a = decodePng(before);
    const b = decodePng(after);
    console.log(`S5 pixel check: before centre ${a.center.join(",")} (expected red), after centre ${b.center.join(",")} (expected green)`);
  }

  console.log("\n==== panel spikes (S1, S2a, S6) ====");
  const results = path.join(spikeDir, "results.json");
  console.log(fs.existsSync(results) ? fs.readFileSync(results, "utf8") : "no panel results");
  const panelLog = path.join(spikeDir, "..", "panel.log");
  if (fs.existsSync(panelLog)) console.log("\npanel.log:\n" + fs.readFileSync(panelLog, "utf8"));
  console.log(aeRunning() ? "\nAfter Effects is still running." : "\nAfter Effects has quit.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
