// What the renders take on disk, and which of them can go. Renders of a saved project live next to
// it; renders of an unsaved project live in the user data folder, and once that project is closed
// nothing can ever reach them again - the panel offers to remove those, and only those.
//
// A folder in the data folder is not always an orphan: a map rendered before its project was saved
// keeps its frames there, because the footage After Effects imported points at them. Those folders
// name their project (renderStore.claimFor), and a folder whose project file is still on disk is
// left alone however long it has been since it was open.

import { canRemoveRender } from "../../core/render/renderDiskRules.ts";
import { fs, path, userDataDir } from "../cep.ts";
import { PROJECT_MARKER } from "./renderStore.ts";

export type RenderFolder = {
  name: string;
  mapId: string;
  folder: string;
  bytes: number;
  /** A map of the project that is open now. */
  ofThisProject: boolean;
  /** The saved project these frames belong to, if they named one. */
  project: string | null;
  /** Nothing can reach these frames again, so they are the ones that may go. */
  orphan: boolean;
};

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

/** The saved project a render folder says it belongs to, and whether that project is still there. */
function claimOf(folder: string): { project: string | null; exists: boolean } {
  try {
    const named = fs().readFileSync(path().join(folder, PROJECT_MARKER), "utf8").trim();
    return named ? { project: named, exists: fs().existsSync(named) } : { project: null, exists: false };
  } catch {
    return { project: null, exists: false };
  }
}

/** Whether any file the project's footage shows lies inside this folder. */
const holdsAny = (folder: string, inUse: string[]) => {
  const root = path().resolve(folder).toLowerCase() + path().sep;
  return inUse.some((file) => path().resolve(file).toLowerCase().startsWith(root));
};

function listFolders(base: string, knownMapIds: Set<string>, inUse: string[]): RenderFolder[] {
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
    // A map of the open project, or frames its footage shows (a copied map shows its original's).
    const ofThisProject = knownMapIds.has(mapId) || holdsAny(folder, inUse);
    const claim = claimOf(folder);
    const orphan = canRemoveRender({ ofThisProject, claimedProject: claim.project, claimedProjectExists: claim.exists });
    return { name, mapId, folder, bytes: folderBytes(folder), ofThisProject, project: claim.exists ? claim.project : null, orphan };
  });
}

/** What is on disk, sorted largest first. Walks every file, so it takes a moment on a big cache. */
export function renderDiskReport(knownMapIds: string[], projectFolder: string | null, inUse: string[] = []): RenderDiskReport {
  const known = new Set(knownMapIds);
  const loose = listFolders(looseRendersFolder(), known, inUse).sort((a, b) => b.bytes - a.bytes);
  const project = projectFolder ? listFolders(path().join(projectFolder, "LazyMapLayers Renders"), known, inUse).sort((a, b) => b.bytes - a.bytes) : [];
  return {
    loose,
    project,
    looseOldBytes: loose.filter((entry) => entry.orphan).reduce((total, entry) => total + entry.bytes, 0),
    projectBytes: project.reduce((total, entry) => total + entry.bytes, 0)
  };
}

/**
 * Removes the renders that nothing can reach again: unsaved projects that are no longer open.
 * Never touches the open project's renders, nor any folder that names a project still on disk.
 */
export function removeOldLooseRenders(report: RenderDiskReport): { removed: number; bytes: number; failed: string[] } {
  let removed = 0;
  let bytes = 0;
  const failed: string[] = [];
  for (const entry of report.loose) {
    if (!entry.orphan) continue;
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
