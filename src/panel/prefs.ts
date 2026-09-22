// The panel's own preferences, kept in the user data folder (settings that belong to the person, not
// to a map): whether new versions are looked for, and what was last seen.

import { fs, isInCep, path, userDataDir } from "./cep.ts";

export type Prefs = {
  /** Look for a newer release on GitHub once a day (one request, nothing sent). */
  updates: boolean;
  /** When the release list was last asked, as an ISO time. */
  lastUpdateCheck: string | null;
  /** The newest version the check has seen, and where it is. */
  latestKnown: { version: string; url: string } | null;
  /** A version the user chose not to hear about again. */
  dismissedVersion: string | null;
};

export const DEFAULT_PREFS: Prefs = { updates: true, lastUpdateCheck: null, latestKnown: null, dismissedVersion: null };

const file = () => path().join(userDataDir(), "settings.json");

let cached: Prefs | null = null;

/** What a file holds, repaired. */
export function normalisePrefs(raw: unknown): Prefs {
  const source = (raw ?? {}) as Partial<Prefs>;
  const known = source.latestKnown && typeof source.latestKnown === "object" && typeof source.latestKnown.version === "string" && typeof source.latestKnown.url === "string" ? { version: source.latestKnown.version, url: source.latestKnown.url } : null;
  return {
    updates: source.updates !== false,
    lastUpdateCheck: typeof source.lastUpdateCheck === "string" ? source.lastUpdateCheck : null,
    latestKnown: known,
    dismissedVersion: typeof source.dismissedVersion === "string" ? source.dismissedVersion : null
  };
}

export function readPrefs(): Prefs {
  if (cached) return cached;
  let raw: unknown = null;
  if (isInCep()) {
    try {
      raw = JSON.parse(fs().readFileSync(file(), "utf8"));
    } catch {
      raw = null;
    }
  }
  cached = normalisePrefs(raw);
  return cached;
}

export function writePrefs(next: Partial<Prefs>): Prefs {
  cached = { ...readPrefs(), ...next };
  if (isInCep()) {
    try {
      fs().mkdirSync(userDataDir(), { recursive: true });
      fs().writeFileSync(file(), JSON.stringify(cached, null, 2), "utf8");
    } catch {
      // A preference that cannot be written is still held for this session.
    }
  }
  return cached;
}
