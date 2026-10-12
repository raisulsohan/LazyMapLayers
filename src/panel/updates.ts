// A newer release, and a problem report. The update check is one request to GitHub's release list,
// once a day, sending nothing but the request itself; it can be turned off. The problem report is a
// text file the user reads and pastes himself: nothing leaves the computer on its own (D56). Since
// D104 it carries the Self-test report and goes to the clipboard as well, for the issue form to take.

import { withoutHome } from "../core/support/selfTest.ts";
import { isNewer } from "../core/version.ts";
import { fs, hostEnvironment, os, path, userDataDir } from "./cep.ts";
import { httpsGet } from "./net.ts";
import { readPrefs, writePrefs } from "./prefs.ts";

export const RELEASES_URL = "https://github.com/raisulsohan/LazyMapLayers/releases";
export const ISSUES_URL = "https://github.com/raisulsohan/LazyMapLayers/issues/new";
const LATEST_API = "https://api.github.com/repos/raisulsohan/LazyMapLayers/releases/latest";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export type Update = { version: string; url: string };

/** The newest release GitHub lists, or null when it cannot be asked. */
export async function fetchLatestRelease(current: string): Promise<Update | null> {
  try {
    const response = await httpsGet(LATEST_API, { accept: "application/vnd.github+json", "user-agent": `LazyMapLayers/${current} (After Effects extension)` });
    if (response.status !== 200) return null;
    const release = JSON.parse(Buffer.from(response.body).toString("utf8")) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean };
    if (!release || typeof release.tag_name !== "string" || release.draft || release.prerelease) return null;
    return { version: release.tag_name.replace(/^v/i, ""), url: typeof release.html_url === "string" ? release.html_url : RELEASES_URL };
  } catch {
    return null;
  }
}

/**
 * A newer version than the one running, if one is known: from today's check when it is due, else
 * from the last one. Null when there is none, when the user has said "later" to it, or when checking
 * is off.
 */
export async function newerVersion(current: string, now = Date.now()): Promise<Update | null> {
  const prefs = readPrefs();
  if (!prefs.updates) return null;
  const last = prefs.lastUpdateCheck ? Date.parse(prefs.lastUpdateCheck) : 0;
  let latest = prefs.latestKnown;
  if (!last || now - last >= CHECK_EVERY_MS) {
    const found = await fetchLatestRelease(current);
    if (found) latest = found;
    writePrefs({ lastUpdateCheck: new Date(now).toISOString(), latestKnown: latest });
  }
  if (!latest || !isNewer(latest.version, current) || latest.version === prefs.dismissedVersion) return null;
  return latest;
}

/** What a problem report holds (the Self-test report with it, when one has run), and where it is written. The home folder is written as ~. */
export function writeProblemReport(lines: string[], versions: string, selfTest?: string | null): { file: string; text: string } {
  const env = hostEnvironment();
  const tail = (file: string, count: number) => {
    try {
      const text = fs().readFileSync(file, "utf8");
      return text.split(/\r?\n/).filter(Boolean).slice(-count);
    } catch {
      return [];
    }
  };
  const panelLog = path().join(os().tmpdir(), "LazyMapLayers", "panel.log");
  const text = [
    "LazyMapLayers problem report",
    `Written: ${new Date().toISOString()}`,
    `Versions: ${versions}`,
    `Host: ${env.appName} ${env.appVersion} (${env.appLocale}), ${os().platform()} ${os().release()}`,
    "",
    "What I did, and what I expected:",
    "(write it here)",
    "",
    ...(selfTest ? selfTest.split("\n") : ["Self-test: not run (Maps > About > Self-test)"]),
    "",
    "The panel's last messages:",
    ...lines.slice(-40).map((line) => `  ${line}`),
    "",
    "The panel's log file (last lines):",
    ...tail(panelLog, 60).map((line) => `  ${line}`)
  ].join("\n");
  const safe = withoutHome(text, os().homedir());
  const file = path().join(userDataDir(), "problem-report.txt");
  fs().mkdirSync(userDataDir(), { recursive: true });
  fs().writeFileSync(file, safe, "utf8");
  return { file, text: safe };
}

/**
 * Puts text on the clipboard, for the issue form's report box. A hidden text area and the copy
 * command work in CEP's Chromium without asking for a permission; false when the copy was refused.
 */
export function copyText(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
