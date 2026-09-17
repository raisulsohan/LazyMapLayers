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
  fs.writeFileSync(path.join(spikeDir, "run-request.json"), JSON.stringify({ quit: true, only, hostScript }), "utf8");

  // Start After Effects normally (no -r: a script given at launch can end the session with it).
  const guiExe = path.join(path.dirname(aeExe), "AfterFX.exe");
  console.log(`starting After Effects: ${guiExe}`);
  spawn(guiExe, [], { detached: true, stdio: "ignore" }).unref();

  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
  let openRequested = false;
  let lastStatus = "";
  while (Date.now() - started < timeoutMs) {
    await sleep(3000);
    const alive = fs.existsSync(heartbeatFile);
    if (!alive && !openRequested && Date.now() - started > 45000 && aeRunning()) {
      console.log(`${elapsed()}: panel not open yet, asking After Effects to open it`);
      spawn(aeExe, ["-r", path.join(root, "tools", "ae", "open-panel.jsx")], { detached: true, stdio: "ignore" }).unref();
      openRequested = true;
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
