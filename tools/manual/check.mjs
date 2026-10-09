// Checks the manual: every link to a chapter or a file resolves, every picture a chapter shows exists,
// and lists pictures no chapter shows and GIFs over budget.
//
//   node tools/manual/check.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(root, "docs", "manual");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
const used = new Set();
let problems = 0;
for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^https?:/.test(target)) continue;
    const local = target.split("#")[0];
    if (!local) continue;
    if (local.startsWith("media/")) used.add(local.slice(6));
    if (!fs.existsSync(path.join(dir, local))) {
      console.log(`${file}: missing ${target}`);
      problems++;
    }
  }
}
const media = fs.existsSync(path.join(dir, "media")) ? fs.readdirSync(path.join(dir, "media")) : [];
for (const m of media) {
  if (!used.has(m)) console.log(`not shown anywhere: media/${m}`);
  const mb = fs.statSync(path.join(dir, "media", m)).size / 1e6;
  if (m.endsWith(".gif") && mb > 1.8) console.log(`over budget: media/${m} ${mb.toFixed(2)} MB`);
}
const total = media.reduce((sum, m) => sum + fs.statSync(path.join(dir, "media", m)).size, 0) / 1e6;
console.log(`${files.length} pages, ${media.length} pictures (${total.toFixed(1)} MB), ${problems} broken links`);
process.exit(problems ? 1 : 0);
