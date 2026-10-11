// Renders the logo's PNG sizes from the SVG masters in docs/brand/ with headless Edge (no packages):
//   docs/brand/lazymaplayers-icon-{512,256,128,64}.png   from lazymaplayers-icon.svg
//   docs/brand/lazymaplayers-icon-{32,16}.png             from lazymaplayers-icon-small.svg (no motion path)
//   panel/icons/icon.png (23 px) and icon@2x.png (46 px)   the panel's icon in the CEP manifest (small master)
//
//   node tools/brand/render-icons.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const brand = path.join(root, "docs/brand");
const jobs = [
  ...[512, 256, 128, 64].map((size) => ["lazymaplayers-icon.svg", size, path.join(brand, `lazymaplayers-icon-${size}.png`)]),
  ...[32, 16].map((size) => ["lazymaplayers-icon-small.svg", size, path.join(brand, `lazymaplayers-icon-${size}.png`)]),
  ["lazymaplayers-icon-small.svg", 23, path.join(root, "panel/icons/icon.png")],
  ["lazymaplayers-icon-small.svg", 46, path.join(root, "panel/icons/icon@2x.png")],
];

const browser = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!browser) throw new Error("Microsoft Edge was not found");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lml-icons-"));
const proc = spawn(browser, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--inprivate", "--disable-extensions", "--disable-sync",
  "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\s+/)[0]); } catch {} if (!port) await sleep(100); }
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && t.url === "about:blank"); } catch {}
    if (!target) await sleep(200);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  // a transparent page, so the tile's rounded corners stay transparent in the PNG
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [file, size, out] of jobs) {
    const svg = fs.readFileSync(path.join(brand, file), "utf8");
    const html = `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
    await sleep(300);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
    console.log(`${path.relative(root, out)} (${size} px)`);
  }
  ws.close();
} finally {
  proc.kill();
}
