# LazyMapLayers — Product and Build Plan

LazyMapLayers is a free, open-source (MIT) map design and map animation extension for Adobe After
Effects. Part of Raisul Sohan's Lazy suite. It is a free alternative to paid map plugins such as
GEOlayers 3, and it aims to make every final output better than theirs.

Everything here is written from scratch. We learn from how existing tools behave for their users,
never from their code.

Status board: see the end of this file.

---

## 1. Ground rules

- **Free forever.** No accounts, keys, trials, licensing, or telemetry. Every data source we ship or
  call must allow free commercial use with attribution. Anything else is "bring your own source".
- **Better output, not only parity.** Each feature ships with a measurable quality bar (section 4).
- **Undo always works.** Every action is one undo group. We never purge the undo history.
- **User layers are sacred.** We tag the layers and comps we generate, and we only regenerate those.
- **Honest limits.** When something cannot be free (for example global street-level satellite
  imagery), the UI says so and offers a bring-your-own option.

## 2. What users of today's map plugins run into

| Area | What users see | What we do instead |
|---|---|---|
| Basemap | Raster tiles at whole zoom levels. Text and line widths grow and shrink during a zoom, and levels cross-fade. Comps fill with many tile layers. No globe, 3D terrain or sky. | Every frame rendered at the exact camera, one footage item per pass. Globe, terrain and sky. |
| Camera | Long flights visibly split into phases: zoom out, pan, zoom in. Limited pitch. | One continuous zoom-and-pan curve, pitch up to 85°. |
| Auto labels | Labels pop in and out and overlap during fast moves. | Placement checked on every frame, with hysteresis, minimum time on screen and smooth fades. |
| Vector shapes | One static path per feature: heavy when zoomed out, blocky when zoomed in. | Level-of-detail paths per zoom band. |
| Pinned layers | Renaming comps or layers can break the links. | Rename-safe links through Layer Control effects. |
| Undo | Some actions cannot be undone. | Every action is one undo step. |
| Data | Detailed maps, imagery, search and 3D buildings need a paid data partner. | Free and open data, downloaded once and used offline. |
| 3D | Extruded shapes need the Cinema 4D renderer. | 3D buildings and terrain in the renderer, plus a matched AE camera. |

Good ideas from the category that users expect, which we implement in our own way:

- **Map comp model.** A map precomp with camera controls, plus pinned layers in the containing comp.
- **Label templates.** Normal comps with `{property}` text fields and image fields.
- **Data-driven styles.** Value or colour stops, category matching, circle-area scaling, animated
  values.
- **Screen-constant strokes** that keep their on-screen width while the map zooms.
- **Background processing** with progress and cancel for heavy geometry work.
- **Imports.** GeoJSON, CSV, GPX, TCX, KML, KMZ, Shapefile, TopoJSON, OSM PBF, and .ase palettes.
- **Scripting API**, including live CSV watching for data graphics.
- **Helpers.** Scale bar, north arrow, distance circle, minimap view outline, matched 3D camera.

## 3. Product pillars

**P1 — Frame-exact basemap renderer.**
- Every frame is rendered at the exact camera for that frame (fractional zoom, bearing, pitch,
  terrain) at comp resolution with supersampling.
- No tile seams, no zoom-level cross-fades, and lines stay the same crisp width.
- Optional renderer motion blur from sub-frame samples.
- Fast low-res proxy sequences and full-res final sequences, swapped through AE's proxy system.

**P2 — Render passes for compositing.**
- Passes: Base, Land, Water, Roads, Boundaries, Buildings, Terrain shading, and an optional Label
  pass.
- Mattes: Water, Land, and Selected region.
- Each pass has alpha, so designers can grade, glow, or mask any part of the map. GEOlayers only
  offers a water mask comp.

**P3 — Cinematic camera.**
- **Shot list.** Key views, durations, and easing curves.
- **Smooth zoom-pan.** Uses the optimal path of van Wijk and Nuij (2003), so a move never splits
  into visible phases.
- **Camera moves.** Orbit and follow-route with look-ahead and smoothing.
- **Globe intro.** A globe-to-street move with atmosphere (MapLibre globe projection).
- **3D.** Terrain, 3D buildings, and pitch up to 85°.

**P4 — AE layers that always line up.**
- Pins, labels, callouts, routes, and borders are real AE layers. They are driven by the same camera
  math as the renderer.
- Alignment is checked by automated tests.
- Links use Layer Control effects, so renaming never breaks them.
- One click creates a matched AE 3D camera for 3D layers, Element 3D, and Cinema 4D.

**P5 — Labels that animate like a designer placed them.**
- **Placement over the whole timeline.** Collision is tested on every frame, with hysteresis, a
  minimum time on screen, smooth fades, priorities, keep-out zones, and optional leader lines.
- **Correct shaping.** Arabic, Hindi, Thai, Bengali, and every other complex script goes through AE's Universal
  Type Engine. The label layers stay editable.
- **Label templates.** `{property}` text fields, image fields, and a custom anchor.

**P6 — Vector shapes with level of detail.**
- Topology-safe simplification per zoom band, so shared borders never gap.
- Screen-constant strokes.
- Animation presets: draw-on, wipe, pulse, glow, and flowing dashes.
- Great-circle flight arcs, arrows, and route tracers that follow a path and rotate along it.
- Correct handling of holes and the antimeridian.

**P7 — Data that is free forever.**
- **Offline.** Natural Earth is bundled (countries, admin-1, cities, rivers, lakes, coastlines).
- **Detailed basemaps.** OpenStreetMap detail from the Protomaps planet builds. Download a region
  once, then work offline.
- **Terrain.** Open elevation tiles.
- **Imagery, in layers of detail, all legally free for commercial video.**
  - Whole planet at low zoom: NASA Blue Marble and Black Marble (public domain).
  - Whole planet at about 10 m per pixel (city scale): a cloud-free Sentinel-2 mosaic that the
    panel builds locally for the region the user needs, from Copernicus open data (commercial
    use allowed with attribution).
  - Street scale where governments publish open aerial photos: a curated catalogue of national
    open orthophoto services. Examples: USGS/NAIP (United States, public domain), IGN (France),
    PNOA (Spain), PDOK (Netherlands), swisstopo (Switzerland), Denmark, Estonia, Japan GSI. Each
    entry records its licence and attribution text, and the panel adds the attribution
    automatically.
  - Google Earth Studio bridge: import Earth Studio's 3D tracking export, so our pins, labels,
    routes and data line up on footage the user rendered in Google's own tool, under Google's
    terms.
  - Google Maps, Bing Maps and Esri imagery are not built in: their terms forbid downloading,
    caching or rendering their tiles outside their own products, whether or not the tool is free.
- **Online lookups.** Place search through Photon or Nominatim, and OSM features and boundaries
  through Overpass. Requests are polite (throttled and cached).
- **Imports.** GeoJSON, TopoJSON, KML, KMZ, GPX, TCX, CSV, Shapefile, and OSM PBF.
- **Bring your own.** Any XYZ, WMTS, or PMTiles URL, including one with the user's own key. The
  user is responsible for that source's terms.
- **Global boundary packs.** Admin boundaries for every country down to district level
  (geoBoundaries, open licences), with place names in many languages.

**P8 — Data visualisation.**
- Map types: choropleth, bubbles, 3D spikes, heat, and flow arcs.
- CSV joins by ISO code or by name in any language.
- Generated legends and animated counters.

**P9 — Quality of life.**
- An English UI with a translation system, so the community can add languages (Bengali first).
- Sample projects and onboarding.
- Update checks through GitHub releases, and a one-click bug report pre-filled with environment
  info.
- A scripting API, including live CSV watch.

## 4. Quality bar against GEOlayers 3

Each item must be demonstrated in the release sample project before 1.0:

1. **Crisp basemap during zoom.** Text and line widths stay the same size on screen at any zoom.
   There are no zoom-level cross-fades.
2. **Alignment.** Pins and shapes on AE layers stay within 0.5 px of the rendered basemap at 4K,
   including pitch and bearing. An automated test checks this.
3. **Smooth fly-to.** A move from one continent to a city on another is one continuous zoom-pan
   curve, with no held-position phase.
4. **Stable auto labels.** No label shows for less than the minimum time. There is no flicker from
   frame to frame, and no overlaps on any frame.
5. **Any script.** Labels in complex scripts shape correctly. The test set covers Arabic, Hebrew,
   Hindi, Bengali, Thai, Chinese, Japanese and Korean.
6. **Light comps.** A 10-second fly-to comp holds one footage item per render pass, not hundreds of
   tile layers.
7. **Undo.** Every panel action can be undone with Ctrl+Z.
8. **Level of detail.** A country outline stays smooth at zoom 12 and light at zoom 2.
9. **Free.** Every sample works with no account and no key.

## 5. Architecture

- **Host.** After Effects 2024 (v24) or newer: the Universal Type Engine is needed to shape
  complex scripts. CEP 12 panel (Chromium 99, WebGL2). Windows first, with nothing that blocks macOS.
- **Panel.**
  - TypeScript bundled with esbuild.
  - The UI uses a small component library (Preact).
  - Free icons: individual Lucide SVGs (ISC), vendored one by one as needed.
  - Node is enabled for file access and the disk cache.
- **Core** (`src/core`). Pure TypeScript with no DOM, Node, or network. It holds:
  - Web Mercator and camera maths.
  - The fly-path and easing solver.
  - Tile math.
  - Level-of-detail simplification.
  - Label placement.
  - CSV joins.
  - The style model.
  - AE job builders.

  Tests run with Node's built-in runner, which runs TypeScript directly.
- **Renderer** (`src/panel/render`).
  - MapLibre GL JS v6 (BSD-3) draws into a hidden canvas under a deterministic clock.
  - `readPixels` output is encoded to PNG or JPEG in a worker, and Node writes the frames to disk.
  - PMTiles (BSD-3) reads local regional archives.
- **Host scripts** (`src/host`).
  - ES3 ExtendScript files, concatenated into `dist/host/lazymaplayers.jsx` under one namespace, `LML`.
  - Large payloads (geometry, keyframes) travel as JSON job files. Small calls use `evalScript`.
- **Tagging.** Every generated item carries an `LML:` marker in its comment. Regeneration only
  touches tagged items.
- **Linking.** Layer Control effects instead of layer names inside expression strings.
- **Storage.**
  - Map comp settings live in a hidden, tagged data layer inside the comp, so they travel with the
    .aep.
  - The cache (tiles, PMTiles regions, search results) lives in `%APPDATA%/LazyMapLayers`.
- **Testing.**
  - Core unit tests.
  - ExtendScript syntax check.
  - Headless AE smoke tests (`AfterFX.com -r`, run only with Sohan's permission each time).
  - A manual test list for each phase.
- **Release.** Follows the suite convention: signed ZXP, zip, and installers. The newest zip goes to
  `D:\GitHub\00. Install from here`.

### Approved runtime dependencies

These need a one-time install, with Sohan's permission:

- `maplibre-gl` (BSD-3)
- `pmtiles` (BSD-3)
- `preact` and `@preact/signals` (MIT)
- `@turf/*` subset (MIT)
- `topojson-server`, `topojson-simplify`, `topojson-client` (ISC)
- `polylabel` (ISC)
- `papaparse` (MIT)
- `@tmcw/togeojson` (BSD-2)
- `shpjs` (MIT)
- `fflate` (MIT)

Dev only: `typescript`, `esbuild`.

Anything else needs a note in `docs/DECISIONS.md`.

## 6. Risky assumptions and the spikes that settle them (Phase 0)

| # | Assumption | Spike |
|---|---|---|
| S1 | MapLibre GL JS v6 runs in AE 2026's CEP (Chromium 99). It renders a 1080p frame in under 300 ms and 4K in under 1.2 s, with tiles already loaded. | Render 100 frames of a move to PNG and time them. |
| S2 | Our AE camera rig matches MapLibre's projection within 0.5 px at pitch 0–85° and any bearing. | Headless AE compares rig-projected points with renderer-projected points. |
| S3 | ExtendScript can create text layers in complex scripts that shape correctly, and measure 500 labels fast enough for timeline placement. | Create and measure a batch in several scripts, render a frame, and inspect it. |
| S4 | A regional extract from the Protomaps planet build downloads over HTTP range requests, and MapLibre reads it offline. | Extract one city region to zoom 15 and render it. |
| S5 | AE handles image-sequence import, proxy swap, and re-render in place without breaking comps. | Render, import, set a proxy, re-render, and check the comp. |
| S6 | A renderer clock can drive symbol and terrain fades frame by frame. | Render the same frame twice and compare the images. |

If a spike fails, the fallback goes into `docs/DECISIONS.md` before we continue. For example, if S1
fails, fall back to a tile-layer basemap like GEOlayers but with overlapping zoom bands. If S3
fails, fall back to a label pass drawn with the canvas text shaper.

## 7. Phases

Each phase ends with passing tests, a manual test list, and a short changelog entry.

**Phase 0 — Foundation and spikes**
- Repo scaffold, build, dev install, host bridge, logging, and headless AE smoke harness.
- Run spikes S1 to S6.

Done when the panel opens in AE, shows an offline Natural Earth map, creates a map comp, and every
spike has a recorded result.

**Phase 1 — Camera core and rig**
- Mercator and camera maths in core.
- Map comp with controls.
- Rig expressions and pins (2D projected and 3D).
- Panel ↔ AE sync: read the view at the current time, set a keyframe.
- Rename-safe links.

Done when S2's alignment test passes at 1080p and 4K for random views.

**Phase 2 — Frame renderer and passes**
- Proxy and final sequences, with a render queue in the panel (progress, cancel, and resume).
- Frame hashing, so only changed frames re-render.
- Supersampling, motion blur samples, and passes and mattes.

Done when a 10-second 4K move renders with no seams or pops, re-rendering after a keyframe change
only redraws the affected frames, and the comp stays light.

**Milestone A — World flight demo** (after Phase 2)
1. Globe from space, slowly turning, with country borders drawing on.
2. One continuous flight across continents down to a city, with auto labels in the local script.
3. A pin with a callout, then a second flight to another city with a great-circle route arc.

Rendered at 1080p and 4K. This is the first "wow" release (0.1).

**Phase 3 — Cinematic camera**
- Shot list UI.
- van Wijk–Nuij paths.
- Easing presets.
- Orbit, follow-route, and fit-to-feature.
- Globe transitions, terrain, sky, and 3D buildings.

**Phase 4 — Data**
- Offline Natural Earth packs and global boundary packs.
- Imagery: NASA layers, local Sentinel-2 mosaic builder, open orthophoto catalogue.
- Google Earth Studio tracking import.
- Search, reverse geocoding, and Overpass fetch, all throttled and cached.
- Region download (PMTiles extract).
- Imports for all listed formats.
- Feature browser with merge, dissolve, simplify, buffer, great circle, point-in-polygon, and CSV
  join.
- Everything runs in workers with progress and cancel.

**Phase 5 — AE vector layers and styles**
- Shape layers with level of detail and styles: fill, stroke, dash, gap, outline, glow, and
  data-driven values.
- Animation presets and arrows.
- Route tracers.
- Style pick-up from an existing layer.
- Turn AE layers back into GeoJSON.

**Phase 6 — Labels**
- Label templates.
- Timeline-wide auto-label engine.
- Callouts and leader lines.
- Keep-out zones.
- Complex scripts.

**Phase 7 — Map styles**
- 8 to 12 curated motion-design styles: dark, light, paper, blueprint, neon, broadcast news,
  terrain, and night lights.
- Style editor with base colours, layer toggles, widths, hillshade, terrain exaggeration, and sky.
- Import and export of styles.
- Palettes from an image or an .ase file.

**Phase 8 — Data visualisation and extras**
- Choropleth, bubbles, spikes, heat, and flows.
- Legends.
- Scale bar, north arrow, minimap inset, and distance circles.
- Live CSV watch and scripting API.

**Phase 9 — Polish and 1.0**
- English UI with translations (Bengali first).
- Sample projects and documentation.
- Update checker and bug reporter.
- Performance budgets.
- Signed release.

## 8. Status board

| Phase | Status |
|---|---|
| 0 — Foundation and spikes | DONE 2026-09-17: spikes S1–S6 and host smoke H1 pass in AE 2026 (docs/SPIKES.md) |
| 1 — Camera core and rig | DONE 2026-09-17: 2D pins (P1 0.006 px at 1080p and 4K), matched 3D camera and 3D pins (C1 0.004 px), AE render check (E1 40/40), usable panel UI (U1) |
| 2 — Frame renderer and passes | DONE 2026-09-17: content-keyed cache, render queue with cancel and resume, preview proxies, 1–4× GPU supersampling, motion blur, 6 passes and 2 mattes (R1 15/15); 10-second 4K move at 125 ms per frame with no pops, keyframe change redraws only affected frames (R2). Deferred: label, terrain and selected-region passes (D8), tile-level cross-fade (D10) |
| Milestone A — World flight demo | DONE 2026-09-17: globe (G1, G2), fly-to keys, world plus layered regions (D13), borders draw-on, auto labels in local scripts, routes, callouts, panel buttons, demo built and rendered at 1080p and 4K (D1), signed installer for release 0.1.0. Deferred: macOS test run, far-field region tiers beyond lines (D13) |
| 3 — Cinematic camera | DONE 2026-09-18: shot list with Fly, Straight, Along route and Cut moves, easing presets, orbit, push-in and globe spin, preview playback, Apply in one undo step, offline search and fit to country, the preview as the exact frame, new panel layout (D15, D16). In After Effects: SH1 (601 frames match core maths, Apply in about 30 ms, also when applied again) and U1 pass, and H1, P1, C1, E1, X1, R1 and D1 still pass. Seven map looks with optional satellite and relief imagery (D18, D19; TH1, SAT1), country highlights as their own pass (D20, HL1). Auto labels in batches with progress and cancel (D21, LB1). Import of GPX, KML and GeoJSON with routes, travellers and camera moves along them (D22, RT1). Custom area highlights (D23) and built-in provinces in search and the Highlight tool (D24, HL1). KMZ, CSV and shapefile import, recorded pace for timed tracks, great-circle legs, the imported file shown in the preview (D25, RT1). One layer per highlight (D26, HL1). Districts as a download per country from geoBoundaries (D27, DS1). Elevation packs, shaded slopes, 3D terrain with elevation-aware linked layers and a keyable height, the sky above the horizon (D28, TR1). Imagery packs published as a GitHub release and downloaded from the Look sheet (D29, IM1) |
| 4 — Data | NOT STARTED |
| 5 — AE vector layers and styles | IN PROGRESS 2026-09-18: any highlighted country, province, district or imported area is added to the comp as an editable shape layer with paths that follow the map, an even-odd fill, a stroke and an optional draw-on (D30, SL1); bundled country outlines; area-based thinning. Next: styles picked up from a layer, data-driven values, arrows and route tracers, AE layers back to GeoJSON |
| 6 — Labels | NOT STARTED |
| 7 — Map styles | NOT STARTED |
| 8 — Data visualisation and extras | NOT STARTED |
| 9 — Polish and 1.0 | NOT STARTED |
