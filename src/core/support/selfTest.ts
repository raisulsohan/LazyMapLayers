// The Self-test (D104): a short set of checks a user runs in their own After Effects, and the report a
// problem report carries. The panel gathers the facts (the host's answers, a rendered frame, the files
// on disk); everything that decides what those facts mean lives here, so it is tested without After
// Effects: where the pins must be, each check's verdict, what an install promises, the name of the
// system, and the report's text.

import { project, type View, type Viewport } from "../camera/camera.ts";
import { compareVersions } from "../version.ts";

export type CheckStatus = "pass" | "fail" | "warn" | "info";
export type CheckId = "host" | "render" | "mapComp" | "pin" | "offline";
export type SelfTestCheck = { id: CheckId; name: string; status: CheckStatus; detail: string };

/** The view, size and place the test uses: land and sea in one frame, tilted and turned so the 3D camera matters. */
export const SELF_TEST_VIEW: View = { center: { lat: 36, lng: -5.5 }, zoom: 4, bearing: 15, pitch: 40 };
export const SELF_TEST_SIZE: Viewport = { width: 640, height: 360 };
export const SELF_TEST_PIN = { lat: 37.39, lng: -5.98 };
/** After Effects 2024 is version 24; older ones lack what the panel needs (PLAN §5). */
export const MIN_AE_MAJOR = 24;
/** As P1 and C1 ask: a pin within half a pixel of the camera maths. */
export const PIN_TOLERANCE_PX = 0.5;
/** How far After Effects' own sample of the frame may be from the frame, per channel of 255. */
export const SAMPLE_TOLERANCE = 8;

const NAMES: Record<CheckId, string> = {
  host: "Host script",
  render: "One-frame render",
  mapComp: "Map comp in one undo step",
  pin: "Pins match the camera",
  offline: "Offline data"
};

const check = (id: CheckId, status: CheckStatus, detail: string): SelfTestCheck => ({ id, name: NAMES[id], status, detail });

/** "26.5x89" as 26; NaN when the text holds no number. */
export function aeMajor(appVersion: string): number {
  const match = /^\s*(\d+)/.exec(appVersion);
  return match ? Number(match[1]) : Number.NaN;
}

export type HostAnswer = { lml: string; appVersion: string; expressionEngine?: string | null };

/** The host script answers, is the panel's own version, and runs in After Effects 2024 or newer. */
export function checkHost(answer: HostAnswer | null, panelVersion: string, error?: string): SelfTestCheck {
  if (!answer) return check("host", "fail", `the host script did not answer${error ? `: ${error}` : ""}`);
  const major = aeMajor(answer.appVersion);
  const engine = answer.expressionEngine ? `, ${engineName(answer.expressionEngine)} expressions` : "";
  if (compareVersions(answer.lml, panelVersion) !== 0) {
    return check("host", "fail", `the host script is ${answer.lml}, the panel ${panelVersion}: install LazyMapLayers again and restart After Effects`);
  }
  if (!(major >= MIN_AE_MAJOR)) return check("host", "fail", `After Effects ${answer.appVersion}: LazyMapLayers needs 2024 (24.0) or newer`);
  return check("host", "pass", `LazyMapLayers ${answer.lml} in After Effects ${answer.appVersion}${engine}`);
}

/** After Effects' names for its two expression engines, as a person reads them. */
export function engineName(engine: string): string {
  if (/^javascript/i.test(engine)) return "JavaScript";
  if (/extendscript/i.test(engine)) return "Legacy ExtendScript";
  return engine;
}

export type RenderFacts = {
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  ms?: number;
  webgl2?: boolean;
  gpu?: string | null;
  /** Colours in the frame, counted up to a few; one colour means nothing was drawn. */
  colours?: number;
  file?: string;
};

/** The panel's renderer drew a frame of the expected size with more than one colour in it, and wrote it. */
export function checkRender(facts: RenderFacts): SelfTestCheck {
  if (facts.webgl2 === false) return check("render", "fail", "no WebGL 2 in this panel: update the graphics driver");
  if (!facts.ok) return check("render", "fail", facts.error ?? "the frame was not drawn");
  if (facts.width !== SELF_TEST_SIZE.width || facts.height !== SELF_TEST_SIZE.height) {
    return check("render", "fail", `the frame is ${facts.width}x${facts.height}, not ${SELF_TEST_SIZE.width}x${SELF_TEST_SIZE.height}`);
  }
  if (!facts.colours || facts.colours < 2) return check("render", "fail", "the frame is one flat colour: the map was not drawn");
  const gpu = facts.gpu ? ` on ${facts.gpu}` : "";
  return check("render", "pass", `${facts.width}x${facts.height} in ${Math.round(facts.ms ?? 0)} ms${gpu}`);
}

/** How many colours an RGBA picture holds, counting no further than `limit`. */
export function countColours(rgba: Uint8Array, limit = 16): number {
  const seen = new Set<number>();
  for (let p = 0; p < rgba.length && seen.size < limit; p += 4) seen.add(((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) >>> 0);
  return seen.size;
}

/**
 * A pixel whose neighbourhood is one colour, nearest the middle of the picture: where After Effects'
 * sample of the frame can be compared with the frame without an edge in the way. Null when there is none.
 */
export function flatSpot(rgba: Uint8Array, width: number, height: number, radius = 3): { x: number; y: number; rgb: [number, number, number] } | null {
  let best: { x: number; y: number; rgb: [number, number, number]; d: number } | null = null;
  const at = (x: number, y: number) => (y * width + x) * 4;
  for (let y = radius; y < height - radius; y += 2) {
    for (let x = radius; x < width - radius; x += 2) {
      const d = Math.hypot(x - width / 2, y - height / 2);
      if (best && d >= best.d) continue;
      const c = at(x, y);
      let flat = true;
      for (let dy = -radius; dy <= radius && flat; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const n = at(x + dx, y + dy);
          if (rgba[n] !== rgba[c] || rgba[n + 1] !== rgba[c + 1] || rgba[n + 2] !== rgba[c + 2]) {
            flat = false;
            break;
          }
        }
      }
      if (flat) best = { x, y, rgb: [rgba[c], rgba[c + 1], rgba[c + 2]], d };
    }
  }
  return best ? { x: best.x, y: best.y, rgb: best.rgb } : null;
}

export type MapCompFacts = {
  error?: string | null;
  /** What the host call made: the map comp's name, its controls and the imported frame's size. */
  made?: { mapCompName?: string; controls?: string[]; footage?: { width: number; height: number } | null } | null;
  /** Items the call made that are still in the project after it (should be none). */
  leftover?: string[];
  /** After Effects' own sample of the frame at `spot`, 0..1 per channel; null when it could not be read. */
  sample?: number[] | null;
  /** The project's working colour space ("" or missing: none), which may change a sampled colour. */
  workingSpace?: string | null;
  undoGroup?: string;
};

const CONTROLS = ["Latitude", "Longitude", "Zoom", "Bearing", "Pitch", "Globe"];

/** The map comp was made with its controls and the frame, After Effects drew the frame, and nothing was left behind. */
export function checkMapComp(facts: MapCompFacts, spot: { rgb: [number, number, number] } | null): SelfTestCheck {
  const left = facts.leftover ?? [];
  if (left.length) return check("mapComp", "fail", `${left.length} item(s) were left in the project: ${left.slice(0, 3).join(", ")}`);
  if (facts.error) return check("mapComp", "fail", facts.error);
  const made = facts.made;
  if (!made?.mapCompName) return check("mapComp", "fail", "no map comp was made");
  const controls = made.controls ?? [];
  const missing = CONTROLS.filter((name) => !controls.includes(name));
  if (missing.length) return check("mapComp", "fail", `the map layer lacks ${missing.join(", ")}`);
  if (!made.footage || made.footage.width !== SELF_TEST_SIZE.width || made.footage.height !== SELF_TEST_SIZE.height) {
    return check("mapComp", "fail", `the rendered frame did not import as ${SELF_TEST_SIZE.width}x${SELF_TEST_SIZE.height}${made.footage ? ` (${made.footage.width}x${made.footage.height})` : ""}`);
  }
  const removed = `made and removed in one undo step${facts.undoGroup ? ` ("${facts.undoGroup}")` : ""}`;
  if (!spot || !facts.sample) return check("mapComp", "warn", `${removed}; After Effects' own pixels were not compared`);
  const off = Math.max(...spot.rgb.map((value, i) => Math.abs(value - Math.round((facts.sample?.[i] ?? 0) * 255))));
  if (off > SAMPLE_TOLERANCE) {
    const managed = facts.workingSpace ? ` (the project's working colour space, ${facts.workingSpace}, may explain it)` : "";
    return check("mapComp", facts.workingSpace ? "warn" : "fail", `${removed}, but After Effects drew the frame ${off}/255 off its colours${managed}`);
  }
  return check("mapComp", "pass", `${removed}; After Effects drew the frame within ${off}/255`);
}

/** Where the test's pin must be in the frame: the camera maths in core, which the renderer matches (S2a). */
export function expectedPin(): { x: number; y: number } {
  const p = project(SELF_TEST_VIEW, SELF_TEST_SIZE, SELF_TEST_PIN);
  return { x: p.x, y: p.y };
}

export type PinFacts = { pin?: number[] | null; pin3d?: number[] | null; errors?: string[]; error?: string | null };

/** The pin's position and the 3D pin seen through After Effects' camera, against the camera maths. */
export function checkPins(facts: PinFacts): SelfTestCheck {
  const errors = facts.errors ?? [];
  if (errors.length) return check("pin", "fail", `expression errors: ${errors.slice(0, 2).join(" | ")}`);
  if (!facts.pin || !facts.pin3d) return check("pin", "fail", `the pins could not be read${facts.error ? `: ${facts.error}` : ""}`);
  const want = expectedPin();
  const flat = Math.hypot(facts.pin[0] - want.x, facts.pin[1] - want.y);
  const deep = Math.hypot(facts.pin3d[0] - want.x, facts.pin3d[1] - want.y);
  const worst = Math.max(flat, deep);
  if (!Number.isFinite(worst)) return check("pin", "fail", "the pins have no position");
  const detail = `pin ${flat.toFixed(3)} px, 3D pin through the camera ${deep.toFixed(3)} px from the camera maths`;
  return check("pin", worst <= PIN_TOLERANCE_PX ? "pass" : "fail", detail);
}

export type InstallKind = "full" | "light" | "online";

/** What an install copied, from `offline/pack.json` (null: there is none, an Online install). */
export function installKindOf(pack: unknown): InstallKind | null {
  if (pack === null || pack === undefined) return "online";
  if (typeof pack !== "object") return null;
  const record = pack as { kind?: unknown; world?: unknown };
  if (record.kind === "light") return "light";
  if (record.kind === undefined || record.kind === "full") return record.world ? "full" : null;
  return null;
}

/** The files, under the user data folder, that each kind of install puts there (D91, D101). */
export function promisedFiles(kind: InstallKind): string[] {
  if (kind === "online") return [];
  const light = ["offline/world.pmtiles", "offline/pack.json", "offline/CREDITS.txt", "terrain/world.pmtiles"];
  if (kind === "light") return light;
  return [...light, "imagery/blue-marble.pmtiles", "imagery/relief.pmtiles", "boundaries/manifest.json"];
}

export type FileState = "ok" | "missing" | "unreadable";

/** The first bytes of a PMTiles v3 archive: "PMTiles" and version 3. */
export function isPmtilesHead(head: Uint8Array): boolean {
  const magic = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73];
  return head.length >= 8 && magic.every((byte, i) => head[i] === byte) && head[7] === 3;
}

export type OfflineFacts = {
  pack: unknown;
  /** Each promised file's state, by its path under the user data folder. */
  files: Record<string, FileState>;
  naturalEarth: FileState;
  writable: boolean;
  worldMaxZoom?: number | null;
};

const KIND_NAMES: Record<InstallKind, string> = { full: "Full", light: "Light", online: "Online" };

/** The data the install promised is there and readable, the bundled world is too, and the data folder takes files. */
export function checkOffline(facts: OfflineFacts): SelfTestCheck {
  if (facts.naturalEarth !== "ok") return check("offline", "fail", `the world map inside the panel is ${facts.naturalEarth}: install LazyMapLayers again`);
  if (!facts.writable) return check("offline", "fail", "the LazyMapLayers data folder cannot be written to: renders and downloads will fail");
  const kind = installKindOf(facts.pack);
  if (!kind) return check("offline", "fail", "offline/pack.json cannot be read: run the installer again");
  const wrong = promisedFiles(kind).filter((file) => facts.files[file] !== "ok");
  if (wrong.length) return check("offline", "fail", `${KIND_NAMES[kind]} install, but ${wrong.map((file) => `${file} is ${facts.files[file] ?? "missing"}`).join(", ")}: run the installer again`);
  if (kind === "online") return check("offline", "pass", "Online install: the world to zoom 6 is in the panel, closer detail comes as maps need it");
  const zoom = facts.worldMaxZoom ? `, the world to zoom ${facts.worldMaxZoom}` : "";
  return check("offline", "pass", `${KIND_NAMES[kind]} install${zoom}: ${promisedFiles(kind).length} files found and readable`);
}

/** The system as a person names it: Darwin 24 is macOS 15, Windows build 22000 and later is Windows 11. */
export function systemName(platform: string, release: string, arch?: string): string {
  const cpu = arch ? `, ${arch}` : "";
  if (platform === "darwin") {
    const darwin = Number(/^(\d+)/.exec(release)?.[1]);
    // Darwin 20 to 24 are macOS 11 to 15; Darwin 25 is macOS 26, when Apple moved to the year's number.
    const macos = darwin >= 25 ? darwin + 1 : darwin >= 20 ? darwin - 9 : darwin >= 4 ? `10.${darwin - 4}` : null;
    return `${macos ? `macOS ${macos}` : "macOS"} (Darwin ${release}${cpu})`;
  }
  if (platform === "win32") {
    const build = Number(/^\d+\.\d+\.(\d+)/.exec(release)?.[1]);
    const name = build >= 22000 ? "Windows 11" : /^10\./.test(release) ? "Windows 10" : "Windows";
    return `${name} (${release}${cpu})`;
  }
  return `${platform} ${release}${cpu}`;
}

/** One line for the whole run: "PASS, 5 of 5", "FAIL: Pins match the camera (4 of 5 passed)". */
export function verdictLine(checks: SelfTestCheck[]): string {
  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  const passed = checks.filter((c) => c.status === "pass" || c.status === "info").length;
  if (failed.length) return `FAIL: ${failed.map((c) => c.name).join(", ")} (${passed} of ${checks.length} passed)`;
  if (warned.length) return `PASS with warnings: ${warned.map((c) => c.name).join(", ")} (${passed} of ${checks.length} passed)`;
  return `PASS, ${passed} of ${checks.length}`;
}

/** Every mention of the home folder written as "~", whichever way its slashes lean, so no user name is in a report. */
export function withoutHome(text: string, home: string): string {
  if (!home || home.length < 3) return text;
  const forms = new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
  let out = text;
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Windows paths are not case-sensitive, so neither is the match there; "/Users/ann" leaves "/Users/anna" alone.
    out = out.replace(new RegExp(`${escaped}(?![\\w.-])`, /^[A-Za-z]:/.test(form) ? "gi" : "g"), "~");
  }
  return out;
}

export type ReportFacts = {
  checks: SelfTestCheck[];
  written: string;
  panelVersion: string;
  ae?: string | null;
  system: string;
  cep?: string | null;
  gpu?: string | null;
  install?: string | null;
  seconds?: number;
};

/** The Self-test report as text: what a user pastes into an issue, and what the problem report carries. */
export function selfTestReport(facts: ReportFacts): string {
  const width = Math.max(...facts.checks.map((c) => c.name.length));
  const mark: Record<CheckStatus, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", info: "INFO" };
  return [
    "LazyMapLayers Self-test",
    `Result: ${verdictLine(facts.checks)}`,
    `Written: ${facts.written}${facts.seconds !== undefined ? ` (took ${facts.seconds.toFixed(1)} s)` : ""}`,
    `LazyMapLayers: ${facts.panelVersion}`,
    `After Effects: ${facts.ae ?? "unknown"}`,
    `System: ${facts.system}`,
    ...(facts.cep ? [`Panel engine: ${facts.cep}`] : []),
    ...(facts.gpu ? [`Graphics: ${facts.gpu}`] : []),
    ...(facts.install ? [`Install: ${facts.install}`] : []),
    "",
    ...facts.checks.map((c) => `  ${mark[c.status]}  ${c.name.padEnd(width)}  ${c.detail}`)
  ].join("\n");
}

/** The browser's engine from the panel's user agent: "Chromium 99.0.4844.84", or null. */
export function chromiumOf(userAgent: string): string | null {
  const match = /Chrome\/([\d.]+)/.exec(userAgent);
  return match ? `Chromium ${match[1]}` : null;
}
