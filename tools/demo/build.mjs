// Builds docs/demo/lazymaplayers-demo.html from tools/demo/page.template.html: the map data from
// .cache/demo/data.json goes in gzipped and base64-encoded, the satellite picture as a data URI, so
// the page is one file that also opens from disk.
//
//   node tools/demo/build.mjs        (after node tools/demo/extract.mjs)

import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const cache = path.join(root, ".cache", "demo");
const out = path.join(root, "docs", "demo", "lazymaplayers-demo.html");

for (const f of ["data.json", "sat.jpg"]) {
  if (!fs.existsSync(path.join(cache, f))) throw new Error(`missing .cache/demo/${f}: run node tools/demo/extract.mjs first`);
}
const data = gzipSync(fs.readFileSync(path.join(cache, "data.json")), { level: 9 }).toString("base64").replace(/.{1,120}/g, "$&\n");
const sat = "data:image/jpeg;base64," + fs.readFileSync(path.join(cache, "sat.jpg")).toString("base64");
const html = fs.readFileSync(path.join(here, "page.template.html"), "utf8")
  .replace("/*DATA*/", () => "\n" + data)
  .replace("/*SAT*/", () => sat);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${path.relative(root, out)} ${(html.length / 1024).toFixed(0)} KB`);
