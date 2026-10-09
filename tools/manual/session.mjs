// The pictures of the manual (docs/manual/): drives the real panel inside After Effects through
// DevTools, takes screenshots of the panel and renders the scene comp to PNG frames, which ffmpeg
// turns into GIFs. Needs the development link (dist/ built with npm run build:dev) and ffmpeg on PATH.
// Never writes a video file: GIF and PNG only.
//
// Used by tools/manual/capture.mjs; see its header for how to run it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectPanel } from "../cep-devtools.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const media = path.join(root, "docs", "manual", "media");
const work = path.join(root, ".cache", "manual");
const aeDir = process.env.LML_AE_DIR ?? "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The panel's size in every screenshot, so the pictures line up from chapter to chapter. */
export const PANEL = { width: 520, height: 900, scale: 1.5 };

function aeRunning() {
  const out = execFileSync("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq AfterFX.exe"], { encoding: "utf8" });
  return /AfterFX/i.test(out);
}

async function devtoolsUp() {
  try {
    const list = await (await fetch("http://127.0.0.1:8123/json")).json();
    return list.some((t) => /LazyMapLayers|panel\/index\.html/i.test(`${t.title} ${t.url}`));
  } catch {
    return false;
  }
}

/** Held while a script drives After Effects through this file, so a second one (another session's capture, a one-off check) waits. */
const lockFile = path.join(os.tmpdir(), "LazyMapLayers", "manual-session.lock");

/** The node processes other than this one, as { pid, cmd }. */
function otherNodeProcesses() {
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"], { encoding: "utf8" });
    return out
      .split(/\r?\n/)
      .map((line) => ({ pid: Number(line.split("\t")[0]), cmd: line.slice(line.indexOf("\t") + 1) }))
      .filter((p) => p.pid && p.pid !== process.pid);
  } catch {
    return [];
  }
}

/**
 * Why After Effects is not ours to drive right now, or null: tools/ae-spikes.mjs runs its own
 * instance, another capture.mjs or poke.mjs is at work, or another script holds the session lock.
 */
function someoneElseDriving() {
  const others = otherNodeProcesses();
  const spikes = others.find((p) => /ae-spikes\.mjs/.test(p.cmd));
  if (spikes) return "tools/ae-spikes.mjs is running; its After Effects is not ours to drive.";
  const manual = others.find((p) => /tools[\\/]manual[\\/](capture|poke)\.mjs/.test(p.cmd));
  if (manual) return `another manual script drives After Effects (process ${manual.pid}: ${manual.cmd.trim()}).`;
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    const holder = others.find((p) => p.pid === lock.pid);
    if (holder) return `process ${lock.pid} holds ${lockFile} (${holder.cmd.trim()}).`;
  } catch {
    // No lock, or one left by a process that has ended.
  }
  return null;
}

/** Takes the session lock for this process; it goes when the process ends. */
function takeLock() {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, cmd: process.argv.join(" "), since: new Date().toISOString() }), "utf8");
  process.on("exit", () => {
    try {
      if (JSON.parse(fs.readFileSync(lockFile, "utf8")).pid === process.pid) fs.rmSync(lockFile, { force: true });
    } catch {
      // Already gone.
    }
  });
}

/** Starts After Effects when it is not running, and waits until the panel answers on DevTools. */
export async function startAe() {
  const busy = someoneElseDriving();
  if (busy) throw new Error(`After Effects is in use: ${busy} Wait until it ends.`);
  takeLock();
  if (await devtoolsUp()) return;
  if (!aeRunning()) {
    console.log("starting After Effects");
    spawn(path.join(aeDir, "AfterFX.exe"), [], { detached: true, stdio: "ignore" }).unref();
  }
  const started = Date.now();
  let asked = false;
  while (!(await devtoolsUp())) {
    if (Date.now() - started > 600000) throw new Error("the panel did not come up in 10 minutes");
    if (!asked && Date.now() - started > 90000 && aeRunning()) {
      console.log("asking After Effects to open the panel");
      spawn(path.join(aeDir, "AfterFX.com"), ["-r", path.join(root, "tools", "ae", "open-panel.jsx")], { detached: true, stdio: "ignore" }).unref();
      asked = true;
    }
    await sleep(3000);
  }
  await sleep(4000);
}

/** One connection to the panel, with the helpers every chapter script uses. */
export async function openSession() {
  await startAe();
  const panel = await connectPanel();
  await panel.send("Emulation.setDeviceMetricsOverride", { width: PANEL.width, height: PANEL.height, deviceScaleFactor: PANEL.scale, mobile: false });
  fs.mkdirSync(media, { recursive: true });
  fs.mkdirSync(work, { recursive: true });

  const q = (id) => `document.querySelector(${JSON.stringify(`[data-id="${id}"]`)})`;
  const js = (expression) => panel.evaluate(expression);

  const s = {
    panel,
    js,
    store: (expression) => js(`(() => { const store = window.lmlDebug.store; return ${expression}; })()`),

    /** Waits until the panel is no longer busy. */
    async idle(timeoutMs = 600000) {
      const started = Date.now();
      await sleep(400);
      while (Date.now() - started < timeoutMs) {
        if (!(await js("window.lmlDebug.busy()"))) return;
        await sleep(400);
      }
      throw new Error("panel stayed busy");
    },

    async click(id) {
      await js(`(() => { const b = ${q(id)}; if (!b) throw new Error("no control ${id}"); if (b.disabled) throw new Error("control ${id} is disabled"); b.click(); return true; })()`);
      await sleep(250);
    },

    /** Clicks the button whose text is exactly this, inside the element with data-id `within` (or anywhere). */
    async clickText(text, within) {
      const scope = within ? q(within) : "document";
      await js(`(() => { const b = [...${scope}.querySelectorAll("button, label, .chip, [role=button]")].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error("no button " + ${JSON.stringify(text)}); b.click(); return true; })()`);
      await sleep(250);
    },

    /** Sets an input or select by data-id and fires the events the panel listens to. */
    async set(id, value) {
      await js(`(() => { const e = ${q(id)}; if (!e) throw new Error("no control ${id}"); if (e.type === "checkbox") e.checked = ${JSON.stringify(Boolean(value))}; else e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      await sleep(250);
    },

    async type(selector, text, blur = false) {
      await js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input", { bubbles: true })); ${blur ? 'i.dispatchEvent(new Event("blur"));' : "i.focus();"} return true; })()`);
      await sleep(300);
    },

    /** Points the preview at a view: { center: {lat, lng}, zoom, bearing, pitch }. */
    async view(view, settle = 2500) {
      await js(`(window.lmlDebug.showCompView(${JSON.stringify(view)}), true)`);
      await sleep(settle);
    },

    /** A real mouse click on the preview at a place, the way a user clicks (Alt and Shift as asked). */
    async clickMap(lat, lng, { alt = false, shift = false } = {}) {
      const at = await js(`(() => { const map = window.lmlDebug.map(); const p = map.project([${lng}, ${lat}]); const c = map.getCanvas(); const r = c.getBoundingClientRect(); const k = r.width / c.clientWidth; return { x: r.left + p.x * k, y: r.top + p.y * k }; })()`);
      const modifiers = (alt ? 1 : 0) | (shift ? 8 : 0);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await panel.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1, modifiers });
        await sleep(60);
      }
      await sleep(300);
    },

    /** The screen point of a place on the preview. */
    async pointOf(lat, lng) {
      return js(`(() => { const map = window.lmlDebug.map(); const p = map.project([${lng}, ${lat}]); const c = map.getCanvas(); const r = c.getBoundingClientRect(); const k = r.width / c.clientWidth; return { x: r.left + p.x * k, y: r.top + p.y * k }; })()`);
    },

    /** A mouse drag on the panel from one screen point to another, in `steps` moves (button left or right). */
    async drag(from, to, { button = "left", steps = 20, stepMs = 40 } = {}) {
      await panel.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await panel.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await panel.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button, buttons: button === "left" ? 1 : 2 });
        await sleep(stepMs);
      }
      await panel.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button, buttons: 0, clickCount: 1 });
      await sleep(300);
    },

    /** Mouse wheel over a screen point; negative deltaY zooms in. */
    async wheel(at, deltaY, { times = 1, gapMs = 60 } = {}) {
      for (let i = 0; i < times; i++) {
        await panel.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY });
        await sleep(gapMs);
      }
      await sleep(300);
    },

    /** The centre of the preview on screen. */
    async previewCentre() {
      return js(`(() => { const r = window.lmlDebug.map().getCanvas().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    },

    /**
     * Records the panel (or a clip of it) while `action` runs, as docs/manual/media/<name>.gif: for
     * showing an interaction in the panel itself, such as dragging the preview.
     */
    async record(name, action, { clip, fps = 8, width = 520, colors = 64, tail = 600 } = {}) {
      const frames = path.join(work, `rec-${name}`);
      fs.rmSync(frames, { recursive: true, force: true });
      fs.mkdirSync(frames, { recursive: true });
      let n = 0;
      let done = false;
      const params = { format: "png" };
      if (clip) params.clip = { ...clip, scale: 1 };
      const loop = (async () => {
        while (!done) {
          const started = Date.now();
          const shot = await panel.send("Page.captureScreenshot", params);
          fs.writeFileSync(path.join(frames, `f${String(n++).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
          await sleep(Math.max(0, 1000 / fps - (Date.now() - started)));
        }
      })();
      try {
        await action();
        await sleep(tail);
      } finally {
        done = true;
        await loop;
      }
      const pattern = path.join(frames, "f%04d.png");
      const palette = path.join(frames, "palette.png");
      const out = path.join(media, `${name}.gif`);
      const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
      ffmpeg("-framerate", String(fps), "-i", pattern, "-vf", `scale=${width}:-2:flags=lanczos,palettegen=max_colors=${colors}:stats_mode=diff`, palette);
      ffmpeg("-framerate", String(fps), "-i", pattern, "-i", palette, "-lavfi", `[0:v]scale=${width}:-2:flags=lanczos[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle`, "-loop", "0", out);
      console.log(`  ${path.relative(root, out)} ${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${n} frames`);
      return out;
    },

    /** Hands a text file (GPX, KML, GeoJSON, CSV) to the panel as if it was picked with Import. */
    async importFile(file) {
      const text = fs.readFileSync(file, "utf8");
      await js(`window.lmlDebug.store.importPicked(new File([${JSON.stringify(text)}], ${JSON.stringify(path.basename(file))})).then(() => true)`);
      await s.idle();
      await sleep(800);
    },

    /** Moves the current time of the active comp. */
    async time(seconds) {
      await s.ae(`(function () { var c = app.project.activeItem; if (c) c.time = ${seconds}; return "ok"; })()`);
      await sleep(600);
    },

    /** Makes a new map through the New map screen, on `view`, and waits until it is built. */
    async newMap(name, view, { width = 1920, height = 1080, frameRate = 25, duration = 10, globe = false } = {}) {
      if (view) await s.view(view, 1500);
      const globeOn = await js(`window.lmlDebug.store.projection.value === "globe"`);
      if (globeOn !== globe) await s.click("globe");
      await js(`(window.lmlDebug.store.screen.value = "newMap", true)`);
      await sleep(600);
      await s.type(`[data-id="new-map-name"]`, name);
      // A new project may open on a template with a comp in it; the manual's maps get scenes of their own.
      await js(`(() => { const box = [...document.querySelectorAll(".screen label.check")].find((l) => l.textContent.startsWith("Put it into the open comp")); const i = box && box.querySelector("input"); if (i && i.checked) i.click(); return true; })()`);
      await sleep(300);
      await js(`(() => { const inputs = [...document.querySelectorAll(".screen input[type=number]")]; const set = (i, v) => { i.value = String(v); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); i.dispatchEvent(new Event("blur")); }; set(inputs[0], ${width}); set(inputs[1], ${height}); set(inputs[2], ${frameRate}); set(inputs[3], ${duration}); return inputs.length; })()`);
      await sleep(300);
      await s.click("create-map");
      await s.idle();
      await sleep(1500);
    },

    /** Preview render of the selected map; waits for the queue to finish. */
    async preview() {
      await s.click("render-preview");
      await sleep(1500);
      await js("window.lmlDebug.queueIdle()");
      await s.idle();
      await sleep(1000);
    },

    /** Runs ExtendScript in After Effects and returns its result as a string. */
    ae(script) {
      return js(`new Promise((resolve) => window.__adobe_cep__.evalScript(${JSON.stringify(script)}, resolve))`);
    },

    /**
     * A screenshot of the panel into docs/manual/media/<name>.png. `mark` rings controls (data-ids
     * or CSS selectors) with numbered badges, so a chapter's steps can point at them.
     */
    async shot(name, { mark = [], clip, badges = "corner" } = {}) {
      await js(`(() => {
        document.querySelectorAll(".lml-manual-mark").forEach((m) => m.remove());
        const marks = ${JSON.stringify(mark)};
        const below = ${JSON.stringify(badges)} === "below";
        marks.forEach((m, i) => {
          // A data-id first (shape-THA, status), then a CSS selector (.bar.header).
          let e = document.querySelector('[data-id="' + m.replace(/"/g, "") + '"]');
          if (!e) { try { e = document.querySelector(m); } catch (error) { e = null; } }
          if (!e) throw new Error("nothing to mark: " + m);
          // A checkbox is marked with its words, not the small box alone.
          if (e.type === "checkbox" && e.closest("label")) e = e.closest("label");
          const r = e.getBoundingClientRect();
          const ring = document.createElement("div");
          ring.className = "lml-manual-mark";
          ring.style.cssText = "position:fixed;box-sizing:border-box;z-index:99999;pointer-events:none;border:2px solid #ff6a2b;border-radius:6px;left:" + (r.left - 1) + "px;top:" + (r.top - 1) + "px;width:" + (r.width + 2) + "px;height:" + (r.height + 2) + "px";
          if (marks.length > 1) {
            const badge = document.createElement("div");
            badge.textContent = String(i + 1);
            const where = below ? "left:50%;margin-left:-9px;top:" + (r.height + 5) + "px;" : r.width > 300 ? "right:3px;top:" + Math.max(0, r.height / 2 - 9) + "px;" : "right:-9px;top:-9px;";
            badge.style.cssText = "position:absolute;" + where + "width:18px;height:18px;border-radius:9px;background:#ff6a2b;color:#fff;font:bold 12px/18px sans-serif;text-align:center;box-shadow:0 0 0 2px rgba(0,0,0,.5)";
            ring.appendChild(badge);
          }
          document.body.appendChild(ring);
        });
        return true;
      })()`);
      await sleep(150);
      const params = { format: "png" };
      if (clip) params.clip = { ...clip, scale: 1 };
      const result = await panel.send("Page.captureScreenshot", params);
      await js(`(document.querySelectorAll(".lml-manual-mark").forEach((m) => m.remove()), true)`);
      const file = path.join(media, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(result.data, "base64"));
      console.log(`  ${path.relative(root, file)}`);
      return file;
    },

    /**
     * Renders the active comp (or the comp named `comp`) from `start` for `duration` seconds to PNG
     * frames at half resolution, then encodes docs/manual/media/<name>.gif.
     */
    // Budget: about 1-1.5 MB a GIF, so clips are 4-5 s, 640 wide, 12 fps, 64 colours.
    async gif(name, { start = 0, duration = 5, comp = "", fps = 12, width = 640, colors = 64, dither = "bayer:bayer_scale=5" } = {}) {
      const frames = path.join(work, name);
      fs.rmSync(frames, { recursive: true, force: true });
      fs.mkdirSync(frames, { recursive: true });
      const target = path.join(frames, "f_[####].tif").replace(/\\/g, "/");
      const result = await s.ae(`(function () {
        var c = ${JSON.stringify(comp)} ? null : app.project.activeItem;
        if (!c) for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name === ${JSON.stringify(comp)}) { c = it; break; } }
        if (!(c instanceof CompItem)) return "error: no comp";
        var oldRes = c.resolutionFactor;
        c.resolutionFactor = [2, 2];
        var rq = app.project.renderQueue.items.add(c);
        try {
          rq.timeSpanStart = ${start};
          rq.timeSpanDuration = ${duration ?? "c.duration - " + start};
          rq.setSettings({ "Resolution": "Half", "Use this frame rate": ${fps} });
          var om = rq.outputModule(1);
          om.applyTemplate("TIFF Sequence with Alpha");
          om.file = new File(${JSON.stringify(target)});
          app.project.renderQueue.render();
        } finally {
          try { rq.remove(); } catch (e) {}
          c.resolutionFactor = oldRes;
        }
        return "ok " + c.name;
      })()`);
      if (!/^ok/.test(result ?? "")) throw new Error(`render of ${name}: ${result}`);
      return encodeGif(name, { fps, width, colors, dither });
    },

    /** A still of one frame of the active comp, at full resolution, into docs/manual/media/<name>.png. */
    async still(name, { time = 0, comp = "", width = 1280, keep = true } = {}) {
      const file = path.join(work, `${name}-still.png`).replace(/\\/g, "/");
      fs.rmSync(file, { force: true });
      const result = await s.ae(`(function () {
        var c = ${JSON.stringify(comp)} ? null : app.project.activeItem;
        if (!c) for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name === ${JSON.stringify(comp)}) { c = it; break; } }
        if (!(c instanceof CompItem)) return "error: no comp";
        var oldRes = c.resolutionFactor;
        c.resolutionFactor = [1, 1];
        try { c.saveFrameToPng(${time}, new File(${JSON.stringify(file)})); } finally { c.resolutionFactor = oldRes; }
        return "ok";
      })()`);
      if (result !== "ok") throw new Error(`still of ${name}: ${result}`);
      for (let i = 0; i < 120 && !fs.existsSync(file); i++) await sleep(500);
      await sleep(500);
      const out = path.join(keep ? media : work, `${name}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `scale=${width}:-2:flags=lanczos`, out]);
      fs.rmSync(file, { force: true });
      if (keep) console.log(`  ${path.relative(root, out)}`);
      return out;
    },

    /** Stills side by side (or stacked with `rows`), with a label under each, into media/<name>.png. */
    async strip(name, frames, { width = 1280, rows = false } = {}) {
      const files = [];
      for (const [i, f] of frames.entries()) files.push(await s.still(`${name}-part${i}`, { ...f, width: rows ? width : Math.round(width / frames.length), keep: false }));
      // Labels go through files: drawtext would read a colon in "0:12" as the end of an option.
      const labelFile = (i) => {
        const file = path.join(work, `${name}-label${i}.txt`);
        fs.writeFileSync(file, frames[i].label ?? "");
        return file.replace(/\\/g, "/").replace(/:/g, "\\:");
      };
      const labelled = frames.map((f, i) => `[${i}:v]drawbox=y=ih-34:w=iw:h=34:color=black@0.55:t=fill,drawtext=textfile='${labelFile(i)}':fontfile='C\\:/Windows/Fonts/segoeui.ttf':fontsize=20:fontcolor=white:x=(w-tw)/2:y=h-27[l${i}]`).join(";");
      const out = path.join(media, `${name}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${labelled};${frames.map((_, i) => `[l${i}]`).join("")}${rows ? "vstack" : "hstack"}=inputs=${frames.length}`, out]);
      for (const f of files) fs.rmSync(f, { force: true });
      console.log(`  ${path.relative(root, out)}`);
      return out;
    },

    close() {
      panel.close();
    }
  };
  return s;
}

/**
 * Encodes the rendered frames in .cache/manual/<name>/ into docs/manual/media/<name>.gif. Busy ground
 * (dense roads, imagery, a fast flight) costs more, so it steps down until the GIF is within budget.
 * tools/manual/regif.mjs calls it again on frames already rendered.
 */
export function encodeGif(name, { fps = 12, width = 640, colors = 64, dither = "bayer:bayer_scale=5" } = {}) {
  const frames = path.join(work, name);
  const list = fs.readdirSync(frames).filter((f) => f.endsWith(".tif")).sort();
  if (!list.length) throw new Error(`render of ${name} wrote no frames`);
  const first = list[0].match(/(\d+)\.tif$/)[1];
  const pattern = path.join(frames, list[0].replace(/\d+\.tif$/, `%0${first.length}d.tif`));
  const palette = path.join(frames, "palette.png");
  const out = path.join(media, `${name}.gif`);
  const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  const encode = (w, c, d, rate = fps) => {
    const pace = rate < fps ? `fps=${rate},` : "";
    ffmpeg("-start_number", String(Number(first)), "-framerate", String(fps), "-i", pattern, "-vf", `${pace}scale=${w}:-2:flags=lanczos,format=rgb24,palettegen=max_colors=${c}:stats_mode=diff`, palette);
    ffmpeg("-start_number", String(Number(first)), "-framerate", String(fps), "-i", pattern, "-i", palette, "-lavfi", `[0:v]${pace}scale=${w}:-2:flags=lanczos,format=rgb24[v];[v][1:v]paletteuse=dither=${d}:diff_mode=rectangle`, "-loop", "0", out);
    return fs.statSync(out).size / 1e6;
  };
  let mb = encode(width, colors, dither);
  const steps = [[width, 48, "none"], [Math.round(width * 0.85), 48, "none"], [Math.round(width * 0.75), 40, "none"], [Math.round(width * 0.75), 32, "none", 8], [Math.round(width * 0.625), 32, "none", 8]];
  for (const [w, c, d, rate] of steps) {
    if (mb <= 1.6) break;
    mb = encode(w, c, d, rate);
  }
  console.log(`  ${path.relative(root, out)} ${mb.toFixed(2)} MB, ${list.length} frames`);
  return out;
}

/**
 * Closes every project without saving, leaves an empty one and reloads the panel, so a chapter starts
 * clean: no sheet, tool, table or look left over from the last one.
 */
export async function freshProject(s) {
  await s.ae(`(function () { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.newProject(); app.project.expressionEngine = "javascript-1.0"; return "ok"; })()`);
  await sleep(1500);
  await s.panel.send("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ready = await s.js("!!(window.lmlDebug && window.lmlDebug.map())").catch(() => false);
    if (ready) break;
  }
  await sleep(3000);
  await s.idle();
}

export const tmp = path.join(os.tmpdir(), "LazyMapLayers", "manual");
