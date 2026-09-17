// Minimal typing for shpjs (MIT), which ships without declarations.
declare module "shpjs" {
  type FeatureCollection = GeoJSON.FeatureCollection & { fileName?: string };
  export default function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>;
}
