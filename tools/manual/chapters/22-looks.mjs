// Chapter 22: the twelve looks, your own colours, a look from a picture, details.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { media, root } from "../session.mjs";

const THEMES = ["midnight", "satellite", "daylight", "atlas", "blueprint", "mono", "paper", "noir", "slate", "terracotta", "arctic", "emerald"];
const LABELS = ["Midnight", "Satellite", "Daylight", "Atlas", "Blueprint", "Mono", "Paper", "Noir", "Slate", "Terracotta", "Arctic", "Emerald"];

/** A labelled 4 x 3 grid of stills. */
function grid(name, files, labels) {
  const inputs = files.flatMap((f) => ["-i", f]);
  const tiles = files.map((_, i) => `[${i}:v]scale=480:-2,drawbox=y=ih-30:w=iw:h=30:color=black@0.55:t=fill,drawtext=text='${labels[i]}':fontfile='C\\:/Windows/Fonts/segoeui.ttf':fontsize=18:fontcolor=white:x=(w-tw)/2:y=h-25[t${i}]`).join(";");
  const layout = files.map((_, i) => `${(i % 4) * 480}_${Math.floor(i / 4) * 270}`).join("|");
  const out = path.join(media, `${name}.png`);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${tiles};${files.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}`, out]);
  console.log(`  ${path.relative(root, out)}`);
}

export async function run(s) {
  await s.newMap("Looks", { center: { lat: 40.5, lng: 16 }, zoom: 4.6, bearing: 0, pitch: 0 }, { duration: 1 });
  await s.click("look");
  await new Promise((r) => setTimeout(r, 600));
  await s.shot("22-look-sheet", { mark: [".theme-grid", "look-ocean", "detail-lines", "look-from-picture", "look-save", "look-share"] });
  const stills = [];
  for (const id of THEMES) {
    await s.click(`theme-${id}`);
    await s.idle();
    await s.preview();
    stills.push(await s.still(`22-theme-${id}`, { time: 0.5, keep: false, width: 960 }));
  }
  grid("22-twelve-looks", stills, LABELS);
  for (const f of stills) fs.rmSync(f, { force: true });
  // Your own colours on Midnight.
  await s.click("theme-midnight");
  await s.idle();
  await s.set("look-ocean", "#3a0d52");
  await s.idle();
  await s.set("look-land", "#f0e4c8");
  await s.idle();
  await s.set("look-accent", "#ff5a36");
  await s.idle();
  await s.shot("22-own-colours", { mark: ["look-ocean", "look-land", "look-accent", "look-text"] });
  await s.preview();
  await s.still("22-own-colours-result", { time: 0.5 });
  // From a picture: a still with a dark teal sky and a warm orange sun, made here.
  await s.js(`(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const c = canvas.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 180);
    g.addColorStop(0, "#0b2a33"); g.addColorStop(0.6, "#1d5c63"); g.addColorStop(1, "#e8a33d");
    c.fillStyle = g; c.fillRect(0, 0, 320, 180);
    c.fillStyle = "#f2d7a0"; c.beginPath(); c.arc(240, 120, 28, 0, Math.PI * 2); c.fill();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    window.__still = canvas.toDataURL("image/png");
    await window.lmlDebug.store.lookFromImage(new File([blob], "still.png", { type: "image/png" }));
    return true;
  })()`);
  await s.idle();
  const still = await s.js("window.__still");
  fs.writeFileSync(path.join(media, "22-picture-still.png"), Buffer.from(still.split(",")[1], "base64"));
  await s.preview();
  await s.still("22-from-picture-result", { time: 0.5 });
  // Details: heavier lines, fewer names.
  await s.click("look-reset");
  await s.idle();
  await s.set("detail-lines", 2);
  await s.idle();
  await s.set("detail-labels", "fewer");
  await s.idle();
  await s.preview();
  await s.still("22-details", { time: 0.5 });
  await s.store("store.changeLookDetails({ lines: 1, roads: 1, labels: \"normal\" })");
  await s.idle();
}
