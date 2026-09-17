# Decisions

Short records of choices that change or extend `docs/PLAN.md`. Newest last.

## D1 — Global audience (2026-09-17)

- **Context.** The first plan draft leaned on Bangladesh examples.
- **Decision.** LazyMapLayers is built for motion designers worldwide.
  - Demos, tests and data packs are global.
  - Complex-script support is tested across many scripts; Bengali is one of them.
  - The UI is English, with a translation system.
- **Consequences.** Milestone A becomes a world flight demo. Local admin packs become global
  boundary packs (geoBoundaries).

## D2 — No Google, Bing or Esri imagery built in (2026-09-17)

- **Context.** Being free and open source does not change a tile provider's terms. Those terms bind
  whoever fetches the tiles, and LazyMapLayers would download, cache and render tiles into frames
  outside the provider's product. Details:
  - **Google Maps Platform** forbids pre-fetching, caching, bulk-downloading and using its content
    outside its services. Its geo guidelines also forbid extracting imagery or making offline copies.
  - **Bing Maps for Enterprise.** Free (Basic) accounts were retired on 2025-06-30, and the service
    ends in 2028.
  - **Esri World Imagery** needs an ArcGIS subscription, and its session tokens may not be used to
    export tiles.
- **Decision.** We ship only sources that allow commercial video use with attribution:
  - NASA Blue Marble and Black Marble.
  - A local Sentinel-2 cloud-free mosaic builder, using Copernicus open data.
  - A catalogue of national open orthophoto services.
  - An import for Google Earth Studio's 3D tracking export. The user renders in Google's own tool
    under Google's terms, and we align layers on top.
  - Any XYZ, WMTS or PMTiles URL the user brings, at their own responsibility.
- **Consequences.** Global imagery is free at up to about 10 m per pixel. Street-level imagery is
  free only where a government publishes it openly.

## D3 — Build-time and type-only packages (2026-09-17)

- **Decision.** Added dev dependencies beyond the approved list:
  - `@maplibre/geojson-vt` (ISC) and `@maplibre/vt-pbf` (MIT), to cut Natural Earth into vector
    tiles at build time. Both come from the MapLibre organisation, and MapLibre already depends on
    them.
  - `@types/node` (MIT), for type checking only.
- **Consequences.** None of them ship in the panel bundle.

## D4 — Our own CEP bridge instead of CSInterface.js (2026-09-17)

- **Context.** Adobe's CSInterface.js says it may be distributed "in accordance with the terms of
  the Adobe license agreement", which is unclear for an MIT project.
- **Decision.** `src/panel/cep.ts` talks to `window.__adobe_cep__` directly and implements only what
  we use.

## D5 — Host scripts are pure ASCII (2026-09-17)

- **Context.** ExtendScript reads BOM-less .jsx files in the system code page.
- **Decision.** `tools/build.mjs` writes `dist/host/lazymaplayers.jsx` with every non-ASCII
  character as a backslash-u escape. Developer .jsx tools are kept ASCII with `tools/ascii.mjs`. The
  panel sends arguments to the host as ASCII-escaped JSON, and the host's JSON writer escapes
  non-ASCII too.

## D6 — Offline Natural Earth basemap to zoom 6 (2026-09-17)

- **Decision.** `data/generated/natural-earth.pmtiles` is built by
  `tools/prepare-natural-earth.ts`. It uses 1:110m for z0–2, 1:50m for z3–4 and 1:10m for z5–6,
  and MapLibre overzooms beyond z6.
  - Layers: ocean, land, coastline, countries (with 26 name languages), country_points,
    boundaries, admin1_lines, lakes, rivers, places.
  - Size: 24 MB, gzip-compressed MVT, built in about 9 s.
- **Consequences.** Natural Earth 1:10m has no more detail to give past about zoom 6. Detail beyond
  that comes from regional OpenStreetMap downloads (Phase 4).

## D7 — Content-keyed render cache with hard-linked sequences (2026-09-17)

- **Context.** After Effects caches footage frames by file path, so a re-render into the same
  folder can show stale frames. Rendering every frame of every pass again after a small keyframe
  change wastes minutes at 4K.
- **Decision.**
  - Every pass image of every frame gets a 64-bit content key (`src/core/render/frameKey.ts`,
    `plan.ts`). The key covers the renderer version, style, data archive (path, size, modified
    time), output size, supersampling and the camera of every motion blur sample.
  - Images live once in `<renders>/<map>/cache/<pass>/<key>.png`, written to a temporary name and
    renamed.
  - Each render builds a new sequence folder of hard links to the cache (copies when linking fails)
    and swaps it into the footage. The two newest folders per pass stay, so Undo in After Effects
    still finds the previous footage.
- **Consequences.** Held shots render once, unchanged re-renders take under a second, a keyframe
  change redraws only the frames it affects, and a cancelled render resumes from the cache. Old
  cache files are not removed automatically yet.

## D8 — Passes from layer groups, hidden per draw (2026-09-17)

- **Context.** Passes need the same tiles and camera as the basemap. Changing layer visibility or
  switching styles in MapLibre reloads tiles, which is far too slow per frame.
- **Decision.**
  - Every style layer names a group in `metadata["lml:group"]`: background, land, water,
    boundaries, roads, buildings, labels or overlay.
  - The renderer overrides `isHidden()` on MapLibre's style layer objects, so the painter skips the
    layers outside the current group while the tile buckets stay untouched.
  - Passes are composed in workers from these group draws (`src/core/render/passes.ts`). Ground
    passes are held out by buildings; the land and water mattes add up to exactly one.
  - Frames are box-filtered on the GPU when supersampling, and only output-size pixels are read
    back.
- **Consequences.** A pass costs one extra draw and read at the same camera. `isHidden` is internal
  to MapLibre, so upgrades of `maplibre-gl` must re-run R1 (its GPU, pass and determinism checks
  catch a break).
- **Not included.** A label pass (renderer labels are not frame-stable; labels are AE layers, see
  S6), a terrain shading pass (no terrain yet, Phase 3) and a selected-region matte (needs the
  feature browser, Phase 4).

## D9 — Previews are After Effects proxies (2026-09-17)

- **Decision.** A final render is the footage's main source. A preview becomes the main source only
  while no final render exists; otherwise it becomes the footage's proxy and is switched on. A
  later final render keeps a proxy whose camera animation matches (same stamp) but switches it
  off, and removes a proxy that shows a different move.
- **Consequences.** Designers work with fast half-resolution frames, and the After Effects render
  queue's "Use No Proxies" setting always gets the final frames.

## D10 — Level-of-detail pops: fade what the style can, measure the rest (2026-09-17)

- **Context.** Vector tiles change content between zoom levels: minor roads and small buildings
  appear when the camera crosses a whole zoom, and pitched views use lower levels in the distance.
- **Decision.** Styles fade in features that start at a zoom (buildings fade in and rise between
  zoom 12 and 13). R1 and R2 measure pops on every test render.
- **Later.** A renderer cross-fade between tile levels (drawing near a level change with the lower
  level too and blending by zoom) would remove the remaining small steps. It needs a per-pixel
  blend for pitched views, so it waits for Phase 3's camera work.

## D11 — Globe until zoom 7, flat map from zoom 8 (2026-09-17)

- **Context.** MapLibre's "globe" preset turns into the flat map between zoom 11 and 12. City detail
  then renders inside the transition, and region tiles overlap the globe's curved mesh.
- **Decision.** Our styles use the same mechanism with the transition between zoom 7 and 8
  (`GLOBE_TO_MERCATOR` in `src/core/camera/globe.ts`); the curvature is no longer visible there.
  Core maths, expressions and tests follow the same constants.

## D12 — Labels are After Effects layers placed over the whole timeline (2026-09-17)

- **Decision.**
  - Country and city names come from Natural Earth (26 name languages), in the local language of
    the place with an English subtitle (`src/core/labels/language.ts`).
  - `src/core/labels/placement.ts` places labels on every frame: labels on screen keep their place,
    new ones come in by priority, nothing overlaps, appearances shorter than 0.8 s are dropped,
    and labels fade in and out inside their appearances. On a globe the whole label must sit on the
    planet.
  - The host builds one text layer per label (plus a dot and a subtitle) with position expressions
    and fade keys, picking a font per writing system that exists on the machine (Windows, macOS,
    then Noto).
- **Consequences.** Labels stay editable text with correct shaping (Universal Type Engine) and never
  flicker. Building 140 labels (340 layers) takes about 30 s; the scene comp is taken out of the
  viewer meanwhile, which made it almost three times faster.

## D13 — Regions appear when the frame fits inside them (2026-09-17)

- **Context.** A downloaded region only has tiles inside its bounds. Seen from far out, its detail
  sits on the world map as a sharp-edged patch. Its water polygons below zoom 12 can also be
  triangulated into wedges across rivers.
- **Decision.** Each region fades in over 0.8 zoom levels ending where the frame is about as large as
  the region (`src/core/tiles/regionFade.ts`, never before zoom 9.8), and its water polygons wait for
  zoom 12. OSM outlines tagged building=no are not drawn, so buildings made of parts (such as the
  Eiffel Tower) show their real shape.
- **Consequences.** Small regions leave a stretch of world-map-only zooms during a descent. Wider,
  lower-detail regions around a city fill that stretch.
- **Tiers (added the same day).** When a detailed region lies inside a wider one with fewer zoom
  levels (for example Tokyo to zoom 15 inside Kanto to zoom 12), the wider region's roads, borders,
  buildings and labels fade out while the detailed one fades in; its land stays to fill the far
  field (`regionTiers` in `src/core/tiles/regionFade.ts`).
- **Water (revised).** Wedges also appear in zoom-12 water polygons, so region water polygons wait
  for zoom 13 and regions without zoom-13 tiles never draw them. Rivers and canals are drawn as lines
  from the line features in the same tiles, at every zoom.

## D14 — Generated expressions are ES3, for both expression engines (2026-09-17)

- **Context.** After Effects has two expression engines. New projects default to the JavaScript
  engine, but older projects, and new projects made from a project template, often use the Legacy
  ExtendScript engine, which only understands ES3. Release 0.1.0 generated expressions with const
  and arrow functions, so every pin, label, route, callout and camera expression failed in such a
  project (found by the first release test, in a project from Sohan's own template).
- **Decision.** Every expression generator in `src/core/ae/` writes ES3: var and function, loops
  instead of array methods, `lmlFround` instead of Math.fround, and no chained conditional
  operators. `npm run check:expressions` runs every kind of generated expression in Windows Script
  Host's JScript (an ES3 engine) against the same fake expression API as Node and compares the
  results (`tools/expression-fixtures.ts`, `tools/expression-env.js`, `tools/check-expressions.js`).
  In After Effects, X1 compares every expression in both engines and D1L builds and renders the whole
  world flight in a Legacy ExtendScript project.
- **Consequences.** Map layers work in any project, whichever engine it uses. The panel log notes
  when a project uses the Legacy ExtendScript engine, which plays back more slowly. After Effects
  keeps an expression compiled by the engine it was set with, so layers made by 0.1.0 in a Legacy
  ExtendScript project must be made again.

## D15 — The shot list is the source of the camera; Apply bakes it (2026-09-17)

- **Context.** Phase 3 needs a way to build camera animation that is quicker than keyframing five
  controls by hand, and that never blocks After Effects.
- **Decision.**
  - A map's camera is a list of shots (a view, a hold with optional orbit, push-in or globe spin) with
    a move into each shot: Fly (van Wijk–Nuij), Straight (constant speed on screen), Along route
    (great circle or any line, optionally turning with the route) or Cut, each with a duration and an
    easing preset or custom Bézier (`src/core/camera/shots.ts`, `easing.ts`, `routeMove.ts`).
  - The panel owns the maths. **Apply to timeline** sends baked keys to the host in one call and one
    undo step: one key per frame while the camera moves, two keys for a still hold, a Hold key before
    a cut, and a marker per shot (the user's own markers are never touched).
  - The list is stored on its own line of the map layer's comment (`LML-SHOTS:`), so it travels with
    the project while reading the tag stays cheap. Edits between two Applies live in a draft file in
    the user's data folder, not in the project, so the undo history stays clean.
  - A fingerprint of the keys (counts and sampled values) tells the panel when keys were changed by
    hand; Apply then says which time range it will replace.
  - Play runs the camera in the preview in real time, with no render and no After Effects calls.
  - Keyframe view and Fly here stay for people who key by hand.
  - **Replacing keys fast.** After Effects removes keys one at a time, at about 1.3 ms each whatever
    the viewer shows or the undo state is (measured by SH1), so re-applying a camera with a key on
    every frame blocked for seconds. When a control holds more than 120 keys, all inside the range being
    replaced, and no expression, the host removes the control and adds a fresh one with the same name
    at the same place (`LML.shots.clearKeys`). Expressions find controls by name, so pins, labels and
    the 3D camera keep following; SH1 checks that. Controls with the user's own keys outside the range
    keep the slow, exact path.
- **Consequences.** Shots can be retimed, reordered and re-eased at any point and applied again.
  Passing through a shot without stopping (a spline through several views) is not included yet: a
  shot with no hold still eases to a stop unless both moves use Linear.

## D16 — The preview is the comp, scaled down (2026-09-17)

- **Context.** The preview used the panel's own size, so at the same zoom the comp showed a wider
  area than the preview, and styles drew other detail than the render.
- **Decision.** The preview's map box has the comp's size in CSS pixels, is scaled to fit with a CSS
  transform, and its pixel ratio is lowered by the same factor (`src/panel/preview.ts`). MapLibre
  works at the comp's zoom with the comp's viewport, so framing, tiles, fades, label and line sizes
  equal the final frames, while the GPU draws only the pixels the panel shows. The data credit moved
  out of the scaled box into the panel.
- **Readable by default.** Scaled down, names and lines were a fraction of their size and could not be
  read (Sohan's first try). The preview therefore multiplies the style's text, line and circle sizes
  by the inverse of its scale (`src/core/style/scaleStyle.ts`); an "exact look" button shows them as
  they render. Framing, tiles and fades are exact either way.
- **Consequences.** What is framed is what renders, at any comp size or shape. Shot thumbnails come
  from the same canvas.

## D17 — Phase 3 scope (2026-09-17)

- **Included.** Shot list, easing presets, orbit, push-in, globe spin, moves along routes, fit to a
  country or place with offline search (Natural Earth names in 26 languages, coordinates), automatic
  names for maps and shots, tools for pins, callouts and routes, the new panel layout.
- **Deferred.** Terrain and sky need elevation data (a download) and elevation-aware pins, so they
  come as their own step. Online place search and the feature browser stay in Phase 4. A preferences
  screen waits until there are settings that need one.
- **No hangs.** Rules for every new feature: the panel never polls After Effects; each host call is
  short or chunked; camera maths, search and playback run in the panel; anything slow shows progress
  and can be cancelled.

## D18 — Looks first: themes now, imagery and highlights next (2026-09-18)

- **Context.** Sohan's first try of the new panel: names too small to read (fixed, D16) and "still
  nowhere near" the paid plugin. The basemap was one flat placeholder style, rendered frames carry no
  names until Auto labels runs, and nothing can highlight a country yet. First impressions come from
  how the map looks, so looks move ahead of the remaining camera work (terrain, sky).
- **Decision.**
  - Themes (`src/core/style/themes.ts`): one palette per look drives the world style, the region
    style, the globe's sky, the border draw-on colour (carried in the layer's metadata) and the colours
    of generated labels. Six looks ship: Midnight, Daylight, Atlas, Blueprint, Mono, Paper. The theme
    id is stored in the map layer's tag and is part of the render job, so the frame cache keys differ
    per look.
  - The coast glow belongs to the boundaries group, so the land and water mattes stay exact.
  - On Atlas, country colours fade out between zoom 7.5 and 9.5, where city regions take over.
- **Next, in this order.** Satellite and relief imagery from public-domain sources (NASA Blue Marble,
  Natural Earth shaded relief; downloads need Sohan's permission), highlighting countries and regions
  as a render pass, names in the render without waiting (faster Auto labels), then data import.

## D19 — Imagery packs: NASA Blue Marble and Natural Earth relief (2026-09-18)

- **Sources** (both public domain, downloaded with Sohan's permission):
  - NASA Blue Marble Next Generation with topography and bathymetry, December, 21600 x 10800
    (`world.topo.bathy.200412.3x21600x10800.jpg`, 28.5 MB, eoimages.gsfc.nasa.gov).
  - Natural Earth 1:10m shaded relief, `SR_HR.zip` (42.3 MB, naciscdn.org).
- **Decision.**
  - Packs are PMTiles archives of 512-pixel WebP tiles, zoom 0 to 5 (the sources are about as wide as
    the world at zoom 5), in the user's data folder under `imagery/`. They are optional and not part
    of the installer: satellite 21 MB, relief 50 MB.
  - The builder runs in the panel (`src/panel/imagery/buildImagery.ts`, test id IMG1): Chromium decodes
    and encodes WebP, core code reprojects from equirectangular to Web Mercator through a mip pyramid
    (`src/core/imagery/equirect.ts`), our PMTiles writer stores the tiles. The 21600-pixel JPEG is split
    into 16 PNG pieces first (`tools/split-image.ps1`), because Chromium canvases end at 16384 pixels.
  - Relief is an overlay, not a picture: shadows are black and highlights white with an alpha that
    grows with the distance from the flat grey, so it works over any look. Faint shading is dropped and
    the alpha has 32 steps, which halves the archive (the alpha channel is stored without loss).
  - A new layer group "imagery" is drawn in the base, land and water renders. Where a style has
    imagery, one more render ("landShapes", the land polygons alone) gives the mattes their shape, so
    land and water mattes still cover every pixel exactly once (SAT1).
  - Raster layers never cross-fade (`raster-fade-duration: 0`), so frames stay deterministic.
- **Limits.** Satellite detail ends at about zoom 5.5; closer shots show the picture softened until a
  downloaded city region takes over. A sharper pack needs NASA's 86400-pixel tiles (about 250 MB to
  download) and is left for later.
- **Next.** Publish the packs as release assets and add an in-panel download, so other users get them.

## D20 — Highlights are a render pass of their own (2026-09-18)

- **Context.** Highlighting a country is the most used move of map explainers. As an After Effects
  shape layer it would need thousands of vertices projected by expressions on every frame, and level
  of detail per zoom.
- **Decision.** Highlights are drawn by the renderer from the country polygons already in the world
  tiles (filter on `adm0_a3`): a fill, a soft glow and an outline per country, in the layer group
  "highlight". The group is left out of the base pass and rendered as its own pass with alpha, which
  the render job adds whenever the map has highlights and the host shows switched on, on top of the
  pass stack. The map's highlights live in the map layer's tag. The pass has its own style key, so a
  colour change redraws only the highlight images; without highlights the host removes the layer
  (HL1).
- **Consequences.** Highlights are crisp at any zoom, cost After Effects nothing per frame, and stay a
  separate layer for fades, colour and glow. All highlights share one layer for now; one layer per
  country (to animate them apart) and provinces or custom regions (they need boundary data, Phase 4)
  come later. In the preview, highlight sizes are not enlarged like other lines, because they are
  part of the picture.

## D21 — Labels are built in batches (2026-09-18)

- **Context.** Auto labels sent every label to the host in one call. With the world flight's 140 labels
  (307 layers) After Effects was blocked for 47 seconds with no progress and no way out. Sohan asked
  why so many names had to be placed at once: they do not.
- **Measured (LB1, 60 labels, 143 layers).** Creating a layer costs about 15 ms, the Layer Control and
  the expression about 12 ms, styling text about 7 ms; reading the expression error back is not the
  cost. One big call took 7.8 s, the same work in eight calls 4.8 s; the demo's 140 labels went from
  48.9 s to 14.2 s, with no call longer than 1.1 s.
- **Decision.** The panel sends labels in batches of eight (`LABEL_BATCH`). The first batch removes the
  old labels and takes the scene out of the viewer, the last brings it back; `finishLabels` does that
  for a cancelled or failed build. The status line shows "Adding names 16 of 45" with Cancel. The
  Labels sheet offers Few (20), Normal (45, the default) or Many (120) names and Remove labels.
- **Consequences.** Every batch is its own undo step ("Auto labels (2 of 6)"): After Effects cannot
  keep one undo group open across calls. Remove labels and running Auto labels again both clear all
  labels in one step, which is what people need in practice.
