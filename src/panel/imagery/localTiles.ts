// Imagery of the user's own from their computer (D103): a folder of {z}/{x}/{y} tiles or an MBTiles
// file, drawn through lmllocal:// in the preview and the render alike. Core works out the folder's
// layout and reads the MBTiles file; this module lists folders, reads bytes with Node and hands
// MapLibre the tiles. A tile the source does not have is drawn transparent.

import * as maplibregl from "maplibre-gl";
import { tileSizeOf } from "../../core/image/imageSize.ts";
import { describeTileFolder, folderTilePath, zoomFolders } from "../../core/imagery/tileFolder.ts";
import { imageryKind, localPathOf, type OwnImagery } from "../../core/style/ownImagery.ts";
import { Mbtiles } from "../../core/tiles/mbtiles.ts";
import { fs, path } from "../cep.ts";

export const LOCAL_PROTOCOL = "lmllocal";

type Source = { kind: "folder"; template: string } | { kind: "mbtiles"; file: string; opened: { stamp: string; reader: Promise<Mbtiles>; close: () => void } | null };

const sources = new Map<string, Source>();
const complaints = new Set<string>();

/** A short, stable key for a path (FNV-1a), so the tile address does not carry the path itself. */
function keyOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The file's size and time: a changed file is opened again, and a render drawn from it is drawn again. */
export function localStamp(url: string): string {
  const local = localPathOf(url);
  if (!local) return "";
  const kind = imageryKind(url);
  const target = kind === "folder" ? folderRoot(local) : local;
  try {
    const stat = fs().statSync(target);
    // A folder's own time changes when a zoom folder comes or goes; its zoom folders' when columns do.
    if (kind === "folder") return [stat.mtimeMs, ...zoomFolders(fs().readdirSync(target)).map((z) => fs().statSync(path().join(target, String(z))).mtimeMs)].map(Math.round).join(":");
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

/** The folder a folder template starts from (the part before {z}). */
export function folderRoot(template: string): string {
  const at = template.indexOf("{z}");
  return (at < 0 ? template : template.slice(0, at)).replace(/[\\/]+$/, "");
}

/** The file opened for reading; the handle stays open while the panel draws from it. */
function openMbtiles(file: string): { reader: Promise<Mbtiles>; close: () => void } {
  const handle = fs().openSync(file, "r");
  let open = true;
  const close = () => {
    if (open) fs().closeSync(handle);
    open = false;
  };
  const reader = Mbtiles.open(async (offset, length) => {
    const buffer = Buffer.alloc(length);
    const read = fs().readSync(handle, buffer, 0, length, offset);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, read);
  });
  reader.catch(close);
  return { reader, close };
}

async function readTile(key: string, z: number, x: number, y: number): Promise<Uint8Array> {
  const source = sources.get(key);
  if (!source) return new Uint8Array(0);
  try {
    if (source.kind === "folder") return new Uint8Array(fs().readFileSync(folderTilePath(source.template, z, x, y)));
    const stamp = localStamp(source.file);
    if (!source.opened || source.opened.stamp !== stamp) {
      source.opened?.close();
      source.opened = { stamp, ...openMbtiles(source.file) };
    }
    const tile = await (await source.opened.reader).tile(z, x, y);
    return tile ? new Uint8Array(tile) : new Uint8Array(0);
  } catch (error) {
    const missing = (error as { code?: string }).code === "ENOENT";
    if (!missing && !complaints.has(key)) {
      complaints.add(key);
      console.warn(`LazyMapLayers: imagery from ${source.kind === "folder" ? source.template : source.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return new Uint8Array(0);
  }
}

let protocolReady = false;

/** The tile template MapLibre asks for a folder template or an .mbtiles file (registered once). */
export function localTileUrl(localPath: string, kind: "folder" | "mbtiles"): string {
  if (!protocolReady) {
    protocolReady = true;
    maplibregl.addProtocol(LOCAL_PROTOCOL, async (params) => {
      const match = /^lmllocal:\/\/([a-z0-9]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      if (!match) throw new Error(`not a local tile: ${params.url}`);
      return { data: await readTile(match[1], Number(match[2]), Number(match[3]), Number(match[4])) };
    });
  }
  const key = keyOf(`${kind}:${localPath}`);
  if (!sources.has(key)) sources.set(key, kind === "folder" ? { kind, template: localPath } : { kind, file: localPath, opened: null });
  return `${LOCAL_PROTOCOL}://${key}/{z}/{x}/{y}`;
}

/** The setting a folder of tiles becomes: its template, zooms and bounds. Throws with the reason. */
export function inspectTileFolder(folderOrTemplate: string): Pick<OwnImagery, "url" | "minZoom" | "maxZoom" | "bounds" | "tileSize"> {
  const root = folderRoot(folderOrTemplate);
  let names: string[];
  try {
    if (!fs().statSync(root).isDirectory()) throw new Error("not a folder");
    names = fs().readdirSync(root);
  } catch {
    throw new Error(`there is no folder ${root} on this computer`);
  }
  const zooms = zoomFolders(names);
  const lowest = zooms.length ? zooms[0] : null;
  const columns = lowest === null ? [] : fs().readdirSync(path().join(root, String(lowest))).map((x) => {
    try {
      return { x, files: fs().readdirSync(path().join(root, String(lowest), x)) };
    } catch {
      return { x, files: [] };
    }
  });
  const described = describeTileFolder({ names, lowest: lowest === null ? null : { z: lowest, columns } });
  if (!described.ok) throw new Error(`${root}: ${described.error}`);
  const { layout } = described;
  // A template the user typed keeps its own rows ({y} or {-y}); a folder gets the layout's.
  const template = folderOrTemplate.includes("{z}") ? folderOrTemplate : path().join(root, ...layout.template.split("/"));
  // One tile tells whether they are 256 or 512 pixels wide.
  const column = columns.find((c) => c.files.some((file) => file.toLowerCase().endsWith(`.${layout.ext}`)));
  const file = column?.files.find((name) => name.toLowerCase().endsWith(`.${layout.ext}`));
  let sample: Uint8Array | null = null;
  try {
    if (column && file) sample = new Uint8Array(fs().readFileSync(path().join(root, String(lowest), column.x, file)));
  } catch {
    sample = null;
  }
  return { url: template, minZoom: layout.minZoom || null, maxZoom: layout.maxZoom, bounds: layout.bounds, tileSize: tileSizeOf(sample) };
}

/** The setting an MBTiles file becomes, with its credit; throws with the reason it cannot be drawn. */
export async function inspectMbtiles(file: string): Promise<{ setting: Pick<OwnImagery, "url" | "attribution" | "minZoom" | "maxZoom" | "bounds" | "tileSize">; name: string; format: string | null; indexed: boolean }> {
  if (!fs().existsSync(file)) throw new Error(`there is no file ${file} on this computer`);
  try {
    if (fs().statSync(`${file}-wal`).size > 0) throw new Error(`${path().basename(file)} is still being written (its -wal file is not empty): close the program writing it, then pick it again`);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  const opened = openMbtiles(file);
  let info: Mbtiles["info"];
  let sample: Uint8Array | null;
  try {
    const mb = await opened.reader;
    info = mb.info;
    sample = await mb.sample();
  } finally {
    opened.close();
  }
  if (!sample) throw new Error(`${path().basename(file)} holds no tiles`);
  if (info.format === "pbf" || info.format === "mvt") throw new Error(`${path().basename(file)} holds vector tiles; imagery needs pictures (png, jpg or webp)`);
  return {
    setting: { url: file, attribution: info.attribution, minZoom: info.minZoom || null, maxZoom: info.maxZoom, bounds: info.bounds, tileSize: tileSizeOf(sample) },
    name: info.name,
    format: info.format,
    indexed: info.indexed
  };
}
