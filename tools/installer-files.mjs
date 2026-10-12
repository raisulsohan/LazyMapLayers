/*
 * What the release script and the installer test share (DECISIONS D104): the installers copied into a
 * download folder with the line endings each shell needs, and the checks a staged release build must
 * pass. tools/package-zxp.mjs builds the real download with them; tools/installer-test.mjs builds a
 * test one, so CI checks the same folder a user receives.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* What a release build must hold. */
export const RELEASE_FILES = [
  "CSXS/manifest.xml", "LICENSE",
  "panel/index.html", "panel/panel.css", "panel/panel.js", "panel/maplibre-gl.css",
  "panel/maplibre-worker.js", "panel/encode-worker.js",
  "host/lazymaplayers.jsx",
  "data/natural-earth.pmtiles", "data/borders.geojson", "data/labels.json",
  "data/admin1-index.json", "data/admin1/BGD.json", "data/countries/BGD.json",
];

/** Every way a staged release build falls short, as sentences; empty when it is fine. */
export function stagedProblems(staging, version) {
  const problems = [];
  for (const needed of RELEASE_FILES) {
    if (!existsSync(join(staging, needed))) problems.push(`${needed} is missing from the build.`);
  }
  if (existsSync(join(staging, ".debug"))) problems.push("the build contains a .debug file; release builds must not open a debug port.");
  const manifest = existsSync(join(staging, "CSXS", "manifest.xml")) ? readFileSync(join(staging, "CSXS", "manifest.xml"), "utf8") : "";
  if (!manifest.includes(`ExtensionBundleVersion="${version}"`)) problems.push(`the manifest does not carry version ${version}.`);
  /* Adobe's signature check replaces symlinks as it verifies, and needs rights
     the user may not have, which shows up as a blank panel. Allow none. */
  const links = [];
  (function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(path);
      else if (entry.isDirectory()) scan(path);
    }
  })(staging);
  if (links.length) problems.push(`the panel contains symlinks, which break signed installs:\n    ${links.join("\n    ")}`);
  return problems;
}

/*
 * cmd.exe misreads a .bat with Unix line endings, and bash misreads a
 * .command with Windows ones, so each is rewritten with the endings its
 * shell needs rather than copied as it is.
 */
export function copyInstallers(root, payload) {
  for (const name of readdirSync(join(root, "tools", "installer"))) {
    const from = join(root, "tools", "installer", name);
    const to = join(payload, name);
    if (/\.(bat|cmd|txt)$/i.test(name)) {
      writeFileSync(to, readFileSync(from, "utf8").replace(/\r?\n/g, "\r\n"));
    } else if (/\.(command|sh)$/i.test(name)) {
      writeFileSync(to, readFileSync(from, "utf8").replace(/\r\n/g, "\n"));
    } else {
      cpSync(from, to);
    }
  }
}
