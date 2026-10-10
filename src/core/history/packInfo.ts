// The historical borders pack: one zip published with the project on GitHub (release "history-3"),
// built by tools/build-history-pack.ts from historical-basemaps at the commit below. The panel
// downloads it only when asked and refuses a file whose size or SHA-256 differs from these.
// A new build gets a new tag (history-4) and new constants; older panels keep working against theirs.
// history-1 (2026-10-09) spelled the United Kingdom two ways in some years; history-2 has one name per
// power (data/history/corrections.json "rulers"); history-3 splits Vietnam and Yemen in 1960 and 1971.

export const HISTORY_PACK = {
  tag: "history-3",
  /** The historical-basemaps commit the pack is built from. */
  commit: "da7a4b735ecef70aebdc9c73e409d8a2500d50f3",
  url: "https://github.com/raisulsohan/LazyMapLayers/releases/download/history-3/history-3.zip",
  bytes: 14614476,
  sha256: "1f206e658d72bf8bd27663f14a05510552e8aa05553fd5caa1d95dc2f89a05b2"
};
