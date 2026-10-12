// WMS as imagery of the user's own (D103): what a GetCapabilities answer offers, and the GetMap
// address that asks for one Web Mercator tile at a time. MapLibre fills in `{bbox-epsg-3857}` with
// each tile's box in metres. The panel never reprojects: a layer not offered in Web Mercator cannot
// be picked.

import { childNamed, childrenNamed, childText, parseXml, pathOf, type XmlElement } from "../data/xml.ts";

/** Web Mercator under its own code and the older names servers still list it by. */
export const WEB_MERCATOR_CODES = ["EPSG:3857", "EPSG:900913", "EPSG:102100", "EPSG:102113", "EPSG:3785", "OSGEO:41001"];

/** The scale denominator of a 256-pixel tile at zoom 0 (OGC's 0.28 mm pixel, at the equator). */
export const SCALE_AT_ZOOM_0 = 559082264.0287178;

export const BBOX_TOKEN = "{bbox-epsg-3857}";

export type WmsLayer = {
  name: string;
  title: string;
  /** The Web Mercator code the layer is offered in, or null when it has none. */
  crs: string | null;
  /** West, south, east, north in degrees. */
  bounds: [number, number, number, number] | null;
  attribution: string;
  /** The scale denominators the layer is drawn between; null where there is no limit. */
  minScale: number | null;
  maxScale: number | null;
};

export type WmsCapabilities = {
  version: string;
  title: string;
  /** The service's AccessConstraints and Fees, as it states them. */
  access: string;
  fees: string;
  /** Where GetMap requests go, as the service states it. */
  getMap: string;
  formats: string[];
  /** The layers that can be asked for by name. */
  layers: WmsLayer[];
};

type Inherited = { crs: Set<string>; bounds: WmsLayer["bounds"]; attribution: string; minScale: number | null; maxScale: number | null };

const number = (text: string | undefined): number | null => {
  const value = text === undefined || text.trim() === "" ? NaN : Number(text);
  return Number.isFinite(value) ? value : null;
};

function boundsOf(layer: XmlElement): WmsLayer["bounds"] {
  const geo = childNamed(layer, "EX_GeographicBoundingBox");
  let box: (number | null)[] | null = null;
  if (geo) box = [number(childText(geo, "westBoundLongitude")), number(childText(geo, "southBoundLatitude")), number(childText(geo, "eastBoundLongitude")), number(childText(geo, "northBoundLatitude"))];
  const old = childNamed(layer, "LatLonBoundingBox");
  if (!box && old) box = [number(old.attrs.minx), number(old.attrs.miny), number(old.attrs.maxx), number(old.attrs.maxy)];
  if (!box || box.some((v) => v === null)) return null;
  const [w, s, e, n] = box as number[];
  if (!(w < e && s < n)) return null;
  return [Math.max(-180, w), Math.max(-90, s), Math.min(180, e), Math.min(90, n)];
}

function walk(layer: XmlElement, above: Inherited, out: WmsLayer[]): void {
  const crs = new Set(above.crs);
  for (const element of [...childrenNamed(layer, "CRS"), ...childrenNamed(layer, "SRS")]) for (const code of element.text.trim().split(/\s+/)) if (code) crs.add(code.toUpperCase());
  const hint = childNamed(layer, "ScaleHint");
  // WMS 1.1.1 gives the diagonal of a pixel on the ground in metres; 1.3.0 gives scale denominators.
  const fromHint = (value: string | undefined) => {
    const v = number(value);
    return v === null || v <= 0 ? null : v / Math.SQRT2 / 0.00028;
  };
  const here: Inherited = {
    crs,
    bounds: boundsOf(layer) ?? above.bounds,
    attribution: pathOf(layer, "Attribution", "Title")?.text.trim() || above.attribution,
    minScale: number(childText(layer, "MinScaleDenominator")) ?? (hint ? fromHint(hint.attrs.min) : null) ?? above.minScale,
    maxScale: number(childText(layer, "MaxScaleDenominator")) ?? (hint ? fromHint(hint.attrs.max) : null) ?? above.maxScale
  };
  const name = childText(layer, "Name");
  if (name) out.push({ name, title: childText(layer, "Title") || name, crs: WEB_MERCATOR_CODES.find((code) => crs.has(code)) ?? null, bounds: here.bounds, attribution: here.attribution, minScale: here.minScale, maxScale: here.maxScale });
  for (const child of childrenNamed(layer, "Layer")) walk(child, here, out);
}

/** What a GetCapabilities answer offers; an exception report or another document is an error. */
export function parseWmsCapabilities(text: string): { ok: true; value: WmsCapabilities } | { ok: false; error: string } {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    return { ok: false, error: `the answer is not a WMS capabilities document (${error instanceof Error ? error.message : String(error)})` };
  }
  if (/exception/i.test(root.name)) {
    const message = childrenNamed(root, "ServiceException").map((e) => e.text.trim()).filter(Boolean).join("; ") || childrenNamed(root, "Exception").map((e) => childText(e, "ExceptionText")).join("; ");
    return { ok: false, error: `the service answered with an error: ${message || root.name}` };
  }
  if (root.name !== "WMS_Capabilities" && root.name !== "WMT_MS_Capabilities") return { ok: false, error: root.name === "Capabilities" ? "this is a WMTS service: use its tile address with {z}/{x}/{y}" : `the answer is a ${root.name}, not WMS capabilities` };
  const service = childNamed(root, "Service");
  const capability = childNamed(root, "Capability");
  const getMap = pathOf(capability, "Request", "GetMap") ?? pathOf(capability, "Request", "Map");
  const online = pathOf(getMap, "DCPType", "HTTP", "Get", "OnlineResource");
  const layers: WmsLayer[] = [];
  for (const top of childrenNamed(capability, "Layer")) walk(top, { crs: new Set(), bounds: null, attribution: "", minScale: null, maxScale: null }, layers);
  return {
    ok: true,
    value: {
      version: root.attrs.version ?? (root.name === "WMS_Capabilities" ? "1.3.0" : "1.1.1"),
      title: childText(service, "Title"),
      access: childText(service, "AccessConstraints"),
      fees: childText(service, "Fees"),
      getMap: online?.attrs.href ?? "",
      formats: childrenNamed(getMap, "Format").map((f) => f.text.trim()).filter(Boolean),
      layers
    }
  };
}

const DROPPED = new Set(["service", "request", "version", "layers", "styles", "format", "transparent", "crs", "srs", "bbox", "width", "height", "exceptions"]);

/** The parameters of an address that are not WMS's own (a MapServer map=, a key), kept as they were. */
function keptParameters(url: URL): string[] {
  return [...url.searchParams].filter(([key]) => !DROPPED.has(key.toLowerCase())).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
}

/** The address that asks a WMS for what it offers. */
export function capabilitiesUrl(address: string): string {
  const url = new URL(address.trim());
  return `${url.origin}${url.pathname}?${[...keptParameters(url), "SERVICE=WMS", "REQUEST=GetCapabilities", "VERSION=1.3.0"].join("&")}`;
}

/**
 * Where GetMap requests go: the address the capabilities name, unless it points into the server's own
 * network (a common mistake of services behind a proxy), or drops https on the same host.
 */
export function getMapBase(advertised: string, address: string): string {
  if (!advertised.trim()) return address;
  try {
    const named = new URL(advertised.trim());
    const asked = new URL(address.trim());
    const internal = /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[::1\])/.test(named.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(named.hostname);
    if (internal && named.hostname !== asked.hostname) return address;
    if (named.hostname === asked.hostname && asked.protocol === "https:" && named.protocol === "http:") named.protocol = "https:";
    return named.toString();
  } catch {
    return address;
  }
}

/** PNG when offered (clear where the service has no picture), else JPEG, else the first picture format. */
export function defaultFormat(formats: string[]): string | null {
  const lower = formats.map((f) => f.toLowerCase());
  const pick = (test: (f: string) => boolean) => {
    const at = lower.findIndex(test);
    return at >= 0 ? formats[at] : null;
  };
  return pick((f) => f === "image/png") ?? pick((f) => f.startsWith("image/png")) ?? pick((f) => f === "image/jpeg" || f === "image/jpg") ?? pick((f) => f.startsWith("image/") && !f.includes("svg") && !f.includes("tif"));
}

const seeThrough = (format: string) => /png|gif|webp/i.test(format);

/** The GetMap template for one layer, a tile of `tileSize` pixels at a time. */
export function wmsTemplate(capabilities: Pick<WmsCapabilities, "version" | "getMap">, address: string, layer: Pick<WmsLayer, "name" | "crs">, format: string, tileSize: number): string {
  if (!layer.crs) throw new Error(`the layer ${layer.name} is not offered in Web Mercator`);
  const url = new URL(getMapBase(capabilities.getMap, address));
  const modern = capabilities.version.startsWith("1.3");
  const parameters = [
    ...keptParameters(url),
    "SERVICE=WMS",
    `VERSION=${modern ? "1.3.0" : capabilities.version || "1.1.1"}`,
    "REQUEST=GetMap",
    `LAYERS=${encodeURIComponent(layer.name)}`,
    "STYLES=",
    `FORMAT=${encodeURIComponent(format)}`,
    ...(seeThrough(format) ? ["TRANSPARENT=TRUE"] : []),
    `${modern ? "CRS" : "SRS"}=${layer.crs}`,
    `WIDTH=${tileSize}`,
    `HEIGHT=${tileSize}`,
    `BBOX=${BBOX_TOKEN}`
  ];
  return `${url.origin}${url.pathname}?${parameters.join("&")}`;
}

export const isWmsTemplate = (url: string): boolean => url.includes(BBOX_TOKEN);

/** What a GetMap template asks for: the address to ask for capabilities again, the layer and format. */
export function wmsTemplateInfo(template: string): { address: string; layer: string; format: string; version: string } | null {
  if (!isWmsTemplate(template)) return null;
  try {
    const url = new URL(template.replace(BBOX_TOKEN, "0,0,1,1"));
    const get = (key: string) => [...url.searchParams].find(([k]) => k.toLowerCase() === key)?.[1] ?? "";
    if (get("request").toLowerCase() !== "getmap") return null;
    const kept = keptParameters(url);
    return { address: `${url.origin}${url.pathname}${kept.length ? `?${kept.join("&")}` : ""}`, layer: get("layers"), format: get("format"), version: get("version") };
  } catch {
    return null;
  }
}

/** The template asking for tiles of another size. */
export const withTileSize = (template: string, tileSize: number): string => template.replace(/([?&](?:WIDTH|HEIGHT)=)\d+/gi, `$1${tileSize}`);

/** The tile zoom at which a tile of `tileSize` pixels is drawn at this scale denominator. */
export const zoomOfScale = (scale: number, tileSize = 256): number => Math.log2((SCALE_AT_ZOOM_0 * (256 / tileSize)) / scale);

/** The first and last zoom a layer's scale limits allow (null where it has none). */
export function wmsZooms(layer: Pick<WmsLayer, "minScale" | "maxScale">, tileSize = 256): { minZoom: number | null; maxZoom: number | null } {
  const clamp = (z: number) => Math.max(0, Math.min(24, z));
  // Drawn while the scale is under the largest denominator (zoomed in far enough) and at or over the smallest.
  const minZoom = layer.maxScale ? clamp(Math.ceil(zoomOfScale(layer.maxScale, tileSize) - 1e-6)) : null;
  const maxZoom = layer.minScale ? clamp(Math.floor(zoomOfScale(layer.minScale, tileSize) + 1e-6)) : null;
  if (minZoom !== null && maxZoom !== null && minZoom >= maxZoom) return { minZoom: null, maxZoom };
  return { minZoom: minZoom || null, maxZoom };
}
