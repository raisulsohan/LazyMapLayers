// Imagery of the user's own: raster tiles from any XYZ address or PMTiles archive - a national
// orthophoto service, a satellite provider with the user's own key, tiles they rendered themselves -
// and, since D103, a WMS layer, a folder of tiles or an MBTiles file on their computer. The panel
// bundles no such source (their terms are the user's business, and the panel says so); it draws
// whatever address the user gives, under the map's lines and above its land, in the preview and the
// render alike, and adds the attribution they typed to the map's credit line.

import { isWmsTemplate, wmsTemplate, wmsTemplateInfo, wmsZooms, withTileSize, type WmsCapabilities, type WmsLayer } from "../imagery/wms.ts";

export const OWN_IMAGERY_SOURCE = "lml-own-imagery";
export const OWN_IMAGERY_LAYER = "own-imagery";

export type OwnImagery = {
  /**
   * An https address with {z}, {x} and {y} (or {-y} for rows counted from the south), one ending in
   * .pmtiles, a WMS GetMap template with {bbox-epsg-3857}, a satellite area, or a path on this
   * computer: a folder template with {z}, {x} and {y}, or an .mbtiles file.
   */
  url: string;
  /** The credit the source asks for; it goes on the map's credit line and into the scene's credit layer. */
  attribution: string;
  /** 0 to 1. */
  opacity: number;
  /** The pixels a tile has along its edge (most XYZ services serve 256). */
  tileSize: 256 | 512;
  /** The first zoom the source has tiles for (nothing is asked below it); null leaves it to the source. */
  minZoom: number | null;
  /** The last zoom the source has tiles for (drawn enlarged beyond it); null leaves it to the source. */
  maxZoom: number | null;
  /** West, south, east, north in degrees: nothing is asked outside; null asks everywhere. */
  bounds?: [number, number, number, number] | null;
};

export type ImageryKind = "web" | "pmtiles" | "wms" | "satellite" | "folder" | "mbtiles";

const XYZ = /^https?:\/\/\S+$/i;

/** The address a satellite area the panel built answers to: its archive, by name, in the user folder. */
export const SATELLITE_PREFIX = "satellite://";
export const satelliteAddress = (name: string) => `${SATELLITE_PREFIX}${name}`;
export const satelliteNameOf = (url: string): string | null => (url.startsWith(SATELLITE_PREFIX) ? url.slice(SATELLITE_PREFIX.length) : null);

const hasTileTokens = (text: string) => text.includes("{z}") && text.includes("{x}") && (text.includes("{y}") || text.includes("{-y}"));

/** A path on this computer, as typed or as a file:// address (a drive, a share, or a POSIX root). */
export function localPathOf(text: string): string | null {
  let path = text.trim();
  if (/^file:\/\//i.test(path)) {
    try {
      path = decodeURIComponent(path.replace(/^file:\/\/(localhost)?/i, ""));
    } catch {
      return null;
    }
    if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  }
  if (/^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\/.test(path) || /^\/[^/]/.test(path)) return path;
  return null;
}

/** What kind of source an address is, or null for one the panel cannot draw. */
export function imageryKind(url: string): ImageryKind | null {
  const text = url.trim();
  if (satelliteNameOf(text)) return "satellite";
  if (XYZ.test(text)) {
    if (/\.pmtiles(\?.*)?$/i.test(text)) return "pmtiles";
    if (isWmsTemplate(text)) return "wms";
    return hasTileTokens(text) ? "web" : null;
  }
  const path = localPathOf(text);
  if (!path) return null;
  if (/\.mbtiles$/i.test(path)) return "mbtiles";
  return hasTileTokens(path) ? "folder" : null;
}

/** Whether an address is one the panel can draw. */
export const isTileAddress = (url: string): boolean => imageryKind(url) !== null;

/** Whether the address counts tile rows from the south, as TMS services do. */
export const countsRowsFromSouth = (url: string): boolean => url.includes("{-y}") && !url.includes("{y}");

function normaliseBounds(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [w, s, e, n] = [Math.max(-180, raw[0]), Math.max(-85.051129, raw[1]), Math.min(180, raw[2]), Math.min(85.051129, raw[3])];
  return w < e && s < n ? [w, s, e, n] : null;
}

/** What a map carries, repaired; null without a usable address. */
export function normaliseOwnImagery(raw: unknown): OwnImagery | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<OwnImagery>;
  const url = typeof source.url === "string" ? source.url.trim() : "";
  if (!isTileAddress(url)) return null;
  const opacity = typeof source.opacity === "number" && Number.isFinite(source.opacity) ? Math.max(0, Math.min(1, source.opacity)) : 1;
  const zoom = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(24, Math.round(value))) : null);
  const maxZoom = zoom(source.maxZoom);
  const minZoom = zoom(source.minZoom);
  const bounds = normaliseBounds(source.bounds);
  return {
    url,
    attribution: typeof source.attribution === "string" ? source.attribution.trim().slice(0, 160) : "",
    opacity,
    tileSize: source.tileSize === 512 ? 512 : 256,
    minZoom: minZoom !== null && maxZoom !== null && minZoom >= maxZoom ? null : minZoom,
    maxZoom,
    ...(bounds ? { bounds } : {})
  };
}

export type OwnImagerySource = { type: "raster"; tiles?: string[]; url?: string; tileSize: number; attribution: string; scheme?: "tms"; minzoom?: number; maxzoom?: number; bounds?: [number, number, number, number] };

/** The panel's ways to a source on this computer: a satellite area's archive, a folder's or file's tiles. */
export type LocalResolvers = {
  satellite?: (name: string) => string | null;
  /** A tile template MapLibre can ask (the panel's own protocol) for a folder template or an .mbtiles file. */
  local?: (path: string, kind: "folder" | "mbtiles") => string;
};

/** The style source for the address: a tile template, the archive through the pmtiles protocol, or the panel's own. */
export function ownImagerySource(setting: OwnImagery, resolve?: LocalResolvers | ((name: string) => string | null)): OwnImagerySource {
  const resolvers: LocalResolvers = typeof resolve === "function" ? { satellite: resolve } : resolve ?? {};
  const kind = imageryKind(setting.url);
  let source: OwnImagerySource;
  const base = { type: "raster" as const, tileSize: setting.tileSize, attribution: setting.attribution };
  if (kind === "satellite") source = { ...base, url: resolvers.satellite?.(satelliteNameOf(setting.url) as string) ?? "" };
  else if (kind === "pmtiles") source = { ...base, url: `pmtiles://${setting.url}` };
  else if (kind === "folder" || kind === "mbtiles") {
    const path = localPathOf(setting.url) as string;
    source = { ...base, tiles: [resolvers.local ? resolvers.local(path, kind) : ""] };
  } else if (kind === "wms") source = { ...base, tiles: [withTileSize(setting.url, setting.tileSize)] };
  else {
    source = { ...base, tiles: [setting.url.replace("{-y}", "{y}")] };
    if (countsRowsFromSouth(setting.url)) source.scheme = "tms";
  }
  if (setting.minZoom !== null) source.minzoom = setting.minZoom;
  if (setting.maxZoom !== null) source.maxzoom = setting.maxZoom;
  if (setting.bounds) source.bounds = setting.bounds;
  return source;
}

/** The setting one layer of a WMS becomes: its GetMap template, credit, zooms and bounds (D103). */
export function ownImageryFromWms(capabilities: Pick<WmsCapabilities, "version" | "getMap">, address: string, layer: WmsLayer, format: string, tileSize: 256 | 512, opacity = 1): OwnImagery | null {
  return normaliseOwnImagery({ url: wmsTemplate(capabilities, address, layer, format, tileSize), attribution: layer.attribution, opacity, tileSize, ...wmsZooms(layer, tileSize), bounds: layer.bounds });
}

/** The style layer: part of the imagery group, so it is in the base, land and water passes and never in a matte. */
export function ownImageryLayer(setting: OwnImagery): { id: string; type: "raster"; metadata: Record<string, unknown>; source: string; paint: Record<string, unknown> } {
  return {
    id: OWN_IMAGERY_LAYER,
    type: "raster",
    metadata: { "lml:group": "imagery" },
    source: OWN_IMAGERY_SOURCE,
    // No cross-fade between tile levels: frames must not depend on what was drawn before.
    paint: { "raster-opacity": setting.opacity, "raster-fade-duration": 0, "raster-resampling": "linear" }
  };
}

/** The last part of a path (a folder template's folder, a file's name). */
const lastPart = (path: string) => {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const tokens = parts.findIndex((part) => part.includes("{z}"));
  return (tokens > 0 ? parts[tokens - 1] : parts[parts.length - 1]) ?? path;
};

/** What the sheet and the log say. */
export const describeOwnImagery = (setting: OwnImagery): string => {
  const credit = setting.attribution ? ` (${setting.attribution})` : "";
  const opacity = ` at ${Math.round(setting.opacity * 100)} %`;
  const kind = imageryKind(setting.url);
  if (kind === "satellite") return `the satellite area "${satelliteNameOf(setting.url)}"${credit}${opacity}`;
  if (kind === "folder") return `tiles from the folder "${lastPart(localPathOf(setting.url) as string)}"${credit}${opacity}`;
  if (kind === "mbtiles") return `the MBTiles file "${lastPart(localPathOf(setting.url) as string)}"${credit}${opacity}`;
  let host = setting.url;
  try {
    host = new URL(setting.url.replace("{bbox-epsg-3857}", "0,0,1,1")).host;
  } catch {
    // Not a URL the runtime can parse; the address itself will do.
  }
  if (kind === "wms") return `the WMS layer "${wmsTemplateInfo(setting.url)?.layer ?? "?"}" from ${host}${credit}${opacity}`;
  return `tiles from ${host}${credit}${opacity}`;
};
