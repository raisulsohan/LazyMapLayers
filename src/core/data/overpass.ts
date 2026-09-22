// OpenStreetMap features through the Overpass API: the query the panel sends, and the answer turned
// into GeoJSON so the ordinary import path can draw it. Rivers, lakes, parks, islands, airports,
// district boundaries, buildings - anything OSM holds, for the area the preview shows.
//
// The answer is asked for with "out geom", so ways and relation members carry their own points and
// nothing has to be resolved by id afterwards.

export type OsmKind = "any" | "water" | "green" | "island" | "airport" | "boundary" | "building" | "road" | "rail";

export type OsmKindInfo = { id: OsmKind; name: string; filters: string[] };

/** What each kind looks for. A feature matches when any one of its filters does. */
export const OSM_KINDS: OsmKindInfo[] = [
  { id: "any", name: "Anything named", filters: [""] },
  { id: "water", name: "Water", filters: ['["natural"="water"]', '["waterway"~"^(river|riverbank|stream|canal)$"]', '["landuse"="reservoir"]'] },
  { id: "green", name: "Parks and forest", filters: ['["leisure"~"^(park|garden|nature_reserve)$"]', '["natural"~"^(wood|scrub|heath|grassland)$"]', '["landuse"~"^(forest|meadow|grass)$"]'] },
  { id: "island", name: "Islands", filters: ['["place"~"^(island|islet|archipelago)$"]'] },
  { id: "airport", name: "Airports", filters: ['["aeroway"~"^(aerodrome|runway|terminal)$"]'] },
  { id: "boundary", name: "Boundaries", filters: ['["boundary"="administrative"]'] },
  { id: "building", name: "Buildings", filters: ['["building"]'] },
  { id: "road", name: "Roads", filters: ['["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]'] },
  { id: "rail", name: "Railways", filters: ['["railway"~"^(rail|subway|light_rail|tram)$"]'] }
];

export const osmKind = (id: OsmKind): OsmKindInfo => OSM_KINDS.find((kind) => kind.id === id) ?? OSM_KINDS[0];

/** South, west, north, east. */
export type OsmBbox = [number, number, number, number];

export type OverpassRequest = {
  /** Words the name must contain. Empty asks for the kind alone, which only a small area can carry. */
  text: string;
  kind: OsmKind;
  bbox: OsmBbox;
  /** Most features to return. */
  limit?: number;
  /** Seconds Overpass may spend on it. */
  timeout?: number;
};

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Anything that would end the name filter or turn into a wildcard is escaped. */
const escapeText = (text: string) => text.trim().replace(/[\\"^$.|?*+()[\]{}]/g, (character) => `\\${character}`);

export const bboxOf = (bbox: OsmBbox): string => bbox.map(round).join(",");

/** How wide the box is, in degrees of longitude and latitude: the panel refuses to ask about the whole planet. */
export const bboxSize = (bbox: OsmBbox): { width: number; height: number } => ({ width: Math.abs(bbox[3] - bbox[1]), height: Math.abs(bbox[2] - bbox[0]) });

/** The Overpass QL for a request. Names match anywhere in the name, in any language, ignoring case. */
export function overpassQuery(request: OverpassRequest): string {
  const limit = Math.max(1, Math.min(500, Math.round(request.limit ?? 120)));
  const timeout = Math.max(5, Math.min(90, Math.round(request.timeout ?? 25)));
  const text = escapeText(request.text);
  const name = text ? `["name"~"${text}",i]` : "";
  const area = bboxOf(request.bbox);
  const kind = osmKind(request.kind);
  const lines: string[] = [];
  for (const filter of kind.filters) {
    // Without a name and without a kind there is nothing to ask for.
    if (!filter && !name) continue;
    for (const type of ["node", "way", "relation"]) {
      // A road or a boundary is never a single node, and a nameless search would drag in every point.
      if (type === "node" && (!name || request.kind === "road" || request.kind === "rail" || request.kind === "boundary")) continue;
      lines.push(`  ${type}${filter}${name}(${area});`);
    }
  }
  if (!lines.length) throw new Error("type a name, or pick what to look for");
  return [`[out:json][timeout:${timeout}];`, "(", ...lines, ");", `out geom ${limit};`].join("\n");
}

type OsmPoint = { lat: number; lon: number };
type OsmTags = Record<string, string>;
type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: OsmTags;
  geometry?: OsmPoint[];
  members?: { type: string; role?: string; geometry?: OsmPoint[] }[];
};

export type OsmFeature = {
  id: string;
  name: string;
  /** What it is, in the words of the tags ("Lake", "River", "Park"). */
  kind: string;
  geometry: { type: "Point" | "LineString" | "Polygon" | "MultiPolygon"; coordinates: unknown };
  /** Points in the geometry, for the list the user picks from. */
  points: number;
};

/** Tags that mean the shape is an area even when nothing says so. */
const AREA_TAGS = ["building", "landuse", "leisure", "natural", "amenity", "boundary", "place", "area"];
const AREA_VALUES: Record<string, string[]> = { natural: ["water", "wood", "scrub", "heath", "grassland", "beach", "sand", "glacier", "bare_rock", "wetland"], waterway: ["riverbank", "dock"] };

function isArea(tags: OsmTags): boolean {
  if (tags.area === "no") return false;
  if (tags.area === "yes") return true;
  for (const [key, values] of Object.entries(AREA_VALUES)) if (tags[key] && values.includes(tags[key])) return true;
  return AREA_TAGS.some((key) => key !== "natural" && tags[key] && tags[key] !== "no");
}

/** The word for what a feature is, taken from the tags people actually use. */
export function kindOf(tags: OsmTags): string {
  const label = (value: string) => value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (tags.water) return label(tags.water);
  if (tags.natural) return label(tags.natural);
  if (tags.waterway) return label(tags.waterway);
  if (tags.leisure) return label(tags.leisure);
  if (tags.landuse) return label(tags.landuse);
  if (tags.place) return label(tags.place);
  if (tags.aeroway) return label(tags.aeroway);
  if (tags.highway) return label(tags.highway);
  if (tags.railway) return label(tags.railway);
  if (tags.boundary === "administrative") return tags.admin_level ? `Boundary level ${tags.admin_level}` : "Boundary";
  if (tags.building) return tags.building === "yes" ? "Building" : label(tags.building);
  if (tags.amenity) return label(tags.amenity);
  return "Feature";
}

const ring = (points: OsmPoint[]) => points.map((point) => [round(point.lon), round(point.lat)]);
const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/**
 * Closed rings out of the member ways of a relation, which arrive in no order and may each hold only
 * part of a ring. Parts that never close are kept as they are: half a coastline still draws.
 */
export function assembleRings(parts: number[][][]): number[][][] {
  const open = parts.filter((part) => part.length > 1).map((part) => part.slice());
  const rings: number[][][] = [];
  while (open.length) {
    let current = open.shift()!;
    let joined = true;
    while (joined && !same(current[0], current[current.length - 1])) {
      joined = false;
      for (let i = 0; i < open.length; i++) {
        const other = open[i];
        const end = current[current.length - 1];
        if (same(end, other[0])) current = current.concat(other.slice(1));
        else if (same(end, other[other.length - 1])) current = current.concat(other.slice(0, -1).reverse());
        else if (same(current[0], other[other.length - 1])) current = other.slice(0, -1).concat(current);
        else if (same(current[0], other[0])) current = other.slice(1).reverse().concat(current);
        else continue;
        open.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (current.length > 2) rings.push(current);
  }
  return rings;
}

/** Whether a point is inside a ring (even-odd), for putting holes in the right polygon. */
function inRing(x: number, y: number, points: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outer rings with their holes, as GeoJSON polygons. */
export function polygonsFrom(outer: number[][][], inner: number[][][]): number[][][][] {
  const polygons = outer.map((ring) => [ring]);
  for (const hole of inner) {
    const owner = polygons.find((polygon) => hole.length && inRing(hole[0][0], hole[0][1], polygon[0]));
    if (owner) owner.push(hole);
    else polygons.push([hole]);
  }
  return polygons;
}

const countPoints = (coordinates: unknown): number => (Array.isArray(coordinates) ? (typeof coordinates[0] === "number" ? 1 : coordinates.reduce((total: number, part) => total + countPoints(part), 0)) : 0);

/** The features of an Overpass answer, named and typed, largest first. */
export function osmFeatures(answer: unknown): OsmFeature[] {
  const elements = ((answer ?? {}) as { elements?: OsmElement[] }).elements ?? [];
  const features: OsmFeature[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name || tags["name:en"] || tags.ref || "";
    if (!name) continue;
    let geometry: OsmFeature["geometry"] | null = null;
    if (element.type === "node" && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
      geometry = { type: "Point", coordinates: [round(element.lon!), round(element.lat!)] };
    } else if (element.type === "way" && element.geometry) {
      const points = ring(element.geometry.filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon)));
      if (points.length > 2 && same(points[0], points[points.length - 1]) && isArea(tags)) geometry = { type: "Polygon", coordinates: [points] };
      else if (points.length > 1) geometry = { type: "LineString", coordinates: points };
    } else if (element.type === "relation" && element.members) {
      const usable = element.members.filter((member) => member.type === "way" && member.geometry && member.geometry.length > 1);
      const outer = assembleRings(usable.filter((member) => member.role !== "inner").map((member) => ring(member.geometry!)));
      const inner = assembleRings(usable.filter((member) => member.role === "inner").map((member) => ring(member.geometry!)));
      if (outer.length) geometry = { type: "MultiPolygon", coordinates: polygonsFrom(outer, inner) };
    }
    if (!geometry) continue;
    features.push({ id: `${element.type}/${element.id}`, name, kind: kindOf(tags), geometry, points: countPoints(geometry.coordinates) });
  }
  // The same thing often comes back as a way and as the relation that holds it: keep the richer one.
  const byName = new Map<string, OsmFeature>();
  for (const feature of features) {
    const key = `${feature.name}|${feature.geometry.type === "LineString" ? "line" : "area"}`;
    const kept = byName.get(key);
    if (!kept || feature.points > kept.points) byName.set(key, feature);
  }
  return [...byName.values()].sort((a, b) => b.points - a.points);
}

/** The features as a GeoJSON FeatureCollection, which the ordinary import path reads. */
export const osmGeoJson = (features: OsmFeature[]) => ({
  type: "FeatureCollection",
  features: features.map((feature) => ({ type: "Feature", properties: { name: feature.name, kind: feature.kind, osm: feature.id }, geometry: feature.geometry }))
});
