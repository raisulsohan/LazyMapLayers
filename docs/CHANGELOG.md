# Changelog

## Unreleased — Milestone A (world flight demo), in progress

- **Globe.** A **Globe** checkbox per map switches the preview and the renders to MapLibre's globe:
  a planet with an atmosphere and transparent space at low zoom, turning into the flat map by
  zoom 12.
- **Pins on the globe.** Pin expressions share one projection (Mercator and globe, with the
  transition) and hide pins behind the planet. With "Rotate with Map" on a globe, pins follow the
  local north.
- **Tests.** G1 (globe maths against MapLibre, CPU and rendered pixels) and G2 (globe pins in After
  Effects' own render).

## Unreleased — Phase 2 (frame renderer and passes), done

- **Render queue.** **Render preview** and **Render** add jobs to a queue with progress, Cancel and
  Resume. The queue is saved, so jobs cut off by closing After Effects come back with Resume.
- **Only changed frames render.** Every pass image has a content key. Held shots render once, an
  unchanged re-render finishes in under a second, and a keyframe change redraws exactly the frames
  it affects. A cancelled render resumes where it stopped.
- **Render settings per map** (⚙): supersampling off, 2×, 3× or 4× (filtered on the GPU), motion
  blur with 4 to 32 samples that follows the scene comp's shutter angle and phase, and passes.
- **Passes and mattes.** Land, Water, Boundaries, Roads and Buildings passes, plus Land and Water
  mattes, one footage item and one layer each, added switched off above the basemap. Ground
  passes are held out by 3D buildings.
- **Proxies.** A preview becomes the After Effects proxy of the final render and is switched on; the
  next final render switches it off, or removes it if the move changed.
- **Faster rendering.** Encoding runs in a pool of workers. A 10-second 4K move with 2×
  supersampling renders at 125 ms per frame.
- **Data credit.** Rendering an OpenStreetMap region adds a "© OpenStreetMap contributors" text
  layer to the scene once. It is not added again if you delete it.
- **Smoother city zooms.** 3D buildings fade in and rise between zoom 12 and 13 instead of popping
  in.
- **Tests.** R1 (15 checks inside After Effects) and R2 (the 4K acceptance move) with automatic pop
  detection. E1 now renders with supersampling.

## Phase 1 (camera rig and pins)

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
- **Matched 3D camera.** The **3D camera** button adds an After Effects camera rig that follows the
  map controls. 3D layers on its ground plane line up with the rendered map. Test C1: worst error
  0.004 px at 1080p and 4K, including a scaled map layer.
- **3D pins.** Alt+Shift+click drops a pin that lies flat on the map in 3D, with an Altitude (m)
  control. The 3D camera is added first if the map has none.
- **Tests.** P1 now also runs at 4K. E1 checks 3D pins in AE's own render as well (40/40).
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
