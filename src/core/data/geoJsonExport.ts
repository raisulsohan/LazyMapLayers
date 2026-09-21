// The other direction of the import: what is on a map in After Effects, back as GeoJSON. Pins and
// attached layers become points, routes lines, shape layers polygons, callouts points with their
// title, and highlighted areas polygons. The geography lives in the generated expressions (a route
// carries its own points), so it comes back from there.

export type ExportLayer = {
  kind: "pin" | "attached" | "route" | "feature" | "callout";
  name: string;
  /** Pins, attached layers and callouts: the place they sit on. */
  lat?: number | null;
  lng?: number | null;
  /** Routes and outlines: the path expressions, one per ring or line. */
  paths?: string[];
};

export type ExportArea = { name: string; polygons: number[][][][] };

/** The points baked into a generated path expression as [lat, lng, ...], or null when it is not ours. */
export function pointsFromExpression(code: string): number[][] | null {
  const marker = "var pts = ";
  const start = code.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const end = code.indexOf(";", from);
  if (end < 0) return null;
  try {
    const points = JSON.parse(code.slice(from, end)) as number[][];
    if (!Array.isArray(points) || points.length < 2) return null;
    return points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  } catch {
    return null;
  }
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const coordinates = (points: number[][]) => points.map((p) => [round(p[1]), round(p[0])]);

/** The title a callout layer holds, from its layer name ("Callout box: Paris"). */
const titleOf = (name: string) => {
  const at = name.indexOf(": ");
  return at < 0 ? name : name.slice(at + 2);
};

/**
 * A FeatureCollection of everything that could be read. Layers whose expressions were replaced by
 * hand carry no points any more and are counted as skipped.
 */
export function buildGeoJson(layers: ExportLayer[], areas: ExportArea[] = [], mapName = "LazyMapLayers"): { geojson: GeoJSON.FeatureCollection; skipped: number } {
  const features: GeoJSON.Feature[] = [];
  let skipped = 0;
  const seenCallouts = new Set<string>();
  for (const layer of layers) {
    if (layer.kind === "pin" || layer.kind === "attached" || layer.kind === "callout") {
      if (!Number.isFinite(layer.lat ?? NaN) || !Number.isFinite(layer.lng ?? NaN)) {
        skipped++;
        continue;
      }
      // A callout is three layers on one place: one point is enough.
      const name = layer.kind === "callout" ? titleOf(layer.name) : layer.name;
      const key = `${layer.kind}:${name}:${layer.lat},${layer.lng}`;
      if (layer.kind === "callout") {
        if (seenCallouts.has(key)) continue;
        seenCallouts.add(key);
      }
      features.push({
        type: "Feature",
        properties: { name, kind: layer.kind },
        geometry: { type: "Point", coordinates: [round(layer.lng as number), round(layer.lat as number)] }
      });
      continue;
    }
    const paths = (layer.paths ?? []).map(pointsFromExpression).filter((p): p is number[][] => !!p);
    if (!paths.length) {
      skipped++;
      continue;
    }
    if (layer.kind === "route") {
      const line = paths[0];
      features.push({
        type: "Feature",
        properties: { name: layer.name, kind: "route" },
        geometry: { type: "LineString", coordinates: coordinates(line) }
      });
      continue;
    }
    // An outline: every ring closes itself again, the largest one first.
    const rings = paths.map((ring) => {
      const closed = coordinates(ring);
      const first = closed[0];
      const last = closed[closed.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]]);
      return closed;
    });
    features.push({
      type: "Feature",
      properties: { name: layer.name, kind: "feature" },
      geometry: rings.length === 1 ? { type: "Polygon", coordinates: rings } : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) }
    });
  }
  for (const area of areas) {
    if (!area.polygons.length) continue;
    features.push({
      type: "Feature",
      properties: { name: area.name, kind: "highlight" },
      geometry: { type: "MultiPolygon", coordinates: area.polygons }
    });
  }
  return { geojson: { type: "FeatureCollection", features }, skipped };
}
