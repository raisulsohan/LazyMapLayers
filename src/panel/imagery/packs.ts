// Optional imagery packs in the user's data folder ("imagery"): large whole-world rasters that are not
// part of the extension. See buildImagery.ts for how they are made.

import { fs, path, userDataDir } from "../cep.ts";

export type ImageryPack = "blue-marble" | "relief";

export const IMAGERY_INFO: Record<ImageryPack, { label: string; attribution: string }> = {
  "blue-marble": { label: "Satellite (NASA Blue Marble)", attribution: "NASA Earth Observatory (Blue Marble Next Generation)" },
  relief: { label: "Shaded relief (Natural Earth)", attribution: "Made with Natural Earth" }
};

export const imageryPath = (pack: ImageryPack) => path().join(userDataDir(), "imagery", `${pack}.pmtiles`);

export function hasImagery(pack: ImageryPack): boolean {
  try {
    return fs().existsSync(imageryPath(pack));
  } catch {
    return false;
  }
}
