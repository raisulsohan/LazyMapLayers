// Version numbers, for telling a newer release from the one that is running.

/** "v0.3.1", "0.3.1" or "0.3.1-beta" as [0, 3, 1]; null when it is not a version at all. */
export function parseVersion(text: string): number[] | null {
  const match = /^\s*v?(\d+(?:\.\d+)*)/i.exec(text);
  if (!match) return null;
  return match[1].split(".").map((part) => Number(part));
}

/** Negative when a is older than b, zero when they are the same, positive when a is newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [];
  const right = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** True when `latest` is a version and newer than `current`. */
export const isNewer = (latest: string, current: string): boolean => parseVersion(latest) !== null && compareVersions(latest, current) > 0;
