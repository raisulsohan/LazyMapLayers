// Minimal typing for shpjs (MIT), which ships without declarations.
declare module "shpjs" {
  type FeatureCollection = GeoJSON.FeatureCollection & { fileName?: string };
  type Bytes = ArrayBuffer | ArrayBufferView;
  export default function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>;
  /** Geometries of a .shp file, reprojected to WGS84 when the text of its .prj is given. */
  export function parseShp(shp: Bytes, prj?: string): GeoJSON.Geometry[];
  /** Attribute rows of a .dbf file; `cpg` names its text encoding. */
  export function parseDbf(dbf: Bytes, cpg?: Bytes | string): Record<string, unknown>[];
  export function combine(parts: [GeoJSON.Geometry[], Record<string, unknown>[] | undefined]): FeatureCollection;
}
