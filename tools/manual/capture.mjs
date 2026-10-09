// Makes the pictures of the manual (docs/manual/media/) in the real After Effects.
//
//   node tools/manual/capture.mjs --only 10-pins[,11-callouts]     (one or more chapters)
//   node tools/manual/capture.mjs                                   (every chapter, in order)
//   ... --online                     (also the chapters that go online, such as OpenStreetMap search)
//
// Each chapter is tools/manual/chapters/<id>.mjs, exporting `async function run(s)`, where `s` is a
// session from session.mjs. A chapter starts from an empty project, so chapters can run alone.
// Needs: the development link (npm run build:dev; tools/release-test "3 Back to development"), the
// offline pack in the user data folder, ffmpeg on PATH. Starts After Effects when it is not running
// (ask Sohan first) and leaves it open. Unsaved projects are closed without saving.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshProject, openSession } from "./session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(path.join(here, "chapters")).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).sort();
const i = process.argv.indexOf("--only");
const wanted = i > 0 ? process.argv[i + 1].split(",") : all;
for (const id of wanted) if (!all.includes(id)) throw new Error(`no chapter script ${id}; there are ${all.join(", ")}`);

const s = await openSession();
let failed = 0;
try {
  for (const id of wanted) {
    console.log(`- ${id}`);
    const started = Date.now();
    try {
      await freshProject(s);
      const chapter = await import(pathToFileURL(path.join(here, "chapters", `${id}.mjs`)).href);
      // A chapter that goes online (OpenStreetMap, downloads) runs only with --online.
      if (chapter.online && !process.argv.includes("--online")) {
        console.log("  skipped: goes online (add --online)");
        continue;
      }
      await chapter.run(s);
      console.log(`  done in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (error) {
      failed++;
      console.log(`  FAILED: ${error.stack ?? error}`);
      console.log(`  last log: ${JSON.stringify((await s.js("window.lmlDebug.log().slice(-4)").catch(() => [])))}`);
    }
  }
} finally {
  s.close();
}
process.exit(failed ? 1 : 0);
