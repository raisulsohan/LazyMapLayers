# Changelog

## Unreleased — Phase 1 (camera rig and pins), in progress

- **Pinned layers.** `addPin` creates a marker shape layer linked to a map through a Layer
  Control effect, with these effects: Latitude, Longitude, Scale with Map, Rotate with Map,
  Reference Zoom.
- **Pin expressions.** Generated from core maths. They follow the animated camera, pitch and
  bearing, and the map layer's own transform. They survive renames, and a pin behind the camera is
  hidden.
- **Street-level precision.** Exact double coordinates in the expressions work around float32
  slider precision.
- **In-AE alignment test P1.** Worst error 0.006 px across 112 comparisons.
- **Render map.** Samples the camera for every frame, renders the basemap (world or a downloaded
  OpenStreetMap region) into a PNG sequence, and imports or swaps it into the map comp as a locked,
  tagged layer. A new folder is used per render, so After Effects never shows cached frames.
- **PNG decoder** for all filter types.
- **End-to-end test E1.** AE's own rendered frames show every pin centred on the renderer's marker
  (20/20).
- **Usable panel UI.**
  - Map picker and **New map**.
  - Basemap picker (world or downloaded regions), stored per map.
  - Region download with a size check before downloading.
  - Alt+click to drop pins.
  - **Keyframe view** and **Match AE**.
  - **Render preview** (half resolution) and **Render**, with progress.
- **UI test U1** drives the real panel through DevTools and saves screenshots.
- **Safer region downloads.**
  - The detail picker shows a tile estimate for every zoom (10 to 15) and starts at the most
    detail that stays city-sized.
  - An existing region name warns, and the button becomes **Replace existing region**.
  - Downloads over 200 MB show a warning. Downloads over 2 GB are blocked, with advice to zoom in or
    pick less detail.
  - The name is shown as the file will be saved ("New York" becomes "new-york").
- **Preview hint** moved to the top right, so it no longer hides the attribution button.
- **Fixed.** Views are read at the scene comp's time.

## Phase 0 (foundation and spikes)

- **Project scaffold.**
  - CEP manifest for AE 24+.
  - esbuild panel bundle with MapLibre GL JS 6.10 and its worker loaded from a blob.
  - Concatenated ES3 host script.
  - Dev install through a junction.
- **Core maths** (pure TypeScript, run directly by Node 24):
  - Web Mercator helpers.
  - A closed-form, MapLibre-compatible perspective camera (project, unproject, horizon).
  - The van Wijk–Nuij smooth zoom-and-pan fly path.
- **PMTiles v3 writer**, with tile de-duplication, run-length entries and leaf directories. It is
  verified against the official `pmtiles` reader.
- **PNG encoder** for rendered frames, plus WebGL read-back conversion (flip and unpremultiply).
- **Offline world basemap** built from Natural Earth: z0–6, 10 layers, and country names in 26
  languages.
- **Panel.**
  - An offline preview map.
  - "Create map comp", which makes a tagged precomp with Latitude, Longitude, Zoom, Bearing and
    Pitch controls.
  - "Keyframe view".
  - A spike runner.
- **Host.**
  - A JSON implementation that keeps its output ASCII.
  - `LML.call` with structured errors.
  - Undo groups on every action.
  - `LML:` tags that preserve the user's own comments.
- **Tooling.**
  - `npm run verify` (unit tests, typecheck, build, ES3 host checks).
  - `npm run ae:spikes` runs S1, S2a, S3, S5 and S6 inside the real After Effects.
