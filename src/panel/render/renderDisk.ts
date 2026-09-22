// What the renders take on disk, and which of them can go. Renders of a saved project live next to
// it; renders of an unsaved project live in the user data folder, and once that project is closed
// nothing can ever reach them again - the panel offers to remove those, and only those.

import { fs, path, userDataDir } from "../cep.ts";

export type RenderFolder = { name: string; mapId: string; folder: string; bytes: number; ofThisProject: boolean };

export type RenderDiskReport = {
  /** Folders in the user data folder (renders of unsaved projects). */
  loose: RenderFolder[];
  /** Folders next to the open project, when it is saved. */
  project: RenderFolder[];
  looseOldBytes: number;
  projectBytes: number;
};

export const looseRendersFolder = () => path().join(userDataDir(), "renders");

function folderBytes(folder: string): number {
  let total = 0;
  const walk = (dir: string) => {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];
    try {
      entries = fs().readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path().join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          total += fs().statSync(full).size;
        } catch {
          // A file that vanished while we counted.
        }
      }
    }
  };
  walk(folder);
  return total;
}

/** The map id a render folder was made for: the last word of its name. */
const mapIdOf = (name: string) => name.split(" ").pop() ?? name;

function listFolders(base: string, knownMapIds: Set<string>): RenderFolder[] {
  let names: string[] = [];
  try {
    names = fs()
      .readdirSync(base, { withFileTypes: true })
      .filter((entry: { isDirectory(): boolean }) => entry.isDirectory())
      .map((entry: { name: string }) => entry.name);
  } catch {
    return [];
  }
  return names.map((name) => {
    const folder = path().join(base, name);
    const mapId = mapIdOf(name);
    return { name, mapId, folder, bytes: folderBytes(folder), ofThisProject: knownMapIds.has(mapId) };
  });
}

/** What is on disk, sorted largest first. Walks every file, so it takes a moment on a big cache. */
export function renderDiskReport(knownMapIds: string[], projectFolder: string | null): RenderDiskReport {
  const known = new Set(knownMapIds);
  const loose = listFolders(looseRendersFolder(), known).sort((a, b) => b.bytes - a.bytes);
  const project = projectFolder ? listFolders(path().join(projectFolder, "LazyMapLayers Renders"), known).sort((a, b) => b.bytes - a.bytes) : [];
  return {
    loose,
    project,
    looseOldBytes: loose.filter((entry) => !entry.ofThisProject).reduce((total, entry) => total + entry.bytes, 0),
    projectBytes: project.reduce((total, entry) => total + entry.bytes, 0)
  };
}

/** Removes the renders of unsaved projects that are no longer open. Never touches a saved project's folder. */
export function removeOldLooseRenders(report: RenderDiskReport): { removed: number; bytes: number; failed: string[] } {
  let removed = 0;
  let bytes = 0;
  const failed: string[] = [];
  for (const entry of report.loose) {
    if (entry.ofThisProject) continue;
    try {
      fs().rmSync(entry.folder, { recursive: true, force: true });
      removed++;
      bytes += entry.bytes;
    } catch {
      failed.push(entry.name);
    }
  }
  return { removed, bytes, failed };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(bytes >= 10737418240 ? 0 : 1)} GB`;
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
