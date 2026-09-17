// Minimal typing for the topojson packages (ISC), which ship without declarations. Only the data
// preparation tools use them.
type LmlTopology = { type: "Topology"; objects: Record<string, unknown>; arcs: number[][][] };

declare module "topojson-server" {
  export function topology(objects: Record<string, GeoJSON.FeatureCollection | GeoJSON.Feature>, quantization?: number): LmlTopology;
}

declare module "topojson-client" {
  export function feature(topology: LmlTopology, object: unknown): GeoJSON.FeatureCollection | GeoJSON.Feature;
}

declare module "topojson-simplify" {
  export function presimplify(topology: LmlTopology): LmlTopology;
  /** The weight below which the share 1 - p of the points falls: simplify() with it keeps the share p. */
  export function quantile(topology: LmlTopology, p: number): number;
  export function simplify(topology: LmlTopology, minWeight?: number): LmlTopology;
}
