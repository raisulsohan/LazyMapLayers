// Makes the README demo from the offline pack, in order:
//   1. extract.mjs   map data and the satellite picture into .cache/demo/
//   2. build.mjs     docs/demo/lazymaplayers-demo.html (the player page, from page.template.html)
//   3. capture.mjs   PNG frames of the page in a headless browser          (with --gif)
//   4. gif.mjs       docs/demo/lazymaplayers-demo.gif, 960x540, 15 fps    (with --gif)
//
//   node tools/demo/make.mjs [--gif]
//
// Needs the offline pack in the user data folder, ffmpeg on PATH, and for --gif Edge or Chrome.
// The animation itself is edited in page.template.html; open the built page to play it.

import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const steps = ["extract.mjs", "build.mjs", ...(process.argv.includes("--gif") ? ["capture.mjs", "gif.mjs"] : [])];
for (const step of steps) {
  console.log(`- ${step}`);
  execFileSync(process.execPath, [path.join(here, step)], { stdio: "inherit" });
}
