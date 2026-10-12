// A folder of {z}/{x}/{y} tiles on the user's computer as imagery of their own (D103): from what the
// panel lists of it, the picture format, the zooms, the area it covers, and whether its rows count
// from the south (gdal2tiles' TMS, which writes tilemapresource.xml beside the zoom folders).

import { latFromMercatorY, lngFromMercatorX } from "../geo/mercator.ts";

export type TileFolderLayout = {
  /** png, jpg, jpeg or webp, as the files are named. */
  ext: string;
  /** Rows counted from the south. */
  tms: boolean;
  minZoom: number;
  maxZoom: number;
  /** West, south, east, north in degrees: the tiles of the lowest zoom. */
  bounds: [number, number, number, number] | null;
  /** The tile path under the folder, with / between parts. */
  template: string;
};

/** The names of a folder that are zoom levels, lowest first. */
export const zoomFolders = (names: string[]): number[] => names.filter((name) => /^\d{1,2}$/.test(name)).map(Number).filter((z) => z <= 30).sort((a, b) => a - b);

const TILE = /^(\d+)\.(png|jpe?g|webp)$/i;

/**
 * The layout of a tile folder: `names` are the entries beside the zoom folders, `lowest` the column
 * folders of the lowest zoom with their file names.
 */
export function describeTileFolder(input: { names: string[]; lowest: { z: number; columns: { x: string; files: string[] }[] } | null }): { ok: true; layout: TileFolderLayout } | { ok: false; error: string } {
  const zooms = zoomFolders(input.names);
  if (!zooms.length || !input.lowest) return { ok: false, error: "the folder holds no zoom folders (0, 1, 2 …) of {z}/{x}/{y} tiles" };
  const tms = input.names.some((name) => name.toLowerCase() === "tilemapresource.xml");
  const z = input.lowest.z;
  const counts = new Map<string, number>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const n = 2 ** z;
  for (const column of input.lowest.columns) {
    if (!/^\d+$/.test(column.x)) continue;
    const x = Number(column.x);
    for (const file of column.files) {
      const match = TILE.exec(file);
      if (!match || x >= n) continue;
      const row = Number(match[1]);
      if (row >= n) continue;
      const y = tms ? n - 1 - row : row;
      const ext = match[2].toLowerCase();
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!counts.size) return { ok: false, error: `zoom folder ${z} holds no .png, .jpg or .webp tiles in column folders` };
  const ext = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bounds: [number, number, number, number] = [lngFromMercatorX(minX / n), latFromMercatorY((maxY + 1) / n), lngFromMercatorX((maxX + 1) / n), latFromMercatorY(minY / n)];
  return { ok: true, layout: { ext, tms, minZoom: zooms[0], maxZoom: zooms[zooms.length - 1], bounds, template: `{z}/{x}/${tms ? "{-y}" : "{y}"}.${ext}` } };
}

/** A tile's file from a folder template ({z}, {x}, and {y} or {-y}). */
export function folderTilePath(template: string, z: number, x: number, y: number): string {
  return template
    .split("{z}")
    .join(String(z))
    .split("{x}")
    .join(String(x))
    .split("{-y}")
    .join(String(2 ** z - 1 - y))
    .split("{y}")
    .join(String(y));
}
