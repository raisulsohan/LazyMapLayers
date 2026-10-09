// The imagery packs: large whole-world rasters published with the project on GitHub ("Imagery packs"
// release). The panel downloads them when asked, and the offline data pack that ships with a release
// carries them (tools/build-offline-pack.ts); both check the size and the SHA-256 given here.

export type ImageryPack = "blue-marble" | "relief";

export const IMAGERY_RELEASE = "https://github.com/raisulsohan/LazyMapLayers/releases/download/imagery-1";

export const IMAGERY_INFO: Record<ImageryPack, { label: string; attribution: string; url: string; bytes: number; sha256: string }> = {
  "blue-marble": {
    label: "Satellite (NASA Blue Marble)",
    attribution: "NASA Earth Observatory (Blue Marble Next Generation)",
    url: `${IMAGERY_RELEASE}/blue-marble.pmtiles`,
    bytes: 21128534,
    sha256: "c5867d2b61997d16ea411ef959a7253cfbe997e5dfb518e9f4824c50eb2de60c"
  },
  relief: {
    label: "Shaded relief (Natural Earth)",
    attribution: "Made with Natural Earth",
    url: `${IMAGERY_RELEASE}/relief.pmtiles`,
    bytes: 49968984,
    sha256: "8c330b2700d325a624f6835661ee18909e4a918f688d9fe3e14aadcef2d88ca5"
  }
};
