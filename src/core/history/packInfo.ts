// The historical borders pack: one zip published with the project on GitHub (release "history-1"),
// built by tools/build-history-pack.ts from historical-basemaps at the commit below. The panel
// downloads it only when asked and refuses a file whose size or SHA-256 differs from these.
// A new build gets a new tag (history-2) and new constants; older panels keep working against theirs.

export const HISTORY_PACK = {
  tag: "history-1",
  /** The historical-basemaps commit the pack is built from. */
  commit: "da7a4b735ecef70aebdc9c73e409d8a2500d50f3",
  url: "https://github.com/raisulsohan/LazyMapLayers/releases/download/history-1/history-1.zip",
  bytes: 14611481,
  sha256: "c8821edf62b39149492c515a06c83875842ab17d6bab1e6b89ee5c92b4362429"
};
