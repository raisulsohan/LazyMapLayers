// Links dist/ into the per-user CEP extensions folder as a directory junction, so every build is
// live after reopening the panel. PlayerDebugMode must be on (it is on Sohan's machine).
//
//   node tools/install-dev.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (!fs.existsSync(path.join(dist, "CSXS", "manifest.xml"))) {
  console.error("dist/ is not built yet. Run: node tools/build.mjs --dev");
  process.exit(1);
}

const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const extensions = process.platform === "win32"
  ? path.join(appData, "Adobe", "CEP", "extensions")
  : path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
const target = path.join(extensions, "com.sohan.LazyMapLayers");
fs.mkdirSync(extensions, { recursive: true });

let existing = null;
try {
  existing = fs.lstatSync(target);
} catch {
  existing = null;
}
if (existing) {
  if (existing.isSymbolicLink()) {
    fs.unlinkSync(target);
  } else {
    console.error(`${target} exists and is not a link; remove it by hand (it may be a release install).`);
    process.exit(1);
  }
}
fs.symlinkSync(dist, target, process.platform === "win32" ? "junction" : "dir");
console.log(`linked ${target} -> ${dist}`);
