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
import { fs, os, path } from "../cep.ts";

export class RenderStore {
  readonly root: string;
  private readonly known = new Set<string>();

  constructor(root: string) {
    this.root = root;
  }

  /** The store for a map: next to the saved project, or in the user's data folder. */
  static forMap(mapId: string, compName: string, projectFolder: string | null): RenderStore {
    const base = projectFolder
      ? path().join(projectFolder, "LazyMapLayers Renders")
      : path().join(process.env.APPDATA ?? path().join(os().homedir(), "AppData", "Roaming"), "LazyMapLayers", "renders");
    // Reuse the folder of this map even if its comp was renamed since.
    try {
      const existing = fs()
        .readdirSync(base)
        .find((name) => name === mapId || name.endsWith(` ${mapId}`));
      if (existing) return new RenderStore(path().join(base, existing));
    } catch {
      // No renders yet.
    }
    const safe = compName.replace(/[^A-Za-z0-9 _-]+/g, "_").trim() || "Map";
    return new RenderStore(path().join(base, `${safe} ${mapId}`));
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
      if ([...used].some((u) => u.startsWith(path().resolve(folder).toLowerCase()))) continue;
      nodeFs.rmSync(folder, { recursive: true, force: true });
      removed++;
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
