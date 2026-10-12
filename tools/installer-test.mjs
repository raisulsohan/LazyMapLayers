/*
 * The installers, run as a user runs them, against a test home folder (DECISIONS D104).
 *
 *   node tools/installer-test.mjs [--staged <release build>] [--keep]
 *
 * Builds the download folder as tools/package-zxp.mjs does - the installers with the line endings
 * each shell needs, by the same code - but with an unsigned .zxp of the release build and two tiny
 * map packs that hold the files the installers look for. Zips it with the release's zip writer and
 * unpacks it with the system's own tool (ditto on macOS, as Archive Utility does; .NET's unzip on
 * Windows), so the .command files' executable bit is checked as a user receives it. Then runs the
 * installer for this system with its home folder (macOS: HOME) or roaming folder (Windows: APPDATA)
 * pointed into a test folder, answering on standard input, and checks every place and file:
 *
 *   1. Full on a clean computer.
 *   2. Light over it: the world files replaced, a downloaded region and the full pack's extras kept.
 *   3. Full, then Online: the copied world files removed, the downloads kept.
 *   4. A developer link where the panel goes: replaced by the panel, what it pointed at untouched.
 *   5. Uninstall, keeping the data; then uninstall again, removing it.
 *
 * Nothing outside the test folder is touched. CI runs it on Windows and macOS; it runs on a
 * development PC too (the .bat there, nothing After Effects sees).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyInstallers, stagedProblems } from "./installer-files.mjs";
import { walk, writeZip } from "./zip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const mac = process.platform === "darwin";
if (!mac && process.platform !== "win32") {
  console.log("The installers are for Windows and macOS; nothing to test on this system.");
  process.exit(0);
}

const work = join(tmpdir(), "lazymaplayers-installer-test");
const home = join(work, "home");
/* Where each system keeps the panel and its data, inside the test folder. */
const roaming = mac ? join(home, "Library", "Application Support") : join(home, "AppData", "Roaming");
const extensions = mac ? join(roaming, "Adobe", "CEP", "extensions") : join(roaming, "Adobe", "CEP", "extensions");
const DEST = join(extensions, "com.sohan.LazyMapLayers");
const DATA = join(roaming, "LazyMapLayers");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`);
}

/* ------------------------------------------------------------ the download */

/** A file that starts like a PMTiles v3 archive and says which pack it came from. */
const pmtiles = (what) => Buffer.concat([Buffer.from([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3]), Buffer.from(` ${what}`.padEnd(what.startsWith("light") ? 90 : 120, "."))]);

const PACKS = {
  "offline-data": {
    "offline/world.pmtiles": pmtiles("full world"),
    "offline/pack.json": JSON.stringify({ v: 1, world: { maxZoom: 9 }, terrain: { maxZoom: 6 } }),
    "offline/CREDITS.txt": "full credits\n",
    "terrain/world.pmtiles": pmtiles("full terrain"),
    "imagery/blue-marble.pmtiles": pmtiles("blue marble"),
    "imagery/relief.pmtiles": pmtiles("relief"),
    "boundaries/manifest.json": JSON.stringify({ countries: 1 }),
    "boundaries/AFG-ADM2.json": "{}"
  },
  "light-data": {
    "offline/world.pmtiles": pmtiles("light world"),
    "offline/pack.json": JSON.stringify({ v: 1, kind: "light", world: { maxZoom: 6 } }),
    "offline/CREDITS.txt": "light credits\n",
    "terrain/world.pmtiles": pmtiles("light terrain")
  }
};

function writeFiles(dir, files) {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
}

function buildDownload() {
  let staging = option("--staged");
  if (!staging) {
    staging = join(work, "stage", "com.sohan.LazyMapLayers");
    execFileSync(process.execPath, [join(root, "tools", "build.mjs"), "--out", staging], { cwd: root, stdio: "inherit" });
  }
  const problems = stagedProblems(resolve(staging), VERSION);
  check("the release build holds what a release needs", problems.length === 0, problems.join(" "));

  const payload = join(work, "download", "LazyMapLayers");
  mkdirSync(payload, { recursive: true });
  // Unsigned: the installers only unpack it; a signature is After Effects' business.
  writeZip(join(payload, `LazyMapLayers-${VERSION}.zxp`), walk(resolve(staging)));
  copyInstallers(root, payload);
  for (const [folder, files] of Object.entries(PACKS)) writeFiles(join(payload, folder), files);

  const zip = join(work, "LazyMapLayers-test.zip");
  writeZip(zip, walk(payload, "LazyMapLayers/"));
  const unzipped = join(work, "unzipped");
  if (mac) execFileSync("ditto", ["-x", "-k", zip, unzipped]);
  else {
    execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zip}', '${unzipped}')`]);
  }
  const folder = join(unzipped, "LazyMapLayers");
  const listed = readdirSync(folder);
  check("the download unpacks with the installers, the .zxp and both packs", ["Install LazyMapLayers.bat", "Install LazyMapLayers (macOS).command", "Uninstall LazyMapLayers (macOS).command", "Read me first.txt", "offline-data", "light-data"].every((name) => listed.includes(name)) && listed.some((name) => name.endsWith(".zxp")), listed.join(", "));
  for (const name of listed.filter((n) => n.endsWith(".command"))) {
    const text = readFileSync(join(folder, name), "utf8");
    check(`${name} has Unix line endings`, !text.includes("\r"));
    if (mac) check(`${name} is executable after unpacking`, (statSync(join(folder, name)).mode & 0o111) !== 0, (statSync(join(folder, name)).mode & 0o777).toString(8));
  }
  for (const name of listed.filter((n) => n.endsWith(".bat"))) check(`${name} has Windows line endings`, /\r\n/.test(readFileSync(join(folder, name), "utf8")) && !/[^\r]\n/.test(readFileSync(join(folder, name), "utf8")));
  return folder;
}

/* -------------------------------------------------------- running them */

function runScript(folder, which, answers) {
  const env = { ...process.env };
  let result;
  if (mac) {
    env.HOME = home;
    const file = join(folder, which === "install" ? "Install LazyMapLayers (macOS).command" : "Uninstall LazyMapLayers (macOS).command");
    // Run as a double-click runs it: the file itself, through its #! line and its executable bit.
    result = spawnSync(file, [], { env, input: answers.join("\n") + "\n", encoding: "utf8", timeout: 120000 });
  } else {
    env.APPDATA = roaming;
    const file = join(folder, which === "install" ? "Install LazyMapLayers.bat" : "Uninstall LazyMapLayers.bat");
    // From a pipe, pause takes one character and choice one letter, while set /p takes a line: a
    // key for each pause ("k"), the pick with its Enter, the letter alone.
    const input = which === "install" ? `k${answers[1]}\r\nk` : `k${answers[1]}k`;
    result = spawnSync("cmd.exe", ["/d", "/c", `call "${file}"`], { env, input, encoding: "utf8", timeout: 120000, windowsVerbatimArguments: true });
  }
  const said = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // The scripts end on a pause, so their exit code says little (robocopy's leaks out); errors and [!] lines do.
  if (result.error || /\[!\]/.test(said)) {
    console.log(`---- ${which} said:\n${said}\n---- (exit ${result.status}${result.error ? `, ${result.error.message}` : ""})`);
  }
  return { status: result.status, said };
}

/* What each script asks, in order: closing After Effects, then the pick (installer) or yes/no (uninstaller), then a key to close. */
const install = (folder, pick) => runScript(folder, "install", ["", pick, ""]);
const uninstall = (folder, yes) => runScript(folder, "uninstall", ["", yes ? "y" : "n", ""]);

const read = (file) => (existsSync(file) ? readFileSync(file, "latin1") : null);
const has = (file, what) => (read(file) ?? "").includes(what);
const isLink = (file) => {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};

function panelInstalled(label) {
  const manifest = read(join(DEST, "CSXS", "manifest.xml")) ?? "";
  check(`${label}: the panel is in ${mac ? "~/Library/Application Support" : "%APPDATA%"}/Adobe/CEP/extensions`, manifest.includes(`ExtensionBundleVersion="${VERSION}"`) && existsSync(join(DEST, "host", "lazymaplayers.jsx")));
}

function main() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const folder = buildDownload();

  // 1. Full, on a computer with nothing.
  let run = install(folder, "1");
  panelInstalled("Full");
  const full = Object.keys(PACKS["offline-data"]);
  check("Full: every file of the full pack is in the data folder", full.every((name) => existsSync(join(DATA, name))), full.filter((name) => !existsSync(join(DATA, name))).join(", "));
  check("Full: the world is the full one", has(join(DATA, "offline", "world.pmtiles"), "full world"));
  check("Full: the installer says so", /Installed\./.test(run.said) && /map data is in place/.test(run.said));

  // 2. Light over Full, with a region the user downloaded.
  writeFiles(DATA, { "regions/paris.pmtiles": pmtiles("paris") });
  run = install(folder, "2");
  panelInstalled("Light");
  check("Light: the world and the elevation are the light ones", has(join(DATA, "offline", "world.pmtiles"), "light world") && has(join(DATA, "terrain", "world.pmtiles"), "light terrain") && has(join(DATA, "offline", "pack.json"), "light"));
  check("Light: the downloaded region is kept", has(join(DATA, "regions", "paris.pmtiles"), "paris"));

  // 3. Full again, then Online: the copied world goes, the downloads stay.
  install(folder, "1");
  run = install(folder, "3");
  panelInstalled("Online");
  const gone = ["offline/world.pmtiles", "offline/pack.json", "offline/CREDITS.txt", "terrain/world.pmtiles"].filter((name) => existsSync(join(DATA, name)));
  check("Online: the world files an earlier install copied are removed", gone.length === 0, gone.join(", "));
  check("Online: downloads and the full pack's pictures and districts are kept", ["regions/paris.pmtiles", "imagery/blue-marble.pmtiles", "boundaries/manifest.json"].every((name) => existsSync(join(DATA, name))));

  // 4. A developer link where the panel goes.
  rmSync(DEST, { recursive: true, force: true });
  const devTarget = join(work, "dev-dist");
  writeFiles(devTarget, { "CSXS/manifest.xml": "<dev/>", "keep-me.txt": "the developer's build" });
  symlinkSync(devTarget, DEST, mac ? "dir" : "junction");
  check("a developer link is in place before the install", isLink(DEST));
  install(folder, "3");
  check("the developer link is replaced by the panel", !isLink(DEST) && has(join(DEST, "CSXS", "manifest.xml"), VERSION));
  check("what the developer link pointed at is untouched", has(join(devTarget, "keep-me.txt"), "developer"));

  // 5. Uninstall, keeping the data; then again, removing it.
  run = uninstall(folder, false);
  check("uninstall: the panel is gone", !existsSync(DEST));
  check("uninstall, answering no: the data is kept", existsSync(join(DATA, "regions", "paris.pmtiles")));
  install(folder, "3");
  run = uninstall(folder, true);
  check("uninstall, answering yes: the panel and the data are gone", !existsSync(DEST) && !existsSync(DATA), run.said.split(/\r?\n/).filter((l) => /Removed|Kept|Could not/.test(l)).join(" / "));

  if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true });
  console.log(failures ? `\n${failures} installer check(s) failed` : `\nevery installer check passed (${mac ? "macOS .command" : "Windows .bat"})`);
  process.exit(failures ? 1 : 0);
}

main();
