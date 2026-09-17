/*
 * Packages LazyMapLayers as a signed ZXP, wrapped in a zip a user can unzip and
 * install with one double-click (Windows or macOS).
 *
 *   node tools/package-zxp.mjs --cert     make the signing certificate (once)
 *   node tools/package-zxp.mjs            build, sign and package
 *
 * Adobe's own ZXPSignCmd does the signing; tools/get-zxpsigncmd.mjs fetches it
 * into tools/vendor/. The key that signs it sits in the repository folder but
 * never in git, because this repository is public (see `certDir`). The panel is
 * built straight into a temporary staging folder, so dist/ (which the developer
 * link points at) is left alone. The finished zip goes to the shared "Install
 * from here" folder; the half-built pieces are swept up at the end.
 *
 * It works like the release scripts of the other Lazy tools, so they all
 * install alike.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walk, writeZip } from "./zip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
/* 0.1.0 reads as 0.1 in the zip name; 0.1.1 stays 0.1.1. */
const SHORT = VERSION.replace(/\.0$/, "");

const PRODUCT = "LazyMapLayers";
const BUNDLE_ID = "com.sohan.LazyMapLayers";
const DOWNLOAD_FOLDER_NAMES = ["00. Install from here", "00 Install from here"];

/*
 * The finished zip goes to the nearest "Install from here" folder found beside
 * the repository or beside any folder above it (D:\GitHub\00. Install from here
 * for D:\GitHub\01. After Effects Tools\LazyMapLayers), which keeps only the
 * newest LazyMapLayers zip. LAZYMAPLAYERS_DOWNLOAD_DIR overrides it.
 */
function downloadsFolder() {
  if (process.env.LAZYMAPLAYERS_DOWNLOAD_DIR) return process.env.LAZYMAPLAYERS_DOWNLOAD_DIR;
  for (let dir = dirname(root); ; dir = dirname(dir)) {
    for (const name of DOWNLOAD_FOLDER_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    if (dirname(dir) === dir) break;
  }
  return join(dirname(root), DOWNLOAD_FOLDER_NAMES[0]);
}

/*
 * The signing key lives in the repository folder, in "Signing key (do not
 * share)", kept out of git twice over: .gitignore and .git/info/exclude (which
 * no commit can change). LAZYMAPLAYERS_KEY_DIR overrides where it is.
 */
const downloads = downloadsFolder();
const certDir = process.env.LAZYMAPLAYERS_KEY_DIR || join(root, "Signing key (do not share)");
const p12 = join(certDir, "lazymaplayers.p12");
const pwFile = join(certDir, "password.txt");

/* Everything half-built goes to a scratch folder and is swept up after. */
const work = join(tmpdir(), `lazymaplayers-build-${VERSION}`);
const staging = join(work, BUNDLE_ID);
const payload = join(work, PRODUCT);
const zxpName = `${PRODUCT}-${VERSION}.zxp`;
const zxp = join(work, zxpName);
const zipName = `${PRODUCT}-v${SHORT}.zip`;

/* Who the installer names as the publisher. */
const CERT = {
  country: "BD",
  state: "Dhaka",
  organisation: PRODUCT,
  commonName: "Raisul Sohan",
  validityDays: "3650",
};

/*
 * A timestamp is what keeps a signed extension working after the certificate
 * expires, so it is worth trying more than one server before giving up.
 */
const TIMESTAMP_SERVERS = [
  "http://timestamp.digicert.com",
  "http://time.certum.pl/",
  "http://timestamp.sectigo.com",
];

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

function log(step, message) {
  console.log(`${step}  ${message}`);
}

function fail(message) {
  console.error(`\n[!] ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- the tool */

function signTool() {
  const named = process.env.ZXPSIGNCMD;
  const exe = process.platform === "win32" ? "ZXPSignCmd.exe" : "ZXPSignCmd";
  const candidates = [named, join(root, "tools", "vendor", exe), exe].filter(Boolean);
  for (const candidate of candidates) {
    try {
      /* Printing its usage is how ZXPSignCmd answers a call with no work to
         do, and it exits non-zero while doing it, so the test is the text. */
      execFileSync(candidate, ["-h"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return candidate;
    } catch (error) {
      const said = `${error.stdout || ""}${error.stderr || ""}`;
      if (said.includes("ZXPSignCmd -sign")) return candidate;
    }
  }
  fail(
    "ZXPSignCmd was not found. Run `node tools/get-zxpsigncmd.mjs` to download\n" +
    "    Adobe's signing tool into tools/vendor/, or set ZXPSIGNCMD to its path.",
  );
}

function run(tool, argv) {
  return execFileSync(tool, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/* -------------------------------------------------------- the certificate */

function password() {
  if (process.env.LAZYMAPLAYERS_CERT_PASSWORD) return process.env.LAZYMAPLAYERS_CERT_PASSWORD;
  if (existsSync(pwFile)) return readFileSync(pwFile, "utf8").trim();
  mkdirSync(certDir, { recursive: true });
  /* Letters and digits only: this is passed on a command line. */
  const made = randomBytes(32).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  writeFileSync(pwFile, made + "\n");
  log("[cert]", `wrote a new password to ${pwFile}; keep it, and keep it out of git`);
  return made;
}

function makeCert(tool) {
  if (existsSync(p12) && !has("--force")) {
    fail(
      `${p12} already exists.\n` +
      "    Signing every release with the same certificate keeps the publisher the\n" +
      "    same from one version to the next, so it is not overwritten by accident.\n" +
      "    Pass --force if you really mean to start a new identity.",
    );
  }
  mkdirSync(certDir, { recursive: true });
  const pw = password();
  run(tool, [
    "-selfSignedCert",
    CERT.country, CERT.state, CERT.organisation, CERT.commonName,
    pw, p12,
    "-validityDays", CERT.validityDays,
  ]);
  if (!existsSync(p12)) fail("ZXPSignCmd did not produce the certificate.");
  log("[cert]", `${p12}: ${CERT.commonName}, ${CERT.organisation} (${CERT.validityDays} days)`);
  console.log(
    `\nBack up "${certDir}" somewhere private (not GitHub: this repository is public).\n`,
  );
}

/* ------------------------------------------------------------ the package */

/*
 * package.json holds the version. tools/build.mjs writes it into the manifest
 * and the host script; the README names the zip, so it is kept in step here.
 */
function syncVersion() {
  const edits = [
    { file: "README.md", find: /LazyMapLayers-v[\d.]+\.zip/g, to: zipName },
  ];
  for (const edit of edits) {
    const path = join(root, edit.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(edit.find, edit.to);
    if (after !== before) {
      writeFileSync(path, after);
      log("[1/6]", `set ${VERSION} in ${edit.file}`);
    }
  }
}

function count(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? count(join(dir, entry.name)) : 1;
  }
  return n;
}

function stage() {
  syncVersion();
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  /* A production build: minified, no source maps, no debug port file. */
  execFileSync(process.execPath, [join(root, "tools", "build.mjs"), "--out", staging], { cwd: root, stdio: "inherit" });

  for (const needed of [
    "CSXS/manifest.xml", "LICENSE",
    "panel/index.html", "panel/panel.css", "panel/panel.js", "panel/maplibre-gl.css",
    "panel/maplibre-worker.js", "panel/encode-worker.js",
    "host/lazymaplayers.jsx",
    "data/natural-earth.pmtiles", "data/borders.geojson", "data/labels.json",
    "data/admin1-index.json", "data/admin1/BGD.json",
  ]) {
    if (!existsSync(join(staging, needed))) fail(`${needed} is missing from the build.`);
  }
  if (existsSync(join(staging, ".debug"))) fail("the build contains a .debug file; release builds must not open a debug port.");
  const manifest = readFileSync(join(staging, "CSXS", "manifest.xml"), "utf8");
  if (!manifest.includes(`ExtensionBundleVersion="${VERSION}"`)) fail(`the manifest does not carry version ${VERSION}.`);

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
  if (links.length) {
    fail(`the panel contains symlinks, which break signed installs:\n    ${links.join("\n    ")}`);
  }

  log("[2/6]", `staged ${count(staging)} panel files`);
}

function sign(tool) {
  if (!existsSync(p12)) {
    fail("no certificate yet. Run `node tools/package-zxp.mjs --cert` first.");
  }
  const pw = password();
  rmSync(zxp, { force: true });

  let signed = false;
  for (const tsa of TIMESTAMP_SERVERS) {
    try {
      run(tool, ["-sign", staging, zxp, p12, pw, "-tsa", tsa]);
      log("[3/6]", `signed, timestamped by ${tsa}`);
      signed = true;
      break;
    } catch {
      rmSync(zxp, { force: true });
      log("[3/6]", `${tsa} did not answer; trying the next timestamp server...`);
    }
  }
  if (!signed) {
    /* Without a timestamp the panel stops loading the day the certificate
       expires, so this is a fallback and it says so. */
    try {
      run(tool, ["-sign", staging, zxp, p12, pw]);
    } catch (error) {
      fail(`signing failed:\n${error.stdout || ""}${error.stderr || error.message}`);
    }
    log("[3/6]", "signed WITHOUT a timestamp: no timestamp server answered.");
    console.log("       Re-run with a connection: an untimestamped panel stops");
    console.log("       loading on the day the certificate expires.\n");
  }
  if (!existsSync(zxp)) fail("ZXPSignCmd reported success but no .zxp appeared.");
}

function verify(tool) {
  try {
    const out = run(tool, ["-verify", zxp, "-certInfo"]);
    log("[4/6]", "verified:");
    for (const line of out.trim().split(/\r?\n/)) console.log(`        ${line}`);
  } catch (error) {
    fail(`the signed package does not verify:\n${error.stdout || error.message}`);
  }
}

/* ------------------------------------------------------- what a user gets */

function assemble() {
  rmSync(payload, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });
  cpSync(zxp, join(payload, zxpName));

  /* cmd.exe misreads a .bat with Unix line endings, and bash misreads a
     .command with Windows ones, so each is rewritten with the endings its
     shell needs rather than copied as it is. */
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
  log("[5/6]", `assembled the download folder (${count(payload)} files)`);
}

function zip() {
  mkdirSync(downloads, { recursive: true });
  /* One LazyMapLayers zip there at a time; older versions stay on GitHub's
     releases page. Every other product's zip in the folder is left alone. */
  for (const old of readdirSync(downloads)) {
    if (/^LazyMapLayers-v[\d.]+\.zip$/.test(old)) rmSync(join(downloads, old), { force: true });
  }
  const out = join(downloads, zipName);
  /* Built here rather than with Compress-Archive, which writes nested paths
     with backslashes (see tools/zip.mjs). */
  const bytes = writeZip(out, walk(payload, `${PRODUCT}/`));
  const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
  log("[6/6]", `${out} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`        SHA-256 ${sha256}`);
  return out;
}

/* ------------------------------------------------------------------- main */

const tool = signTool();

if (has("--cert")) {
  makeCert(tool);
  process.exit(0);
}

stage();
sign(tool);
verify(tool);
assemble();
const out = zip();
/* Leave one file behind, not a folder of half-built pieces. */
rmSync(work, { recursive: true, force: true });

console.log(`
Done. One file to give people:

  ${out}

They unzip it and double-click "Install LazyMapLayers.bat" (Windows) or
"Install LazyMapLayers (macOS).command". No extension manager, no debug mode.
`);
