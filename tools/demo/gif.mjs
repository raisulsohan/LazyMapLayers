// Encodes the captured frames into docs/demo/lazymaplayers-demo.gif with ffmpeg's palettegen and
// paletteuse: 960x540, 15 fps, one palette for the whole animation.
//
//   node tools/demo/gif.mjs [--colors 40]        (after node tools/demo/capture.mjs)
//
// What keeps the GIF under 3 MB:
//  - the page moves its camera in two flights only; everything else happens over a still map, which
//    costs almost nothing because a GIF frame stores only the rectangle that changed;
//  - no dithering, and few colours (40);
//  - a swatch of the key colours (the pins, the highway, white text) is fed to palettegen as extra
//    frames, so colours that cover few pixels are not merged away;
//  - no mpdecimate: dropping still frames made the GIF muxer stop storing only the changes (50 MB).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const colors = Number(arg("--colors", "40"));
const cache = path.join(root, ".cache", "demo");
const frames = path.join(cache, "frames", "f%04d.png");
const out = path.join(root, "docs", "demo", "lazymaplayers-demo.gif");
if (!fs.existsSync(path.join(cache, "frames", "f0000.png"))) throw new Error("no frames: run node tools/demo/capture.mjs first");

const KEY_COLOURS = ["ffffff", "ffc740", "e2582a", "e9a23b", "36b3ff", "ffd27a", "07111f", "eef3f8"];
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const swatch = path.join(cache, "swatch.png");
const palette = path.join(cache, "palette.png");

ffmpeg(...KEY_COLOURS.flatMap((c) => ["-f", "lavfi", "-i", `color=c=0x${c}:s=120x540:d=1`]),
  "-filter_complex", `hstack=inputs=${KEY_COLOURS.length}`, "-frames:v", "1", swatch);
ffmpeg("-framerate", "15", "-i", frames, "-loop", "1", "-t", "2.67", "-framerate", "15", "-i", swatch,
  "-filter_complex", `[0:v]scale=960:540:flags=area,format=rgb24[a];[1:v]fps=15,format=rgb24[b];[a][b]concat=n=2:v=1,palettegen=max_colors=${colors}:stats_mode=full`,
  palette);
ffmpeg("-framerate", "15", "-i", frames, "-i", palette,
  "-lavfi", "[0:v]scale=960:540:flags=area[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle", "-loop", "0", out);

const mb = fs.statSync(out).size / 1e6;
console.log(`${path.relative(root, out)} ${mb.toFixed(2)} MB (${colors} colours)${mb >= 3 ? "  - over 3 MB, try --colors 36" : ""}`);
