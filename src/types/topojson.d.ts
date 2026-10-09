// Minimal typing for the topojson packages (ISC), which ship without declarations. Only the data
// preparation tools use them.
type LmlTopology = { type: "Topology"; objects: Record<string, unknown>; arcs: number[][][] };

declare module "topojson-server" {
  export function topology(objects: Record<string, GeoJSON.FeatureCollection | GeoJSON.Feature>, quantization?: number): LmlTopology;
}

declare module "topojson-client" {
  export function feature(topology: LmlTopology, object: unknown): GeoJSON.FeatureCollection | GeoJSON.Feature;
  /** The arcs of an object as lines, each once; `filter(a, b)` picks arcs between shapes a and b (a === b on an outer edge). */
  /** For every geometry of the list, the indices of the geometries it shares an arc with. */
  export function neighbors(objects: unknown[]): number[][];
  export function mesh(topology: LmlTopology, object: unknown, filter?: (a: unknown, b: unknown) => boolean): GeoJSON.MultiLineString;
}

declare module "topojson-simplify" {
  export function presimplify(topology: LmlTopology): LmlTopology;
  /** The weight below which the share 1 - p of the points falls: simplify() with it keeps the share p. */
  export function quantile(topology: LmlTopology, p: number): number;
  export function simplify(topology: LmlTopology, minWeight?: number): LmlTopology;
}
