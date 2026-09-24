// Imagery of the user's own: raster tiles from any XYZ address or PMTiles archive - a national
// orthophoto service, a satellite provider with the user's own key, tiles they rendered themselves.
// The panel bundles no such source (their terms are the user's business, and the panel says so);
// it draws whatever address the user gives, under the map's lines and above its land, in the
// preview and the render alike, and adds the attribution they typed to the map's credit line.

export const OWN_IMAGERY_SOURCE = "lml-own-imagery";
export const OWN_IMAGERY_LAYER = "own-imagery";

export type OwnImagery = {
  /** An https address with {z}, {x} and {y} (or {-y} for rows counted from the south), or one ending in .pmtiles. */
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
};

const XYZ = /^https?:\/\/\S+$/i;

/** The address a satellite area the panel built answers to: its archive, by name, in the user folder. */
export const SATELLITE_PREFIX = "satellite://";
export const satelliteAddress = (name: string) => `${SATELLITE_PREFIX}${name}`;
export const satelliteNameOf = (url: string): string | null => (url.startsWith(SATELLITE_PREFIX) ? url.slice(SATELLITE_PREFIX.length) : null);

/** Whether an address is one the panel can draw: an XYZ template, or a PMTiles archive on the web. */
export function isTileAddress(url: string): boolean {
  const text = url.trim();
  if (satelliteNameOf(text)) return true;
  if (!XYZ.test(text)) return false;
  if (/\.pmtiles(\?.*)?$/i.test(text)) return true;
  return text.includes("{z}") && text.includes("{x}") && (text.includes("{y}") || text.includes("{-y}"));
}

/** Whether the address counts tile rows from the south, as TMS services do. */
export const countsRowsFromSouth = (url: string): boolean => url.includes("{-y}") && !url.includes("{y}");

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
  return {
    url,
    attribution: typeof source.attribution === "string" ? source.attribution.trim().slice(0, 160) : "",
    opacity,
    tileSize: source.tileSize === 512 ? 512 : 256,
    minZoom: minZoom !== null && maxZoom !== null && minZoom >= maxZoom ? null : minZoom,
    maxZoom
  };
}

export type OwnImagerySource = { type: "raster"; tiles?: string[]; url?: string; tileSize: number; attribution: string; scheme?: "tms"; minzoom?: number; maxzoom?: number };

/** The style source for the address: a tile template, or the archive through the pmtiles protocol. */
export function ownImagerySource(setting: OwnImagery, resolve?: (name: string) => string | null): OwnImagerySource {
  const satellite = satelliteNameOf(setting.url);
  if (satellite) {
    const url = resolve?.(satellite);
    const source: OwnImagerySource = { type: "raster", url: url ?? "", tileSize: setting.tileSize, attribution: setting.attribution };
    if (setting.minZoom !== null) source.minzoom = setting.minZoom;
    if (setting.maxZoom !== null) source.maxzoom = setting.maxZoom;
    return source;
  }
  const pmtiles = /\.pmtiles(\?.*)?$/i.test(setting.url);
  const source: OwnImagerySource = pmtiles ? { type: "raster", url: `pmtiles://${setting.url}`, tileSize: setting.tileSize, attribution: setting.attribution } : { type: "raster", tiles: [setting.url.replace("{-y}", "{y}")], tileSize: setting.tileSize, attribution: setting.attribution };
  if (!pmtiles && countsRowsFromSouth(setting.url)) source.scheme = "tms";
  if (setting.minZoom !== null) source.minzoom = setting.minZoom;
  if (setting.maxZoom !== null) source.maxzoom = setting.maxZoom;
  return source;
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

/** What the sheet and the log say. */
export const describeOwnImagery = (setting: OwnImagery): string => {
  const satellite = satelliteNameOf(setting.url);
  if (satellite) return `the satellite area "${satellite}"${setting.attribution ? ` (${setting.attribution})` : ""} at ${Math.round(setting.opacity * 100)} %`;
  let host = setting.url;
  try {
    host = new URL(setting.url).host;
  } catch {
    // Not a URL the runtime can parse; the address itself will do.
  }
  return `tiles from ${host}${setting.attribution ? ` (${setting.attribution})` : ""} at ${Math.round(setting.opacity * 100)} %`;
};
