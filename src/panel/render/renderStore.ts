// On-disk render store for one map.
//
//   <root>/cache/<pass>/<first two key digits>/<key>.png   one file per unique rendered image
//   <root>/<pass> <quality> <timestamp>/frame_00000.png    the sequence After Effects imports
//
// Sequence files are hard links to cache files (a copy when linking is not possible), so a sequence
// costs no extra disk space and is created in moments. Every render gets a fresh sequence folder,
// because After Effects caches footage frames by path. Cache files are written to a temporary name
// and renamed, so a cancelled or crashed render never leaves a half-written frame behind.

import type { PassId } from "../../core/render/passes.ts";
import type { RenderQuality } from "../../core/render/plan.ts";
import { sequenceFileName } from "../../core/render/plan.ts";
import { fs, path, userDataDir } from "../cep.ts";

/** The file inside a render folder naming the saved project the frames belong to. */
export const PROJECT_MARKER = "belongs to.txt";

export class RenderStore {
  readonly root: string;
  private readonly known = new Set<string>();

  constructor(root: string) {
    this.root = root;
  }

  /** The store for a map: next to the saved project, or in the user's data folder. */
  static forMap(mapId: string, compName: string, projectFolder: string | null): RenderStore {
    const loose = path().join(userDataDir(), "renders");
    const base = projectFolder ? path().join(projectFolder, "LazyMapLayers Renders") : loose;
    // Reuse the folder this map's renders are already in, even if its comp was renamed since, and
    // even if that is the data folder from before the project was saved: the footage After Effects
    // has imported points there, and moving the frames would break every one of those links.
    for (const where of base === loose ? [loose] : [base, loose]) {
      try {
        const existing = fs()
          .readdirSync(where)
          .find((name) => name === mapId || name.endsWith(` ${mapId}`));
        if (existing) return new RenderStore(path().join(where, existing));
      } catch {
        // No renders there yet.
      }
    }
    const safe = compName.replace(/[^A-Za-z0-9 _-]+/g, "_").trim() || "Map";
    return new RenderStore(path().join(base, `${safe} ${mapId}`));
  }

  /**
   * Writes down which saved project these frames belong to.
   *
   * Renders made before a project was saved stay in the data folder (forMap above), where the
   * housekeeping that clears "renders of projects that are gone" would otherwise find them and
   * delete footage a project on disk still uses.
   */
  claimFor(projectFile: string | null): void {
    if (!projectFile) return;
    try {
      fs().mkdirSync(this.root, { recursive: true });
      fs().writeFileSync(path().join(this.root, PROJECT_MARKER), projectFile, "utf8");
    } catch {
      // The marker is a courtesy; a render must not fail without it.
    }
  }

  cacheFile(pass: PassId, key: string): string {
    return path().join(this.root, "cache", pass, key.slice(0, 2), `${key}.png`);
  }

  has(pass: PassId, key: string): boolean {
    const file = this.cacheFile(pass, key);
    if (this.known.has(file)) return true;
    if (fs().existsSync(file)) {
      this.known.add(file);
      return true;
    }
    return false;
  }

  write(pass: PassId, key: string, png: Uint8Array): void {
    const file = this.cacheFile(pass, key);
    const nodeFs = fs();
    nodeFs.mkdirSync(path().dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    nodeFs.writeFileSync(temporary, png);
    nodeFs.renameSync(temporary, file);
    this.known.add(file);
  }

  /** Builds a sequence folder of links to cached frames. Returns the first frame's path. */
  createSequence(pass: PassId, quality: RenderQuality, frames: { frame: number; key: string }[]): { folder: string; firstFramePath: string; copied: number } {
    const nodeFs = fs();
    const folder = path().join(this.root, `${pass} ${quality} ${Date.now()}`);
    nodeFs.mkdirSync(folder, { recursive: true });
    let copied = 0;
    for (const { frame, key } of frames) {
      const target = path().join(folder, sequenceFileName(frame));
      const source = this.cacheFile(pass, key);
      try {
        nodeFs.linkSync(source, target);
      } catch {
        // Different volume, too many links to one file, or a file system without hard links.
        nodeFs.copyFileSync(source, target);
        copied++;
      }
    }
    return { folder, firstFramePath: path().join(folder, sequenceFileName(frames[0].frame)), copied };
  }

  /**
   * Deletes older sequence folders of a pass and quality, keeping the newest `keep` (so Undo in After
   * Effects still finds the previous footage) and any folder in `inUse`.
   */
  pruneSequences(pass: PassId, quality: RenderQuality, keep: number, inUse: string[]): number {
    const nodeFs = fs();
    const prefix = `${pass} ${quality} `;
    const used = new Set(inUse.map((p) => path().resolve(p).toLowerCase()));
    let removed = 0;
    let names: string[] = [];
    try {
      names = nodeFs.readdirSync(this.root).filter((n) => n.startsWith(prefix) && /^[0-9]+$/.test(n.slice(prefix.length)));
    } catch {
      return 0;
    }
    names.sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
    for (const name of names.slice(keep)) {
      const folder = path().join(this.root, name);
      // With the separator, so "base final 1" is not taken for "base final 10".
      const inside = path().resolve(folder).toLowerCase() + path().sep;
      if ([...used].some((u) => u.startsWith(inside))) continue;
      nodeFs.rmSync(folder, { recursive: true, force: true });
      removed++;
    }
    return removed;
  }

  /** Deletes the sequence folders and cached images of highlight passes the map no longer has (unless After Effects still uses them). */
  pruneStaleHighlights(current: readonly string[], inUse: string[]): number {
    const nodeFs = fs();
    const used = inUse.map((p) => path().resolve(p).toLowerCase());
    let removed = 0;
    const stale = (pass: string) => (pass === "highlight" || pass.startsWith("highlight-")) && !current.includes(pass);
    const remove = (folder: string) => {
      const resolved = path().resolve(folder).toLowerCase() + path().sep;
      if (used.some((u) => u.startsWith(resolved))) return;
      nodeFs.rmSync(folder, { recursive: true, force: true });
      removed++;
    };
    try {
      for (const name of nodeFs.readdirSync(this.root)) {
        const match = /^(highlight(?:-[A-Za-z0-9-]+)?) (?:final|preview) [0-9]+$/.exec(name);
        if (match && stale(match[1])) remove(path().join(this.root, name));
      }
      for (const name of nodeFs.readdirSync(path().join(this.root, "cache"))) {
        if (!stale(name)) continue;
        // Cached images are kept while a sequence of that pass is still in use (Undo may bring it back).
        if (nodeFs.readdirSync(this.root).some((n) => n.startsWith(`${name} `))) continue;
        remove(path().join(this.root, "cache", name));
        for (const file of [...this.known]) if (file.startsWith(path().join(this.root, "cache", name))) this.known.delete(file);
      }
    } catch {
      // Housekeeping only.
    }
    return removed;
  }

  /** Bytes used by the cache (sequence folders are links and add nothing). */
  cacheBytes(): number {
    let total = 0;
    const walk = (dir: string) => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = fs().readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path().join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else total += fs().statSync(full).size;
      }
    };
    walk(path().join(this.root, "cache"));
    return total;
  }
}
