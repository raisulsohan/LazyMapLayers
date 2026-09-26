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
- **Closed 2026-09-24.** Measured again on the finished camera: R2's 10-second 4K descent (250
  frames, 2x supersampling, 88 ms per drawn frame) has **no pops at all**, and the largest
  frame-to-frame change is 17.3 of 255 - the camera moving, not a level change. The style's fades
  are enough; a renderer cross-fade would cost a second draw per frame for a step no test can find.
  It is dropped, not deferred. If a pop ever shows up, R1 and R2 report it with the frame.

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

## D13 — Regions appear when the frame fits inside them (2026-09-17, measured again 2026-09-24)

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
- **The empty band, measured (2026-09-24).** Every downloaded region carries the whole pyramid from
  zoom 0 inside its bounds, so nothing stops a region from drawing early except the rule itself. At
  1920x1080 the frame is as large as a 161 km wide region (paris-wide) at zoom 9.26, and the floor
  of 9.8 delays it by half a zoom level - not the cause of anything. The real gap is zoom 7 to 9 of
  a descent: the frame is then 300 to 800 km across, wider than any city region, and the bundled
  world data (Natural Earth) holds no urban areas and no roads, so those frames show land, borders
  and rivers alone (the demo's frame at 11 s). Filling them needs data the panel does not bundle:
  Natural Earth's urban areas and major roads, about 5 MB once, in the world tiles. Left for a
  decision, because it is a download.
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

## D22 — Imported routes and travellers (2026-09-18)

- **Import.** GPX and KML go through `@tmcw/togeojson` in the panel (it needs a DOM), everything then
  is GeoJSON: `src/core/data/importLines.ts` turns it into lines (with GPS times when present) and
  places. Files over 60 MB are refused. The list lives in the panel for the session; what is made
  from it lives in the project.
- **Routes.** A line becomes the same route layer as before (a path expression that projects every
  point on every frame, drawn on with Trim Paths). Expressions pay per point per frame, so lines are
  thinned with Douglas–Peucker in Web Mercator to at most 300 points (`src/core/geo/simplify.ts`).
- **Travellers.** A tagged shape layer (an arrow) with a "Progress" slider and a "Rotate along Route"
  checkbox. Its expressions rebuild the route's projected polyline and place the layer at
  Progress % of its on-screen length, which is exactly how Trim Paths measures the route layer's path:
  with the same keys the traveller rides the tip of the line under any camera (RT1: within 0.5 px).
  Measuring along the ground instead let the tip and the arrow drift apart in tilted views.
- **The user's layers stay untouched.** A traveller is our own layer; people parent their artwork to
  it. Attaching expressions to a layer the user selected would break hard rule 3.
- **Camera.** "Camera" adds two shots joined by a level "Along route" move that carries the thinned
  line (at most 160 points) inside the shot list.
- **Not yet.** KMZ, CSV and Shapefile import; timing a traveller by the GPS times; areas as filled
  shapes; lines as a render pass for very long tracks.

## D23 — Custom highlight areas travel with the project (2026-09-18)

- **Decision.** A highlight's code is a country code or "area:<id>". Polygons of custom areas (imported
  KML or GeoJSON) are thinned to 600 points (`simplifyPolygons`, which keeps the large rings and holes
  and drops specks) and stored on their own line of the map layer's comment (`LML-AREAS:`), like the
  shot list, so the tag that every refresh reads stays small. The renderer draws them from a GeoJSON
  source in the same "highlight" group as countries. A map holds at most 40 areas; HL1 stores and
  reads back about 200 KB.
- **Next.** Built-in provinces need Natural Earth's admin-1 polygons (a 14 MB download, with Sohan's
  permission); districts need per-country boundary data (geoBoundaries).

## D24 — Built-in provinces as small per-country files (2026-09-18)

- **Decision.** Natural Earth's 1:10m admin-1 polygons (public domain) are prepared once by
  `tools/prepare-admin1.ts` into an index (`data/admin1-index.json`, 2.7 MB: id, country, names in
  26 languages, type, label point, bounds) and one file of polygons per country
  (`data/admin1/<ADM0>.json`, 7.4 MB in all). The panel reads the index with the first search and a
  country's file with the first click or highlight in that country, so nothing is paid at start-up.
- **Shared borders.** All provinces of a country are simplified together as one topology (about 110
  points per province on average), so neighbours keep identical borders after thinning.
- **No new machinery.** A highlighted province is a custom area (D23): code `area:<adm1 id>`, polygons
  thinned to 600 points and stored with the map, drawn from the same GeoJSON source. A click finds the
  country from the rendered world tiles, then the province by point-in-polygon in core
  (`pointInPolygons`). Search ranks provinces between countries and places of the same name.
- **Highlights and regions.** Highlight layers are kept out of the world-to-region hand-over (no fade,
  no maximum zoom) and are ordered above region layers; areas draw after countries.
- **Limits.** Natural Earth has first-level units only (Bangladesh: divisions; France: departments).
  Districts and other second-level units need per-country data (geoBoundaries) and come as a download,
  not in the bundle.

## D25 — Recorded pace as baked keys, and what a table of rows means (2026-09-18)

- **Recorded pace is baked, not an expression.** `paceKeys` (core) turns a track's times into
  [frame, percent] keys for Trim Paths End and the traveller's Progress. An expression could keep the
  timing exact under any camera, but it would project the whole line once more on every frame for the
  trim alone; keys cost nothing at render time and can be retimed by hand. Percent counts along the
  prepared line on the flat map, which is what Trim Paths measures in a view from straight above; in
  tilted views the pace shifts slightly, and the traveller still rides the tip because both
  properties get identical keys. Pace keys are linear (`linearKeys` in the host), even-pace keys keep
  their ease.
- **Few keys.** The pace curve is thinned with Douglas–Peucker (0.3 % tolerance, growing until at most
  80 keys remain), rounded to whole frames and forced to never run backwards.
- **Stops.** A stretch slower than 15 % of the moving speed is a stop; a stop longer than 2 % of the
  moving time is cut to that length. A position repeated in the file is one point with an arrival
  (`times`) and a departure (`leaves`), so waiting survives the removal of repeated points.
- **One preparation for every route line.** `prepareRouteLine` thins a line to the expression budget
  (300 points) and cuts legs longer than 2 degrees: along the great circle for open lines, straight on
  the flat map for outlines of areas. It returns the distance along the original line for each point,
  which is what ties recorded times to the thinned line.
- **Tables.** Parsing is papaparse's; meaning is core's (`importTable`): headings first, then a guess
  from the first row that holds coordinates. A guessed name column must differ from row to row. More
  than 25 rows without names is a track, not places. At most 50,000 rows.
- **Zip files.** KMZ and zipped shapefiles are unpacked with fflate (only .kml, .shp, .dbf, .prj and
  .cpg entries); shapefiles are parsed with shpjs's `parseShp`/`parseDbf` directly, because its own
  unzip needs a browser feature that After Effects' Chromium 99 lacks.

## D26 — One render pass per highlight (2026-09-18)

- **Decision.** Highlights stay raster passes (the renderer clips them correctly on the globe, at any
  pitch, with holes and islands; shape layers driven by expressions would project hundreds of points
  per frame inside After Effects). By default every highlight is its own pass, `highlight-<code>`
  (safe as a folder name), drawn from the style layers that carry its code in metadata
  `lml:highlight`. The map setting `highlightLayers: "one"` keeps the single `highlight` pass.
- **Cost.** A pass per highlight means a draw, a read-back and a PNG per highlight and frame. Each
  pass is keyed by its own layers and its own area polygons (layer ids left out, because they count
  the highlights), so editing one highlight redraws one pass, and the base pass never depends on
  highlights or on the polygons of areas.
- **In After Effects.** The panel names the highlight passes a map has now; the host removes the
  layers (and unused footage) of any other highlight pass, places new country highlights above the
  older ones and areas above countries. Passes of equal rank import in the order the panel sent,
  because ExtendScript's sort is not stable. Sequence folders and cached images of highlights that
  are gone are deleted once After Effects no longer uses them.

## D27 — Districts as a download per country from geoBoundaries (2026-09-18)

- **Source.** geoBoundaries' open release (gbOpen): second-level boundaries (ADM2) of nearly every
  country, each under an open licence that allows commercial use with credit (CC BY, ODbL, public
  domain, national open licences). The humanitarian and authoritative releases are not used: parts of
  them forbid commercial use. Districts are too many and change too often for the bundle (hard rule 1
  is about licences; size is why they are a download).
- **Flow.** Nothing goes online by itself. With Districts switched on, a click on a country without an
  installed set asks the geoBoundaries API for that country's metadata (a few kilobytes) and the
  file's size (a HEAD request); the sheet shows source, licence and size next to a Download button.
  The simplified GeoJSON is downloaded through Node's https (`src/panel/net.ts`, also used for
  regions), thinned together (`simplifyTogether`, the code the province tool uses, 160 points per unit
  on average) and written to `<user data>/boundaries/<ISO>-ADM2.json`; `manifest.json` keeps source,
  licence and each unit's name, label point, bounds and province (from the bundled province data, so
  search can tell fifty Washington counties apart). Bangladesh: 0.4 s from click to installed.
- **Ids.** `gb<iso><last 14 characters of geoBoundaries' shapeID>`: unique within a set and within the
  24 characters of a highlight code. The prefix says where a highlighted shape came from, so the
  render job can extend the data credit layer ("Boundaries: geoBoundaries"), which the user may
  delete like the OpenStreetMap credit.
- **Country codes.** geoBoundaries uses ISO 3166-1 alpha-3; the world tiles carry Natural Earth's
  adm0_a3 and iso_a3 (-99 for France and Norway), so `isoOfCountry` prefers iso_a3 and falls back to
  adm0_a3 with four known differences (Kosovo, South Sudan, Palestine, Western Sahara).
- **Tests.** DS1 goes online, so it runs only when named (`npm run ae:spikes -- --only DS1`); the unit
  tests cover the thinning (shared borders stay identical), ids, search records and codes.

## D28 — Terrain and sky (2026-09-18)

- **Elevation data.** Mapterhorn's planet archive (Terrarium-encoded 512 px WebP tiles to zoom 12,
  built from Copernicus GLO-30 and national open data; every source allows commercial use with
  credit, "© Mapterhorn") is a PMTiles file that supports range requests, so an elevation pack is cut
  out with the same extractor as an OpenStreetMap region (`src/panel/terrain.ts`,
  `<user data>/terrain/<name>.pmtiles`): the exact size is known before anything large moves. There
  is no bundled world terrain: at world scale the Natural Earth relief pack already shades the land,
  and a global elevation pack would be hundreds of megabytes.
- **Shaded slopes** are a MapLibre hillshade layer in the "imagery" group (part of the base, land and
  water passes, never of the mattes), placed above the last layer that colours the ground and below
  everything drawn on it, in the look's own tones and softened (`hillshadePaint`). Deterministic
  (TR1 draws the same frame twice).
- **3D terrain keeps the camera maths.** MapLibre lifts the centre point onto the ground whenever
  terrain is on (`jumpTo` sets the centre's elevation from the terrain, and `centerClampedToGround`
  keeps it there). The renderer and the preview hold the centre at `ground × height` instead
  (`jumpTo({ elevation })`, `setCenterClampedToGround(false)`), so the camera is the flat-map camera
  and every linked layer projects a place at altitude `(elevation − ground) × height`: the pin on
  Everest's peak is 0.5 px from the rendered peak (TR1). The renderer counts the frames in which
  MapLibre still moved the camera out of the mountains and the render summary says so.
- **Elevation of linked layers.** Pins get an "Elevation (m)" slider, 3D pins too; labels, callouts,
  routes and travellers carry their elevations in their expressions (`src/panel/elevation.ts` reads
  the pack at its top zoom and samples bilinearly, as MapLibre does). The map layer's "Terrain
  Height" and "Ground Level" sliders are animation controls the renderer samples per frame and the
  expressions read at their time, so a keyed height moves render and layers together. Layers made
  before a pack was chosen have no elevation and stay at sea level.
- **Sky** is MapLibre's sky for the flat map (the look's colours; off leaves it transparent, and the
  base pass then keeps its alpha). Sky and atmosphere are drawn by the painter, not by style layers,
  so `FrameRenderer` wraps the painter's sky and atmosphere draw functions and lets only the base
  render and the water fill show them (`skyVisibleIn`). `RENDERER_VERSION` moved to lml-render-3 for
  it.
- **Limits.** A pack ends at its edge (download an area larger than the frame); MapLibre draws terrain
  from the DEM tiles of the current zoom, so a place's elevation can differ by tens of metres between
  zoom levels (a pixel or two on screen); with terrain in the style every frame is resampled through
  the terrain, so a keyed height at 0 is a little softer than a render without terrain.

## D29 — Imagery packs are published as a GitHub release (2026-09-18)

- **Decision.** The satellite and relief packs (D19) live as assets of a release of the project's own
  repository tagged `imagery-1` ("Imagery packs 1", not marked Latest, so the software release stays
  the one people install from). The panel knows each pack's URL, size and SHA-256
  (`src/panel/imagery/packs.ts`) and refuses a download that does not match, so a broken or changed
  file can never be used by mistake. A new build of a pack gets a new tag (`imagery-2`) and new
  constants; old panels keep working against the old tag.
- **Why a release.** Release assets are free, fast (GitHub's CDN), versioned and need no server of
  our own; the repository itself stays small. IM1 (online, named only) downloads the satellite pack
  and compares it with the installed one: 20 MB in about 5 s here.

## D30 — Map features as shape layers (2026-09-18)

- **Decision.** A highlight (country, province, district, imported area) can be added to the comp as a
  normal shape layer: one closed path per ring inside one group, an even-odd fill so holes stay holes,
  a stroke, and optional Trim Paths for a draw-on. Every path carries the same projection expression
  the routes use, so the outline follows the camera; nothing about the layer is special, so people can
  restyle, retime, parent or pick-whip it like any shape layer they made themselves.
- **Country outlines are bundled** (`tools/prepare-countries.ts`, `data/countries/<ADM0>.json`,
  258 countries, 2.5 MB, simplified inside one topology so neighbours share their border). Provinces,
  districts and imported areas already carry their polygons with the map, so shape layers use those.
- **Thinning.** Douglas–Peucker keeps outliers, which turns Norway's fjords and Canada's inlets into
  spikes. `simplifyFeature` instead keeps the largest polygons within a budget of rings (40, one path
  each) and drops points by the area they carry (topojson's Visvalingam weights, the same maths the
  bundled data is built with), which loses detail evenly. The budget is 900 points across the layer.
- **Cost.** A shape layer of 22 paths and 487 points adds no measurable time to a rendered frame
  (SL1 renders the same frame with the layer on and off). The path expressions now measure the map
  layer's `toComp` and the layer's own `fromComp` once per frame — both are affine while the layers
  are 2D, and a fourth sample point checks that before the shortcut is used — instead of calling into
  After Effects twice per point. RT1 still matches core maths to 5e-11 px.
- **Limits.** The outline is thinned once, for the whole layer, so a close-up of a coastline is
  coarser than the rendered basemap under it. Islands beyond the ring budget are dropped.

## D31 — The user's own layers attached to a place (2026-09-22)

- **Decision.** The attach tool gives a layer the same effects and expressions a pin has
  (`pinExpressions`), so there is no second projection path to keep right: Map link, Latitude,
  Longitude, Elevation (m), Scale with Map, Rotate with Map, Reference Zoom.
- **Hard rule 3 still holds.** These are the only layers the panel touches that it did not make, and
  it touches them only when the user asks. It writes its tag on the comment's first line and keeps
  the user's own text under it; it never touches a property the user already drives with an
  expression (the tag lists the properties it did take, and Unlink restores only those); it never
  moves, renames or deletes the layer. Unlink removes the effects, the expressions and the tag.
- **Where the selection comes from.** After Effects owns the selection, so the panel reads it
  (`selectionInfo`) instead of keeping its own list: the sheet shows how many layers are selected in
  the map's scene and how many of them are attached already, and refreshes when the panel regains
  focus. Layers LazyMapLayers generated are skipped.
- **AT1** checks the lot in After Effects: 0.008 px from the place, 0.004 px after the camera moves,
  the user's own rotation expression and comment kept, unlink clean, and unlinking one layer leaves
  the other attached.

## D32 — The in-AE test runner closes only its own After Effects (2026-09-22)

- A run that was interrupted left After Effects open, and the next run then refused to start; worse,
  the runner's fallback ("the panel is not open yet, ask After Effects to open it") sent a second
  script to that instance, which answered with a warning dialog, and a modal dialog stops After
  Effects quitting at all.
- The runner now remembers which instances were open before it started, waits 150 s (not 45 s) before
  asking for the panel, and at the end closes only the instance it started itself. An After Effects
  the user opened is never touched.

## D33 — One style for the layers the panel makes (2026-09-22)

- **Decision.** The look owns the colours. Every theme has an `accent`, and `resolveLayerStyle` turns
  a theme plus a per-map override into the concrete style the panel uses: accent, panel colour (the
  callout box), text and soft text, line width (4 px at 1080 lines) and glow (on for dark looks).
  Hard-coded colours are gone from routes, callouts and pins.
- **Override per map, stored with the map.** `layerStyle` in the map layer's tag holds only what the
  user changed; a null field follows the look, so changing the look still restyles everything the
  user did not pin down. "Follow the look" clears the override.
- **Pick-up.** `LML.api.readLayerStyle` reads the first selected layer that has a colour: a shape
  layer's fill (or its stroke), or a text layer's fill, and the stroke width converted to the 1080-line
  pixels the panel stores. That is the Phase 5 "style pick-up from an existing layer".
- **What it does not do.** Layers already in the comp keep the style they were made with; the panel
  never restyles the user's work behind their back. ST1 covers the colours in After Effects.

## D34 — The in-AE runner starts After Effects reliably (2026-09-22)

- Launching After Effects while the previous instance is still shutting down makes the new one exit
  within seconds, which looked like "After Effects is not running any more" and killed the run. The
  runner now waits for the old process to go, waits three seconds more, retries the launch once if
  nothing appeared after 30 seconds, and only gives up after four minutes.

## D35 — Comets, dashes, and the way back to GeoJSON (2026-09-22)

- **A comet is the same path twice.** The second layer carries the same path expression and the same
  Trim End keys, with Trim Start keys twelve percent behind (`cometTailKeys` in core), so the head
  keeps its length however the line is paced and follows every bend without new maths. Dashes are an
  ordinary stroke dash on the route layer.
- **Export reads the layers, not the panel's memory.** `LML.api.exportLayers` hands back the tagged
  layers with their Latitude and Longitude sliders and their path expressions; core's
  `pointsFromExpression` pulls the baked points out of the expression text and `buildGeoJson` turns
  the lot into a FeatureCollection. So a pin the user dragged by its sliders, or a route whose points
  they edited, exports as it is now. A layer whose expression was replaced by hand has no points to
  read and is counted as skipped.
- **The file dialog stays in After Effects** (`File.saveDialog` in `LML.api.saveTextFile`), so the
  panel never writes where the user did not ask. Tests call `exportLayers` and build the GeoJSON, but
  never the dialog: a modal dialog would hang an automated run.

## D36 — One label template per map (2026-09-22)

- **A template, not a comp.** The category's label templates are comps with `{property}` fields, and
  every label becomes a precomp: heavy projects, and a change means rebuilding. Ours is a small set
  of values on the map (`LabelTemplate` in `src/core/labels/labelTemplate.ts`) that every name is
  built from: colour for cities and for countries, halo colour and width, size, capitals, dots, and
  a font. Labels stay ordinary text layers, so the user can still restyle one by hand.
- **The look decides until the user does.** Each field is nullable and falls back to the map's look,
  so a dark look still gives light names and switching looks restyles everything the user did not
  pin down. "Follow the look" clears the lot. Country names follow the city size by the ratio they
  already had (24/21), so one number moves both.
- **The subtitle is derived, never stored.** The English line under a name is the country colour
  mixed a quarter towards the halo, so it sits back from the name whatever colour is chosen.
- **A picked-up font is only used where it can shape the script.** `templateFonts` puts the user's
  font first for Latin, Cyrillic and Greek and ignores it for Bengali, Arabic, Chinese and the rest,
  so a brand font never turns a name into boxes. `LML.api.readLabelStyle` reads the colour, size,
  halo and font of the selected text layer, in the 1080-line pixels the panel stores.
- **Capitals are a request, not a rule.** `caps` only turns country names, and only in scripts that
  have capitals. LB2 covers all of this in After Effects.

## D37 — Keep-out zones (2026-09-22)

- **Fractions of the frame, not pixels.** A zone is stored as x, y, width and height between 0 and 1
  (`src/core/labels/keepOut.ts`), so the same map keeps its zones at 1080p and at 4K, and a comp
  resized later does not leave them behind. Five presets cover where titles usually go: lower third,
  top bar, left third, right third, middle band.
- **A layer can be the zone.** `LML.api.readLayerBounds` measures the selected layers halfway
  through the time they are on screen (`sourceRectAtTime` through their own transform and every
  parent, then back into the map layer's space), and clips them to the frame. A layer that is only
  on screen for a while blocks names only for those seconds, from its in point to its out point, so
  a lower third that appears at 1 s costs nothing before it. Rotation is taken as the bounding box
  of the turned rectangle: names keep away from a little more than the layer itself, never less.
- **The placement already knew how.** `placeLabels` takes `keepOut(frame)`; the zones are simply
  boxes it starts each frame with, so a name that cannot go anywhere else is dropped rather than
  moved, and hysteresis and the minimum time on screen still hold.
- **Seen before it is built.** The panel draws the zones over the preview, in screen pixels
  (`setPreviewOverlay`), so the outline and the name stay readable however small the preview is.
- **What it does not do.** Labels already in the comp are not moved: the zones apply the next time
  names are placed, as everything else about the label template does. LB3 covers it in After
  Effects, U1 covers the sheet and the overlay.
- **A callout takes the template's font, not its colours.** A callout sits on its own box, so its
  text colour has to read on that box and keeps following the look; the font follows the template,
  so one map reads as one piece of design (ST1).

## D38 — Any OpenStreetMap feature, through Overpass (2026-09-22)

- **Why.** Countries, provinces and districts are bundled or downloadable, but a designer usually
  wants one particular thing: this lake, that park, this island, that airport, this district. Paid
  plugins put such features behind a data partner. OpenStreetMap has them, and its data is ODbL:
  free for commercial work with credit.
- **The query is built in core** (`src/core/data/overpass.ts`), asked for with `out geom`, so ways
  and relation members carry their own points and nothing has to be resolved by id afterwards. Nine
  kinds (water, parks and forest, islands, airports, boundaries, buildings, roads, railways, or
  anything named) are each a small set of tag filters; a name matches anywhere in the name, in any
  language, ignoring case, and everything a user types is escaped, so a name can never turn into
  more query.
- **Relations are assembled here, not there.** `assembleRings` chains member ways that arrive in no
  order and in either direction into closed rings, and `polygonsFrom` puts each inner ring into the
  outer ring that holds it, so a lake keeps its islands. A ring that never closes is kept as it is:
  half a coastline still draws.
- **It arrives as an import.** The features become GeoJSON and go through the ordinary import path,
  so everything that already works for a file works for them: draw the line, run an arrow or the
  camera along it, pin the places, highlight the areas, add them as editable shape layers.
- **Polite and offline afterwards** (`src/panel/data/osm.ts`): one request at a time, never faster
  than one every two seconds, two endpoints tried in turn, answers kept in `<user data>/osm` for two
  weeks (the newest sixty), an answer over 24 MB refused, and a view wider than 12 degrees refused
  before anything is sent.
- **Credit.** A map that took features from OpenStreetMap carries `osmData` in its tag; the panel
  shows the credit and a render adds the credit layer, exactly as a downloaded region does.
- **Tested.** Unit tests for the query, the ring assembly and the conversion; OSM1 in After Effects
  goes online (only when it is named) and checks the real Lago di Como: a multi-polygon of 10,060
  points with its islands as holes, the second search served from the folder at no cost, and the
  lake drawn as a shape layer of 3 rings that follows the map.

## D39 — Areas the panel works out: merge, grow, shrink, circle (2026-09-22)

- **Why.** A designer often needs one shape that no data source has: the European Union without the
  borders inside it, a region grown so it reads at small size, a fifty-kilometre ring around a city.
  Every one of these is a polygon operation on outlines the panel already holds.
- **Turf, not our own clipper** (`@turf/union`, `@turf/buffer`; both already approved in PLAN §5).
  Polygon clipping done badly is worse than not done at all, and these are the reference
  implementations. `src/core/geo/combine.ts` wraps them, cleans what comes back (a ring needs four
  real points), and adds the area on the globe in square kilometres and the middle of a bounding box.
- **No sliver tricks needed.** Natural Earth's outlines share their border coordinates, and the
  panel thins areas with the shared-border simplifier, so nine neighbouring French provinces merge
  into exactly one ring with no hole and no sliver, and their merged area is within 2 % of the sum
  of their areas. Measured in the unit tests against the real bundled data, not on toy squares
  alone.
- **The result is an ordinary custom area.** It goes into the map's areas, so the render pass,
  the editable shape layer, the export and the style controls all work with it, and the highlights
  it came from are replaced: a merge gives one area, a grow replaces each area with its grown self.
- **What it costs is said out loud.** A custom area is thinned to 600 points (D23), so merging a
  country with many islands keeps the shapes that fit and the log says how many did not.
  Shrinking makes parts narrower than the distance disappear, and the log says that too.
- **A circle is named after the place it is around**, from the nearest place within its own radius
  (`nearestPlaceName`, the same search the view name uses), and falls back to the coordinates rather
  than naming the country the preview happens to show.
- **Tested.** Unit tests on squares, holes, real provinces and real countries; U1 merges France with
  a province, grows it by 25 km and adds a circle in the real panel.

## D40 — Numbers on the map: a CSV joined to the countries (2026-09-22)

- **A CSV without coordinates is not a mistake.** It used to be refused; now, when it has a column of
  text and a column of numbers, it opens the Data sheet instead and colours the map
  (`src/core/data/dataTable.ts`).
- **One layer, a colour per country.** A choropleth as many highlights would mean two hundred style
  layers, two hundred render passes and two hundred layers in After Effects. Instead the style gets
  a single fill layer whose colour is a `match` on the country code (`src/core/style/dataFill.ts`),
  in the highlight group, so the existing machinery renders it as one pass named after the column
  ("Data: People (millions)") and leaves it out of the base pass.
- **The codes come from the data, never from memory.** `tools/prepare-country-codes.ts` reads
  Natural Earth's own admin-0 table and writes `data/generated/country-codes.json`: the map's code,
  the ISO two letter, three letter and numeric codes, and every spelling the source holds. Natural
  Earth leaves ISO_A2 and ISO_A3 at -99 for a few countries (France among them), so the "_EH" and
  World Bank fields are used as fallbacks. 258 countries, 245 with a two-letter code.
- **A table joins by anything it says** (`src/core/data/join.ts`): the map code, an ISO code, or any
  name the bundled data holds - in any of the 26 languages the labels carry, so a table written in
  Bengali, Japanese, Arabic or French joins as readily as an English one. Keys are compared without
  case, Latin accents or punctuation; the marks of other scripts are letters and are kept, because
  dropping the vowel signs of Bengali or Hindi would turn a name into a different word.
- **Nothing is coloured on a guess.** Keys are taken in three rounds - the country's own code, then
  other codes, then names - so Clipperton Island carrying France's ISO code cannot take "FRA" from
  France. A key that two countries answer to equally is dropped from the lookup, and its row is
  reported as ambiguous rather than coloured. Rows that found nothing are listed in the sheet.
- **A comma with exactly three digits after it groups thousands** (1,428 is one thousand four
  hundred), and any other single comma is a decimal point (52,52). Both conventions appear in real
  tables and this is the reading that is right far more often.
- **Steps.** Even steps keep the distances honest; equal counts (quantiles) give every step about as
  many countries, which shows the order when a few huge numbers would flatten everything else. Five
  ramps, three to nine steps, and a legend in the sheet.
- **A dark map turns the ramp over.** A sequential ramp runs from pale to deep, which reads as
  "little to much" on paper and on a light map. On a dark map the pale end shouts, so a dark look
  starts flipped (the deep end is the small numbers) and a **Flip** switch overrides it. The legend
  always shows the colours the map really uses.
- **The legend is a precomp, not a picture.** `LML.api.addLegend` builds a comp with a background, a
  title and one row per step - real shape and text layers - and places it in a corner of the scene.
  Core works out the box and the baselines (`src/core/style/legend.ts`) from text the panel measured;
  the host only builds. It is not linked to the map: a legend stays where the designer puts it, and
  building it again replaces it and nothing else.
- **Provinces too, in two passes.** A table of states joins to the provinces of one country. Which
  country that is comes from the table itself: a first pass over every province in the world matches
  the full names, and the country most of them belong to wins. A second pass then joins against that
  country's provinces alone, where a short code (CA, US-CA, US.CA, Calif.) is no longer shared with
  provinces elsewhere and joins too. The sheet shows what was chosen and can be set by hand.
  `tools/prepare-admin1.ts` now writes those codes into the index, from Natural Earth's own fields.
- **A province fill brings its own geometry.** Countries come from the world tiles, which carry their
  codes; provinces are not in the tiles, so the style builds a GeoJSON source (`lml-data`) from the
  bundled province polygons - only the ones with a number. The polygons are not stored with the map:
  the map keeps the country and the values, and the geometry comes from the bundled data every time,
  so a map file stays small and a data update cannot leave stale outlines behind.
- **Districts do not join yet.** They are a download per country and have no stable codes; said in
  the sheet rather than half done.

## D41 — Numbers as bubbles, and a legend that shows their sizes (2026-09-22)

- **Area, not width.** A circle twice as wide looks four times as big, so the radius follows the
  square root of the value (`src/core/style/bubbles.ts`). A value of zero or less draws nothing: a
  circle cannot show "none", and a dot of no size is only noise. The smallest value still gets a
  floor radius so it can be seen.
- **One layer, one group per place.** A bubble per layer would mean two hundred layers in a comp.
  Instead the host builds a single shape layer whose groups each carry an ellipse and their own
  transform, and each group's position is the same expression a pin uses, so every bubble follows
  the camera and can still be animated on its own. Measured in After Effects: a bubble sits within
  0.000 px of the place the camera maths gives (DT1).
- **Sixty at a time.** More circles than that is not a map a designer is reading, and every one costs
  an expression per frame; the rest are left out, largest first, and the log says how many.
- **The legend grows a second half.** When a map has bubbles the legend adds three circles - the
  largest value, a quarter of it and a sixteenth, which are half and a quarter as wide - under the
  colour steps, in the same precomp. The swatches line up in one column whatever their size.
- **Colour is the accent, unless asked.** Bubbles take the map's accent colour so they read against
  any look; "In step colours" gives each one the colour of its step instead, for a map that shows
  the same number twice over.
- **The numbers themselves are labels of another kind.** "Add numbers" writes each value next to its
  place as a text layer, built by the same host builder as the auto labels but tagged `value`
  instead of `label`, so Auto labels never removes them and they never remove a name (checked in
  DT1). They are set in the map's label template, and they sit under the circle when there is one,
  clear of what they measure.
- **Tested.** Unit tests for the table, the join against the real bundled data, the scale and the
  legend layout; DT1 in After Effects joins four countries (one by its Japanese name, one by code),
  renders the pass, checks the colours on the map itself, builds the legend, replaces it and removes
  it; U1 does the same through the panel.

## D42 — A look of the designer's own, and looks from a picture (2026-09-22)

- **Why.** Seven looks are seven looks. A map has to sit inside a film whose palette is already
  decided, and the category's answer is "design a style in another product and import it", which is
  not an answer for someone who just needs the sea a little deeper.
- **Four colours, and the rest worked out.** The sheet offers sea, land, lines and names; everything
  else - landcover, parks, rivers, coasts, borders, roads, buildings, haloes, the sky - is derived in
  `src/core/style/customLook.ts` from those. Deriving beats overriding field by field: a map with
  someone else's roads on your land does not hold together.
- **A name that cannot be read is not a style choice.** The text colour is pushed towards white or
  black until it reaches a contrast of 4.5 against the land, and when one direction cannot reach it
  (a mid grey land, where white never does) the other is tried. Unit-tested against white, black,
  mid grey, cream and a saturated orange land.
- **A picture gives the palette** (`src/core/style/palette.ts`): median cut over a small histogram,
  which is deterministic - the same still always gives the same look - and costs the same whatever
  the picture's size. The darkest colour becomes the sea, the next one that can be told from it the
  land, and the most colourful of the rest the lines. A light look turns that around.
- **Carried as a whole look, not as an id.** The style, the renderer, the labels and the overlays
  used to take a look by name; they now take `ThemeLike`, which is a name or a whole look
  (`themeFrom`). The map keeps the look it started from plus the colours the user changed, so a new
  build's improvements to the bundled looks still reach a map that only changed its sea.
- **Tested.** Unit tests for the palette, the contrast rules and the derivation, including that every
  bundled look survives being rebuilt from its own three colours; LK1 renders a map in a look of its
  own and reads the pixels back (sea 58,13,82 for #3a0d52, land 240,228,200 for #f0e4c8); U1 sets the
  colours and takes a look from a picture in the real panel.

## D43 — A look as a file, and palettes from Illustrator (2026-09-22)

- **A look is plain JSON** (`src/core/style/lookFile.ts`): the bundled look it was built from, the
  colours the designer chose, and a name. Readable, editable by hand, and small enough to keep in a
  project folder or send to a studio. Reading one repairs what it finds rather than trusting it: a
  colour that is not a colour is dropped, and a base look that is not one falls back.
- **Adobe's own palette files are read here** (`src/core/style/swatchFile.ts`): `.ase`, which
  Illustrator, Photoshop and InDesign all write, and the older `.act` colour table. RGB, CMYK, Lab
  and Gray swatches all arrive as colours - Lab through D50 XYZ, because that is what Adobe's Lab
  values are relative to - and groups are read through. A studio palette becomes a map look in one
  click.
- **One button for both.** "Open a look" takes a saved look or a palette; the extension decides. A
  palette goes through the same route a picture does, so what comes out is a coherent look and not a
  row of swatches.
- **Saving opens After Effects' own dialog** (`LML.api.saveTextFile`), as the GeoJSON export does, so
  the panel never writes where it was not asked to. Automated runs never call it: a modal dialog
  would hold the run.
- **Tested.** Unit tests write an `.ase` byte for byte the way Illustrator does and read it back,
  including a Bengali swatch name, Lab and CMYK conversions and a padded `.act`; U1 hands the panel
  an `.ase` built in the page and checks the look it makes.

## D44 — A render belongs to one map of one project (2026-09-22)

- **What happened.** Sohan's release test of 0.3 showed four red lines: `MAP_NOT_FOUND: No map layer
  with id mmu5y2li9bo0rvp (line 30)`. The render queue is saved in the user data folder, not in the
  project, so a job built in one project came back in another, where that map does not exist. The
  error was true and useless.
- **Decision.** The queue is told which maps the open project holds every time the panel reads them
  (`markMissingMaps`, called from `readMaps`). A job whose map is not there is marked, taken out of
  the waiting line, and shown as "The map this render belongs to is not in the project that is open
  now. Open that project to render it again, or remove this job." - with no Resume button, because
  resuming could only fail. It is not deleted: opening that project again brings it back to life,
  and its cached frames are still there.
- **Also.** A render that fails with MAP_NOT_FOUND mid-way (the project was closed, or the map layer
  was deleted) now says the same sentence instead of the error code.

## D45 — Renders on disk, and an arrow on any route (2026-09-22)

- **What happened.** `%APPDATA%\LazyMapLayers\renders` had grown to 57 GB in one day of test runs.
  Renders of a saved project go next to it (`LazyMapLayers Renders`); renders of an unsaved project go
  to the data folder, and once that project is closed nothing can ever reach them again - an unsaved
  project cannot be reopened. D7 had left cache clean-up for later.
- **Decision.** The Render tab shows what the renders take (`src/panel/render/renderDisk.ts`) and
  removes exactly one kind of folder: renders in the data folder whose map is not in the open
  project. A saved project's folder is never touched, because a map deleted from a project may still
  have its footage in a comp; the read me tells the user that folder is theirs to delete when a
  project is finished. Counting walks every file, so it runs when asked, not on every refresh.
- **The arrow.** An imported line could carry a traveller since D22; a route made with the Route tool
  could not, which is what Sohan's first tutorial question needed (Dhaka to Chittagong with an
  arrow). The tool's sheet now has Arrow, Comet and Dashed; the traveller rides the lifted arc of the
  great circle through the same expressions.
- **Tested.** U1 adds a route with the arrow from the tool sheet, plants a job from another project
  and checks it shows the sentence and no Resume, and reads the disk report; RT1 still covers the
  traveller's motion.

## D46 — Flows: one arc per row, width by amount (2026-09-22)

- **Why.** After a choropleth and bubbles, the third map a data story needs is movement: where
  people, goods or flights go. The route machinery already draws a great-circle arc that follows the
  camera; flows are that arc, once per row, with its width set by the row.
- **Width, not area.** A line twice as wide reads as twice as much, so widths are proportional to
  the value (`src/core/data/flows.ts`), the largest row gets the widest line, and nothing draws
  thinner than 1.5 px. The arrow grows with the line it rides, within limits.
- **Places come from the search.** "Dhaka", "Bangladesh", "West Bengal" or "23.8, 90.4" all
  resolve through `searchPlaces`, so a table is written the way a person writes it. A name the
  search does not know is reported in the log, never guessed, and its rows are left out.
- **Batches, and a limit.** Arcs go to After Effects six at a time (each is a route layer plus an
  arrow) with progress and cancel, largest first, and at most 120 - every arc costs expressions on
  every frame, and a map with more is not a map anyone reads.
- **Tested.** Unit tests for the column guess, the rows and the widths; FL1 in After Effects draws
  four flows (one written as coordinates, one to a place that does not exist) and checks the stroke
  widths are 14, 7 and 3.5 px for 1,200, 600 and 300.

## D47 — Five looks built the way a look of the user's own is built (2026-09-22)

- **Decision.** Noir, Slate, Terracotta, Arctic and Emerald are not hand-tuned field by field like
  the first seven: each is three or four colours passed through applyLook (D42) and the result
  written into themes.ts as a plain look, so nothing at run time depends on the deriver and a later
  change to it cannot quietly recolour a saved map. The names read on the land at a contrast of 7.5
  to 15.9 in all five.
- **Why these five.** Broadcast and film work asks for a black-and-white map, a cool grey newsroom
  map, a warm editorial one, an icy clean one and a rich green one far more often than for anything
  exotic; twelve looks is the top of the range the plan set (8 to 12).
- **Tested.** The unit test that rebuilds every bundled look from its own colours covers them; TH1
  renders all twelve into the contact sheet.

## D85 — A path drawn in After Effects becomes geography (2026-09-27)

- **Why.** The most direct way to say where a route goes is to draw it: over a map, with the Pen
  tool, the way a motion designer draws anything else. Until now a route had to come from two
  clicks or a file.
- **Read at the moment it was drawn.** The drawing is read where it lies at the current time, with
  the camera of that moment (host 77-drawn.jsx readDrawnPaths): the paths of the selected shape
  layers (with their rectangles and ellipses) and the masks of any selected layer, each with the
  transforms of its groups, its layer and the layer's parents, and the map layer's own transform to
  undo. Core carries the bezier's control points through those transforms (a 2D transform keeps a
  bezier a bezier), cuts the curve into steps of about 6 pixels where it lies on screen, and
  unprojects each step through the camera (core/geo/drawnPaths.ts). So a curve comes back as drawn,
  and a drawing on a turned, scaled, parented layer lands where it shows.
- **The inverse of the globe.** unprojectPoint (core/camera/globe.ts) inverts projectPoint for both
  projections: the flat map in closed form as before, a fully round globe by meeting the view ray
  with the sphere and turning back, and the zooms in between by Newton steps from the nearer of the
  two. Unit tests take points through the projection and back at four views.
- **It arrives as an import.** The paths become GeoJSON (a line for an open path, an area for a
  closed one) and open in the Import sheet like a file, so everything a file's lines and areas can
  do applies: draw as a route with or without an arrow, fly the camera along, highlight, save.
  Nothing new to learn, and nothing to keep in step.
- **The drawing is left alone.** It is the user's layer (hard rule 3): not hidden, moved or
  deleted. The log says it can go once the route is made.
- **Limits.** A 3D layer, or a layer under a 3D parent, is left out with a note: its pixels depend
  on a camera the map does not know. A star or polygon shape is left out until it is converted to a
  Bezier path. Parts drawn on the sky or off the globe have no ground and are dropped; a path with
  nothing on the ground is named in the log. The ground is taken at height 0, so on a 3D terrain
  map a drawing over a mountain lands a little off where the mountain shows.
- **Tested.** Unit tests for the transforms, the sampling and the unprojection. DR1 draws a curved
  path in a moved, scaled and turned group on a turned layer, and a mask on a solid, while the
  camera moves: at 1 s they come back as Dhaka to Chittagong (within a millionth of a degree) and
  an area around Dhaka; the route made from them lies on the drawing at 1 s and on the map at 0 s;
  a line drawn on a globe comes back as Dhaka to Tokyo; with nothing selected the message says what
  to select.

## D84 — Prism maps: the places raised by their numbers, in the renderer (2026-09-27)

- **Why.** A choropleth reads a number by colour, which the eye ranks roughly; a prism map raises
  every place as high as its number, so a tilted camera shows at once which is largest and by how
  much. It is one of the looks motion designers ask for most in a data map, and a flight over
  standing countries is something a flat map cannot give.
- **In the renderer, not as layers.** The data layer becomes a fill-extrusion in the same style
  (panel/basemap/naturalEarthStyle.ts), so the prisms stand in the data pass with correct depth,
  occlusion and shading on the flat map and on the globe, and follow the camera like the rest of the
  map. Shape layers could not hide one prism behind another. Pins, names and routes stay AE layers
  on the ground, as everywhere else.
- **Height.** Linear, as spikes are (D50): the largest amount stands `maxKm` high, every other in
  proportion, with a floor of 2 % so a tiny number still shows (core/style/dataFill.ts,
  prismHeight). The default height follows what the numbers are about: 900 km for countries, 250 km
  for provinces, 40 km for districts, so a first render looks right at the zoom such a map is seen
  at; the Data row takes any height from 1 to 5,000 km.
- **Over the years.** With a series, the largest amount of every year is the top, so a height means
  the same amount in every year, as the colour scale does (D82); the "Data Time" slider sets the
  heights and the colours of each frame (frameRenderer applyAnimation).
- **Only amounts.** A table of categories has no amount to stand for, so the option is hidden for
  it and the style keeps it flat.
- **Tested.** A unit test for the heights (the largest at the top, in proportion, the floor, a
  series between its years, none for categories); DT3 renders the same numbers flat and raised over
  a tilted South Asia and expects the raised data pass to cover more of the frame and a prism to
  stand above India where the flat map has nothing, then renders them on the globe.

## D83 — A polygon clipper for Cut out, and feature properties that can be edited (2026-09-26)

- **Why.** Two known limits of the feature browser (D69): Cut out only worked when the shape taken
  away lay wholly inside, and properties could be read, filtered and sorted but not changed.
- **The clipper.** polyclip-ts (MIT), a TypeScript port of the Martinez-Rueda polygon clipping
  algorithm, is now a direct dependency. It was already in the bundle: @turf/union, approved for
  Merge, is built on it. Cut out keeps the exact path for a part wholly inside (a hole of the polygon
  it sits in, point for point) and clips a part that crosses the edge, taking away only the overlap;
  the area can fall into pieces, and the log says how many holes, how many clips, how many shapes
  did not touch, and into how many pieces it fell. A part that covers everything is refused, not made
  into an empty area.
- **Edits.** Every row of the browser has **Edit**: its name and every property as a field, a field to
  add one ("status: sold"), and **As it came**. A value that reads as a number becomes one; an empty
  value takes the property away. The edits are kept with the map as a layer over the data
  (applyFeatureEdits in src/core/data/featureList.ts), so the data a feature came from is never
  changed, and the filter, the sort and the names of highlights, shapes and labels made from it see
  the edits.
- **Tested.** Unit tests: a half overlap takes away exactly the overlap, a band across a square leaves
  two pieces, a hole and a clip in one cut; typed values, an edit touching one property of one row,
  a rename, a property taken away, the rows themselves unchanged, and a filter that sees the edit.
  FB1 clips the western half off a real country's outline and finds nothing left west of the cut.
  U1 adds "status: sold" to Luxembourg through the real panel and finds it with the filter
  status = sold.



- **Why.** The search knew countries, provinces, cities, districts and (D77) the natural world, all
  offline. A street, an address, a building or a small landmark was out of its reach, and a city map
  often starts from one.
- **Decision.** The search list ends with **Search OpenStreetMap for "…"**; clicking it, or pressing
  Enter when nothing offline matches, asks Nominatim, the OpenStreetMap Foundation's search (free, no
  key, open data under the ODbL). The results come under the offline ones with the credit Nominatim
  asks for; a click flies there (as close as a building, zoom 17, where the offline search stops at
  12), and the pin button pins it.
- **Keeping Nominatim's rules.** Never while typing (its policy forbids search-as-you-type on the
  public service): only on the user's word. One request at a time, at least 1.1 seconds apart. A
  User-Agent that names the panel and its home page. Every answer kept on disk
  (`%APPDATA%\LazyMapLayers\geocode`), so the same search never goes online twice. The map's view is
  sent as a preference so nearby places come first, never as a fence. Nothing else is sent, and the
  row's tooltip says what is. Pieces of one street within two kilometres come back as one result.
- **Tested.** Unit tests for the address of a search (words, language, the view as a preference), the
  results (name, kind, the rest of the address, a box only when it frames something, the zoom from
  Nominatim's rank), the pieces of one street merged, and bad answers. GC1 (online, only when named)
  finds Rue de Rivoli in Paris and Gulshan 2 in Dhaka a second apart, and answers the same search
  again from the disk.



- **Why.** A label design (D64) could fill text fields only. The most common designed label on a news
  map carries a picture per place: a flag beside each country, a logo per office, a photo per stop.
- **Decision.** In the design comp, any layer that is not text and whose whole name is a field, like
  `{flag}` or `{photo}`, is a picture field. The Labels sheet shows **Pictures for {flag}…** for each
  one; the folder chosen is kept with the map. Place by place, Auto labels finds the picture by the
  place's codes first (BGD, BD) and its names after (Bangladesh, "Bangladesh flag", accents, case and
  punctuation ignored; src/core/labels/designImages.ts), and a city with no picture of its own takes
  its country's, so a city's label can wear its country's flag. Nothing is bundled or downloaded:
  flags, logos and photos come from the user.
- **In the copy.** The picture replaces the placeholder's source, fitted into the box the placeholder
  takes and keeping its own shape; a place with no picture has the layer switched off. A picture is
  imported once however many labels show it. After Effects renames a layer to its new source when it
  took its name from the old one, so the field's name is put back on the layer.
- **Tested.** Unit tests for the file keys, codes before names, a picture that is not an image, and
  the fit. LD2 in After Effects: a design with {name} and a {flag} solid, flags named BGD.png, in.png
  and "Nepal flag.png", and each of India, Bangladesh and Nepal wearing its own at 30 % (300 x 200 in
  a 100 x 60 box), every other country with the layer off, three footage items for three flags.



- **Why.** The only chart was a bar per place for one set of numbers. Numbers over the years (D79)
  are shown as lines: a line chart beside the map is the usual companion of a map that moves
  through time.
- **Decision.** **Lines over the years** and **Areas over the years** under Add chart, for a table
  with years. The chart is a precomp like the bar chart: a background, a grid on a round value axis
  (1, 2, 2.5 or 5 times a power of ten), round years under it, and a line or a filled area per place,
  the largest at the last year first, at most eight, each in its own colour of the colour-blind safe
  set (lines need telling apart, not ranking). A dot and the place's name with its value ride the
  head of every line (src/core/style/lineChart.ts).
- **Following the map, not a copy of its keys.** Inside the precomp, time runs from the first year to
  the last; every path, dot and number is an expression of that time (src/core/ae/chartExpressions.ts)
  and stands exactly at the year, the head between two years where the year is. The chart's layer in
  the scene is time-remapped by the map's Data Time slider through a Layer Control, so retiming the
  slider retimes the chart with the map. Copying the slider's keys would have broken the moment the
  user moved one.
- **Labels keep apart.** Two lines that meet would write their names over each other; every label's
  expression places the heads of the lines ranked above it and moves below any it would touch. Areas
  are stacked with the largest at the bottom so the smaller ones stay in sight.
- **Tested.** Unit tests for the round axis, the years, the order and the dropped lines, a gap filled
  straight, the path at the first year, a quarter of the way and the end, the closed area, the head,
  the value text, the time remap clamped to the years, and two labels kept apart. 120 new ES3
  fixtures (1,305 in all), names written as ASCII escapes. DT2 adds an area chart in After Effects:
  no expression errors, three areas, the time following the slider, and every area holding the
  points of its year at the middle and at the end. The frame was looked at.



- **Why.** A table could only colour the map by amounts. Two of the most asked-for data maps could
  not be made: an election or an alliance map (a party, a bloc, a yes or a no per place), and a map
  that changes as the years go by (population 1990 to 2020, emissions per year).
- **Categories.** A text column with a few kinds (at most 40, each shared by several places) can be
  chosen under **Colour by**; a table of only names and categories is accepted as a table. Each
  category gets a colour of its own, the most common first (src/core/style/categories.ts), from
  one of three palettes: Okabe and Ito's set for colour-blind readers (its black swapped for a grey)
  as the default, a bold one and a soft one. Past the palette's length the rest share one quiet grey
  and one legend row, "Other (n)". The legend names each category; shapes from the table take their
  category's colour. Bubbles, spikes, numbers and the bar chart need amounts, so they are switched
  off for a table of categories.
- **Years.** src/core/data/series.ts reads both shapes tables come in: wide, a column per year (the
  World Bank and the UN), and long, a row per place per year with a year column (Our World in Data).
  A place's value at any moment is straight between the years around it and held before its first
  and after its last, so a gap in a table never flickers a country to empty.
- **How the years move.** A "Data Time" slider on the map layer, beside Borders Draw-on and the
  terrain sliders, is keyed from the first year at the comp's start to the last at its end, and can
  be retimed like any keyframes. The renderer reads it per frame like the other animated controls and
  sets the data layer's colours for that moment (seriesMatchAt); the frame cache keys on it, so a
  still camera over changing numbers renders every frame and nothing more. One scale spans every
  value of every year, so a colour means the same amount in 1990 and in 2020, and the legend holds
  for the whole move. **Add the year** puts a text layer on the scene that counts with the slider
  through a Layer Control.
- **Flows stay between places.** The search now knows seas and mountains (D77), and "Atlantis" in a
  flow table found the Atlantic by its Dutch name. A flow's ends are looked up among places only.
- **Tested.** Unit tests for the palettes, the order, "Other", colours of the user's own, tables of
  only text, years in headings and cells, wide and long tables, the value between years and beyond
  them, one scale over all years and the colour of any moment. DT2 renders a table of blocs and finds
  each country in its bloc's colour to the pixel, renders a wide table of three years and finds
  Bangladesh in the colour of 2000 on the first frame and of 2020 on the last, Nepal's missing 2010
  straight between its neighbours, all 25 frames drawn, and the year layer reading 2000, 2010, 2020.



- **Why.** Over a downloaded city the map had its streets, water and buildings but no names: Auto
  labels knew the world's cities and nothing smaller, and the rendered basemap carries no labels
  because renderer labels are not stable from frame to frame (S6, D8). A city map without its
  districts, its river, its landmarks and its main streets is a street plan, not a map.
- **Where the names come from.** The region archive on disk already holds them: the Protomaps layers
  places, pois, water and roads carry OpenStreetMap's names in the local language and many others.
  The panel reads the tiles under every frame of the move that is at zoom 11 or closer, at zoom 13
  (one zoom out for a move over a whole metropolis, at most 900 tiles), with a vector-tile decoder of
  its own in core (src/core/tiles/mvt.ts), checked against the reference decoder on 5,639 features of
  real Paris tiles. No new package, nothing online. Over central Paris this takes about 170 ms.
- **What is named.** src/core/labels/cityNames.ts: districts and neighbourhoods (spaced capitals),
  parks (a park green made to read on the land), landmarks, stations and airports (with a dot),
  campuses, the rivers and canals through town (italic, in the water colour) and the main streets
  (motorways to tertiary roads). Tiles repeat features at their edges and cut streets and rivers into
  pieces, so names are gathered per kind and words: a point once within a few hundred metres, a
  street or a river once per stretch of about two kilometres, on its longest piece. OpenStreetMap's
  plain name stands for the local language.
- **Along the line.** A street or a river is named along itself: two points either side of the name
  give its angle, and the text layer's rotation and position expressions project them on every
  frame (streetLabelExpressions), so the name turns as the map turns and tilts, stays upright, and
  stays centred on its line. Collisions use the box of the turned name at the median angle over the
  frames it shows in. Such a name has no English line under it.
- **A share each.** A city has more streets and sights than any frame has room for, and one queue
  filled every place with whichever kind ranked first (all landmarks, then after a change all
  streets). Each kind of city name now takes at most its share of the names (core/labels/budget.ts),
  the room left goes to the best of the rest, and the chosen names are placed a second time on their
  own so the names left out leave no holes.
- **Placing again.** A city name has no record in the world data, so its tag keeps where it stands
  and its two line points; placing names again after a template change moves city names too.
- **Switch.** **Streets and landmarks** under What to name, on by default; it only does anything
  over a downloaded area.
- **Tested.** Unit tests for the decoder (points, lines, polygons with holes, every value type,
  skipped layers), the classes, the names, the clustering of points and of cut streets, a river along
  its line and not again as an area, and the shares. 96 new ES3 fixtures for the street expressions
  (1,185 in all). LB5 labels a turning, tilting move over central Paris and checks districts,
  landmarks, stations, streets in French and the Seine, a rotation expression on every street and
  river name, within 90 degrees, following the map as it turns, and nothing unknown when placed
  again. The frames were looked at.



- **Why.** The bundled labels named countries and 7,101 cities and nothing else. A map of South Asia
  had no Bay of Bengal, no Himalaya, no Ganges; a globe had no oceans. These are the names a news or
  documentary map uses most, and Natural Earth has them, public domain, with names in the same 26
  languages as the rest.
- **Data.** tools/prepare-world-overlays.ts now reads the marine areas, the physical regions, the
  peaks and the named points of Natural Earth 10m (3.3 MB downloaded to .cache/ne), with the rivers
  and lakes already there: 2,899 names - 7 continents, 7 oceans, 288 seas, bays and straits, 865
  rivers, 377 lakes, 225 ranges, 62 deserts, 379 islands, 294 other regions, 388 peaks with their
  heights, 4 waterfalls and the poles. labels.json grows from 5.2 to 7.1 MB.
- **Where a name goes.** An area is named at its pole of inaccessibility, the point deepest inside it
  measured on the ground (src/core/geo/polylabel.ts), not its centroid, which for a bay or a crescent
  sea lies on land or outside it. A river is named halfway along its longest piece, and its pieces
  are one river when they share a Wikidata id (Natural Earth splits the Yangtze and the Mekong under
  several river numbers). Natural Earth gives an arm of a great river the rank of the river, so the
  Sulina branch of the Danube (70 km) was named on a globe: a river now waits for the zoom at which
  it is about 200 pixels long on screen, a lake for the zoom at which its longest side is about 60
  (the Nile from zoom 2.7, Baikal from 3.3, Lake Albert from 4.9). Every feature that lies in one
  country carries that country, so the local
  language names the Ganges in Hindi, the Sundarbans in Bengali and the Yangtze in Chinese; seas,
  oceans and continents follow the chosen language.
- **How it looks.** The conventions of printed maps (src/core/labels/nature.ts): water in italic, in
  the look's water colour made to read on its sea; oceans and continents in widely spaced capitals;
  ranges, deserts and regions in spaced capitals in the country colour sunk into the land; a peak with
  a small triangle and its height ("Mount Everest · 8,848 m"). Scripts without capitals or italics
  (Bengali, Arabic, Chinese and the rest) stay upright and unspaced, because slanting or spacing them
  only damages them. Both colours are unit-tested to read at 3:1 on every look.
- **Where it waits its turn.** A continent or an ocean claims its room before the countries, a sea or
  a range comes with the larger countries, and a river, lake or peak waits for the cities of its rank.
  A large sea can still give way to a large city whose name crosses it; it is dropped rather than moved,
  because a name that changed place during a move would jump.
- **Switches.** **What to name** in the Labels sheet: Countries, Cities, Seas and rivers, Mountains and
  deserts. The last two are on by default. A design of the user's own is for countries and cities; a
  sea keeps a plain name. The search finds the same features ("Bay of Bengal", "Everest") and flies to a
  zoom that frames each kind.
- **The comp's first and last frames.** Looking at the frames showed every name fading in on frame 0
  and out over the last 0.4 s, for cities as much as seas: the edges of a comp were treated as
  appearances. They are cuts. A name on screen when the comp begins is there in full on its first
  frame, and one still on screen at the end stays (opacityKeys in core/labels/placement.ts).
- **One measure.** Placing names again after a template change (D62) had its own copy of the sizing
  and would have dropped every natural name; both paths now use panel/labels/candidate.ts.
- **Tested.** Unit tests for the pole of inaccessibility, the styles, the colours on every look, the
  peak triangle surviving "no dots", the search and the edge fades. LB4 flies from the Bay of Bengal to
  Everest in After Effects: water names in an italic font and the water colour, ranges in spaced
  capitals, Everest with a three-sided polygon and "8,848 m", features in China named in Chinese with
  an English line, the Bay of Bengal in Bengali set upright in Nirmala UI, and nothing natural with
  both switches off. The frames were looked at.



- **What happened.** Duplicating a scene comp is daily work in After Effects: a second version of a
  shot, a cut-down, a vertical edit. Ctrl+D copies the map layer with its comment, so both scenes
  carried one map id and showed one map comp. The panel found only the first; a render of either
  drew the first scene's camera into the comp both show; and every lookup by id could land on the
  wrong scene.
- **Decision.** When the panel reads the map list and two map layers share an id, it separates them
  in one undo group (src/host/31-duplicates.jsx). The copy gets a new id, a duplicate of the map
  comp, and a footage item per pass imported from the same frames, so it looks exactly as before
  until it is rendered and its render never touches the original's footage. The panel's own layers
  in the copied scene (pins, names, lines, legend, credit, inset links) move to the new id with it.
  A map layer copied inside its own scene is separated the same way, but the scene's other layers
  stay with the original, because they were made for it.
- **Which one is the original.** A new map layer writes its own After Effects layer id into its tag;
  a copy carries that tag on a layer with another id. Maps made before this fall back to the lowest
  layer id, the oldest layer, and are then stamped the same way.
- **Undo is the user's.** The separation is one undo step. When Ctrl+Z brings a copy back, the panel
  notes it once and leaves it, instead of separating it again against the user's choice.
- **Frames a copy still shows are kept.** Until the copy is rendered it shows its original's frames,
  so the clean-up after a render now keeps every file any basemap footage in the project shows, not
  only this map's (`footageInUse`), and Renders on disk counts a folder the project's footage shows as
  in use. The folder checks also compare with a trailing separator now, so "base final 1" is not taken
  for "base final 10".
- **Tested.** DU1 renders every pass of a map with a pin, duplicates the scene, and checks the new id,
  the new map comp, separate footage items on the same frames and the pin moving with it; renders
  the copy with its own camera and checks the original's footage untouched; renders the original
  twice more and checks the unrendered second copy keeps all its frames; undoes a separation and
  checks the panel leaves it; and copies a map layer inside its scene and checks the pin stays with
  the original. Run with the old clean-up rule, DU1 fails with "the original's clean-up deleted 8
  sequences the second copy still shows".

## D75 — Renders made before a project was saved belong to it (2026-09-25)

- **What happened.** After Effects opened a project with eight missing files, one per render pass,
  all in the data folder. Those came from R1, which deletes its frames once the checks have read
  them (they are hundreds of megabytes) and left its comp behind, still pointing at them. Tracing it
  turned up a real hole of the same shape in the product.
- **The hole.** D45 took a folder in the data folder to be unreachable once its map was not in the
  open project, since an unsaved project cannot be reopened. But an unsaved project can be *saved*.
  Its map's footage keeps pointing at the data folder, while the next render went next to the
  project and drew everything again; and with any other project open, **Remove** under Renders on
  disk deleted the first project's frames. Opening it again showed exactly that dialog, for real.
- **Decision.** A map's renders stay in the folder they are already in, wherever that is
  (RenderStore.forMap looks next to the project first, then in the data folder), so saving a project
  never splits a map's frames or draws them twice. Every render of a saved project writes the
  project's path into its folder (`belongs to.txt`). A folder may go only when nothing can reach it:
  not a map of the open project, and not claimed by a project file that still exists
  (`canRemoveRender` in src/core/render/renderDiskRules.ts). A deleted project releases its frames.
  New maps of a saved project still render next to it, as before.
- **The tests tidy up.** R1 and R2 take their own scene, map comp and footage items out of the
  project before deleting the frames, in one undo group, and R1 checks that no footage of its map is
  left.
- **Tested.** A unit test holds the rule in its five cases. RD1 builds stand-in folders and a
  stand-in project file (nothing in the open project is touched): the saved map's next render stays
  in its folder and names the project, a new map goes next to the project, Remove takes only the
  unreachable folder, and deleting the project file releases the other. Run against the old code,
  RD1 fails six ways, among them "removing old renders deleted the frames of a saved project".

## D74 — Cities and the roads between them, so the band above the world map is not empty (2026-09-25)

- **Why.** A flight from the globe to a city passes through zoom 7, 8 and 9. The bundled world data
  carried coastlines, borders, rivers, lakes and place names, and a downloaded region starts at
  zoom 10 or so, so those three zooms showed the ground at its largest with the least on it: land,
  an outline and a few names. It is the worst place to be empty, because the viewer is closest.
- **Decision.** The world archive carries two more layers, from the same Natural Earth 10m data as
  the rest of it: **urban** (built-up areas, 792 shapes) and **roads** (motorways and, from zoom 6,
  the main secondary roads, 577 lines). Both are filtered by Natural Earth's own `min_zoom` and, for
  cities, by area, so a world view gets the few big ones and the band gets the rest.
- **No new tile zooms.** The tiles still stop at zoom 6 and the renderer overzooms them, which is
  what vector tiles are for: the same 792 shapes and 577 lines serve zooms 4 to 11 without a byte
  more. The archive grew from 13.4 MB to 15.7 MB, all of it geometry.
- **They arrive and they leave.** Cities fade in from zoom 4.5, hold from 6 to 8.5, and are gone by
  11; roads fade in from 5.5 and are gone by 11, and stop thickening at 10.5. Natural Earth's
  outlines are generalised: past zoom 10 a city is one flat shape filling the frame and a motorway
  is a line that sits beside the real one, so both hand over rather than stay. On a satellite look
  neither is drawn at all, because the picture already has them.
- **Tested.** WB1 renders the Rhine-Ruhr at zooms 5 to 11 twice, once with the two layers and once
  with them removed from the style, and counts the pixels that differ and by how much. Counting
  colours would not do: the city fill sits close to the land colour by design. The band reads 36.5 %
  of the frame at zoom 7, 52.9 % at 8 and 66.3 % at 9, against 10.0 % at zoom 5, and the strength
  falls from 4.70 at zoom 9 to 2.57 at 10 and 0 at 11.

## D73 — A satellite picture built from Sentinel-2, with nobody signing up (2026-09-25)

- **Why.** The plan's middle layer of imagery was missing: Blue Marble is the whole planet at half
  a kilometre a pixel, the national orthophoto services are street scale but only in a handful of
  countries, and everything in between was the user's own address. Ten metres a pixel, everywhere,
  is what a city map needs, and Sentinel-2 gives it away for any use with a credit.
- **Decision.** The panel reads the scenes itself. Element 84's open STAC catalogue says what was
  photographed over an area and how cloudy it was; Amazon's open bucket holds each scene's
  true-colour picture as a cloud-optimised GeoTIFF. Neither asks for an account, a key or a token,
  which is what makes this fit the free-forever rule. core/image/geotiff.ts reads the directories
  and decodes the deflate tiles (fflate, already here for PNG and PMTiles), so only the pieces of a
  scene the area needs are ever downloaded - a city at zoom 13 is a few megabytes, not the 300 MB a
  scene weighs.
- **The true-colour asset, not the raw bands.** ESA already writes a colour-corrected 8-bit picture
  (TCI) beside the raw reflectance bands. Using it means no band maths and no stretching to argue
  about, and it is what the agency itself considers the scene's true colour.
- **Each pixel from the clearest pass.** Scenes are taken clearest day first; a pixel is filled from
  the first scene that has real ground there, with Sentinel-2's own classification saying what is
  cloud, cloud shadow, snow or the black edge of a scene. A pixel the first pass lost is filled by
  the next one, so one cloudy day does not spoil an area.
- **The pieces are fetched before the painting, not during it.** A tile is 65,536 pixels; asking the
  network per pixel was measured at 25 s for nine tiles, and fetching every scene up front at 87 s
  and 13 MB. Fetching one scene's pieces, painting, and only opening the next scene if pixels are
  still empty took 18 s and 3.9 MB for the same nine tiles.
- **It is imagery of the user's own.** A built area is addressed as `satellite://<name>` and slots
  into the own-imagery layer (D59), so the render passes, the credit line and the opacity all work
  as they already did.
- **Tested.** Unit tests for the grid (against Snyder's own series, worldwide, within a centimetre),
  the GeoTIFF reader (a file written by the test, overviews included), the catalogue and the tile
  painting (cloud fallback, black edges, nothing invented for a tile no scene covers). SN1, online
  and only when named, builds a piece of Dhaka inside the panel and reads the archive back.

## D72 — The Earth Studio camera is read from its numbers, not from its script (2026-09-25)

- **Why.** Earth Studio is the one way a designer can legally put photoreal Google Earth imagery in
  a film: they render it themselves, under Google's terms. What they then need is for the panel's
  layers to sit on that footage, which means the panel has to know where their camera was. It was
  the last item left in Phase 4.
- **Decision.** The panel reads the JSON export, not the .jsx. The .jsx is an After Effects script
  that builds a comp, two helper nulls and a camera, and would have to be run and then read back;
  the JSON carries the same camera as plain numbers - per frame a latitude, longitude, altitude, a
  field of view and an After Effects rotation - which is what core/earth/earthStudio.ts turns into a
  view of ours. (Chrome also blocks a .jsx download as a script, which a user should not have to
  fight.)
- **What the numbers mean, checked against a real export.** Their Earth-centred positions sit on a
  sphere of 6,371,010 m: every frame and track point of a real export agrees within 3 m. The
  rotation is applied X then Y then Z and turns the camera's own axes into Earth-centred ones, with
  the camera looking down its own +Z; from it the panel takes the tilt from straight down and the
  way the camera faces. A track point's place is written as shares of a range, which read back as
  degrees and metres.
- **The scale is matched at the middle of the frame.** Their camera at altitude h, tilted by p, is
  h / cos(p) from the ground it points at, and covers 2 tan(fov/2) of that distance over the comp's
  height; the zoom that shows the same ground follows. A flat or gently tilted view lines up
  closely; a steep one over hills or towers will not, because they render true 3D and the panel
  renders a map, and the panel says so when the tilt passes 25 degrees.
- **Tested.** Unit tests read a file shaped as Earth Studio writes them, put a real export's first
  frame back on the sphere within 3 m, and take 256 camera orientations around the loop from view
  to rotation and back. ES1 imports a 60-frame flight that turns, tilts and descends, then reads the
  camera keys back out of After Effects and compares every sampled one with the view the file asks
  for.

## D71 — Scripts drive the panel through a folder, not through a port (2026-09-24)

- **Why.** A studio that makes forty maps a week wants them made by a script, and the paid tools
  offer that. After Effects itself cannot reach a CEP panel: a .jsx from the Scripts menu runs in
  another engine and cannot see the panel at all.
- **Decision.** The panel watches a folder in the user own data folder. A request is a small JSON
  file naming one call and its arguments; the panel answers beside it and removes the request. No
  port is opened, nothing listens on the network, and a request is data: the call has to be one of
  the names in src/panel/apiCalls.ts, so a file can never name a function of its own.
- **Off until it is turned on.** Anything that can write to the user folder could otherwise drive
  After Effects. The switch is in About, the setting is the user own, and turning it off stops the
  watcher at once.
- **The calls are the ones a person has.** Every call is something the panel already does, and each
  answers with what the panel said about it, so a script can log it. The panel does one thing at a
  time, so a call that arrives while it is busy is refused rather than queued behind the user.
- **Tested.** Unit tests for reading a request: a made-up call, a broken file, an id that is a path,
  and the bounds every argument is read within. U1 turns it on, asks for the version and the view
  from outside the panel, is refused a call that does not exist, and gets nothing once it is off.

## D70 — Numbers read from a file that keeps changing (2026-09-24)

- **Why.** An election night, a league table, a sales week: the numbers behind a map change while
  the map is being made. Importing the file again for every change, and setting the columns again
  each time, is the kind of work a tool should take.
- **Decision.** The panel remembers the path a table came from and watches its size and time every
  two seconds. A change re-reads the file, keeps the columns the user picked as long as the
  headings still fit, and colours the map again when it was already coloured. Polling, not a file
  watcher, because a spreadsheet writes through a temporary file and a watcher fires three times
  for one save.
- **The file is picked through After Effects, not the browser.** A dropped file in the panel has no
  path to go back to, so a new host call opens the file and gives the path with the text.
- **Tested.** U1 writes a CSV, watches it, colours the map, changes the file behind the panel and
  checks the table was read again with the new row and the fill followed.

## D69 — A feature browser, and what a shape can be made into (2026-09-24)

- **Why.** Everything the panel could do to a shape needed a click on the map or a search by name.
  That is fine for one country and useless for a hundred: a designer who wants every province above
  a million people, or every imported plot owned by one survey, had no way to ask for it. The paid
  tools answer this with a feature list, filters and a few geometry operations.
- **Decision.** core/data/featureList.ts holds the list, the filter and the sort as plain data, and
  src/panel/features.ts gathers the rows from what the panel already carries: the bundled countries
  and provinces, the downloaded district sets, the last import and the map own areas. A filter is
  one written line - a property, a test and a value - because a menu of operators would fill the
  panel and read worse. A feature without that property is left out rather than guessed at.
- **The operations are the ones that need no clipper.** Break apart, cut out (as a hole), count the
  points inside, and connect. Cutting works when the shape taken away lies wholly inside the one it
  comes out of - a lake out of a country, an enclave out of a state - which is what a map asks for;
  a shape that only partly overlaps is counted and left alone, not cut wrongly. A general polygon
  difference would need a clipping library the panel does not carry yet; it is a known limitation,
  not a silent failure.
- **Caps that keep a scene a scene.** Forty shape layers in one go, sixty connection lines (the
  core allows two hundred), the map own limit on areas. Everything left out is counted and said.
- **Tested.** Unit tests for the filter language, the sorting, the limits and the four operations,
  including that a half-overlapping shape is not cut and that a hole takes exactly its own area out;
  U1 opens the browser in After Effects, filters the countries by population, ticks them and builds
  the shape layers; FB1 breaks the Philippines into its 97 islands (their areas add up to the whole),
  cuts a hole and counts the points left inside it, and draws the mesh between four countries as six
  route layers whose paths After Effects evaluates without an error.

## D68 — The inset map is a map, not a picture of one (2026-09-24)

- **Why.** A locator inset is the oldest furniture on a map, and the one a viewer reads first: it
  says where in the world this is. Faking it with a still would leave it out of every look change,
  every render and every camera move.
- **Decision.** **Add inset map** builds a second real map in the same scene through the same
  builder as the first one (LML.map.addMapTo, pulled out of createMapComp for this), at the big
  map's centre and as many zooms wider as asked. It carries the same controls, the panel lists it,
  and it takes a look, names and a render like any other map.
- **The box is drawn from the big map's own controls.** A shape layer with two links - one to the
  inset, one to the map it follows - turns the big map's frame into mercator coordinates from its
  centre, zoom and bearing, and projects every point of it through the inset. So the box moves,
  turns and resizes on every frame, and bends when the inset is a globe. A pitched map is shown by
  its flat footprint, which is what a locator wants. The layer carries a mask the size of the inset,
  so a map that flies outside the locator does not draw the box across the scene.
- **Tested.** Unit tests check the box is the big map's frame at the inset's scale, that it moves
  the right number of pixels for two degrees east, and that turning the map 45 degrees widens its
  span by exactly the diagonal; 48 new fixtures run the path in the ES3 engine (1,089 expressions
  now); MF1 builds an inset in After Effects and reads back the box it works out.

## D67 — The map's furniture measures itself, every frame (2026-09-24)

- **Why.** A scale bar that is drawn once is a lie the moment the camera zooms, and a north arrow
  that is drawn once is a lie the moment the map turns. A map that animates needs furniture that
  animates with it, and the paid tools' users ask for both more than for almost anything else.
- **Decision.** Both are expressions on ordinary layers (src/core/ae/mapFurniture.ts), reading the
  map through the same Layer Control link as pins and routes. The bar is one path: a bracket the
  expression rebuilds every frame at the roundest distance (1, 2 or 5 times a power of ten) that
  fits the length it is given, with its text on a second layer parented to it. The arrow is a
  rotation.
- **Measured through the map layer, not from the zoom alone.** Metres per comp pixel comes from the
  Mercator ground resolution at the map's centre and is then carried through the map layer's own
  transform, so a map the user has scaled down or rotated still gets a bar that tells the truth.
- **North from two projected points, not from the bearing.** On a flat map north is the bearing
  turned back; on the globe, and near the poles, it is not. Projecting the centre and a point a
  hundredth of a degree north of it, and taking the angle between them in comp space, is right in
  both projections and follows the map layer's rotation as well. The letter under the arrow
  counter-rotates, so it stays the right way up while the arrow turns.
- **Tested.** Unit tests evaluate the generated expressions against the core maths at seven zooms
  and five latitudes, with a scaled and rotated map layer; 144 new fixtures run them in the ES3
  engine (1,041 expressions now); MF1 reads back what After Effects itself works out for the path,
  the text and the rotation, on a flat map, after a turn and a zoom, and on the globe at 78 north.

## D66 — The numbers as a bar chart, built in the comp (2026-09-24)

- **Why.** A choropleth says which place is darker; it does not say by how much. A chart does, and
  a motion designer who has to leave After Effects to build one in a spreadsheet loses the colours,
  the font and the timing that make it part of the film.
- **Decision.** core/style/chart.ts lays out the box, the bars and the growth frames from the same
  data fill the map is coloured by; the panel measures the text (only a browser can) and the host
  builds a precomp like the legend's. Each bar is a rectangle whose size and position are keyed
  together, so it grows from its left edge, and each starts a few frames after the one above it.
- **Longest first, eight by default.** A chart of two hundred countries is unreadable; the bars are
  sorted by value, the count is the user's, and the ones left out are counted and said. A place
  with no value gets no bar at all.
- **Tested.** Unit tests for the layout, the ordering, the stagger and the scaling; DT1 builds a
  chart in After Effects and checks the bar keys start at nothing, the longest bar is the largest
  place, the names and numbers are there, and removal takes the comp with it.

## D65 — The numbers drive shape layers, not only the rendered fill (2026-09-24)

- **Why.** The rendered data layer is one image: quick, and right for two hundred countries, but a
  designer cannot animate one country in it. The paid tools drive a shape layer's fill, stroke and
  opacity from a feature's property; that is what makes a data map feel hand-made.
- **Decision.** core/style/dataShapes.ts turns a data fill into a shape per place: the value's share
  of the span between the smallest and the largest sets the fill strength and the stroke width
  (the sheet sets what the largest is worth), and the colour is the step the choropleth would give,
  so the shapes and the rendered layer agree. Each becomes an ordinary shape layer through the same
  path builder as a highlight's outline (D30, D48), with its level of detail and its draw-on.
- **Capped at forty, largest first.** Every shape projects its points on every frame; forty is what
  keeps a 1080p frame under the budget (docs/PERFORMANCE.md). Places whose outline the panel does
  not hold - a district set that is not downloaded - are counted and said, not guessed.

## D64 — Labels from a comp of the user's own (2026-09-24)

- **Why.** The one thing a designer sees first in a map animation is the label: a box, a rule, an
  icon, a population line. A template of colour, size and halo cannot make that. This was the
  biggest thing the panel could not do that the paid tools can.
- **Decision.** Any comp in the project whose text layers contain `{field}` is a design (host
  `listLabelDesigns`; our own comps carry a tag and are never offered). Auto labels then duplicates
  that comp per place into a "LazyMapLayers Labels" folder, fills every `{field}` from the place's
  record, adds the copy as a layer, and sets its anchor point to the design's "Anchor" layer (or the
  comp's centre) so the place lands exactly there. The copy is scaled by the map's height, like
  every other size in the panel.
- **Placement is the same.** A design's box is its comp size, so the collision placement, the fades
  and the keep-out zones work as they do for plain names; the label carries the box in its tag, so
  a template change can place it again (D62) without opening the comp.
- **The design is the user's.** A restyle never touches a design label's look: what they drew is
  what renders. Removing the labels removes the copies as well, so a project does not silt up.

## D63 — The shaded slopes as their own pass (2026-09-24)

- **Why.** D8 left three passes out: labels, terrain shading and a selected-region matte. Labels
  became After Effects text layers (S6), so a label pass would be a picture of what the scene
  already has; a selected region is a highlight, and every highlight is its own pass since D26. The
  terrain shading was the one that was only waiting for terrain to exist, and it does (D28).
- **Decision.** The hillshade layer leaves the imagery group for a group of its own, `terrain`,
  which the land and water renders still draw (so those passes are unchanged) and which the new
  `terrain` pass draws alone, held out by buildings like any other ground pass. A map with no
  elevation pack has no layer in that group, so the render job drops the pass rather than importing
  an empty layer.
- **Left out for good.** A label pass (labels are AE text layers) and a selected-region matte (a
  highlight is already its own pass, with its own matte in its alpha).

## D62 — A template change places the names again, without choosing them again (2026-09-24)

- **Why.** D58 restyled the names already on a map but left them where they were, so raising the
  size could make two names overlap and the only cure was placing them again, which chooses a
  different set of names and loses the user’s density and language choices.
- **Decision.** After a restyle, the panel reads the placed names’ ids and the words in their tags,
  rebuilds their boxes at the new sizes, and runs the same `placeLabels` over the same cameras
  (panel/labels/repositionLabels.ts). Only positions and fades are written (host `moveLabels`), in
  batches of forty; nothing is created or removed, so the set of names, their words and their zoom
  bands are exactly what the user had. A name the placement can no longer fit gets no fade keys and
  stays hidden, and the log says how many.
- **Not done.** A name the world data no longer knows (an old project, a renamed place) is left
  where it is and counted, rather than guessed at.

## D61 — A look or a label template shared with every map in one click (2026-09-23)

- **Why.** Phase 6 left "a template is not shared between maps"; a project with three maps wants
  them to match. Sharing by copying the settings once is plain and undoable; a live link between
  maps would make one map's change silently alter another's render.
- **Decision.** "Use for every map" under the look writes this map's theme, look, details, layer
  style, relief, sky and imagery to every other map; under the names it writes the template and the
  keep-out zones and restyles the names already placed there, each map's template resolved against
  that map's own look. One host call per map, one undo step.

## D60 — A catalogue of open orthophoto services, checked one by one (2026-09-23)

- **Why.** The plan (P4) asked for a curated list of national open aerial imagery. With the address
  setting (D59) a service is just an address, a credit and its zooms, so the list is a list.
- **Decision.** core/style/imageryCatalogue.ts holds ten services, each checked on 2026-09-23 by
  fetching one tile (a JPEG came back) and reading the publisher’s terms: USGS The National Map
  (public domain), PDOK Luchtfoto (CC BY 4.0), swisstopo SWISSIMAGE (free under the FSDI terms,
  fair use), IGN BD ORTHO through the Géoplateforme (Licence Ouverte, WMTS without limit), GSI’s
  seamless photo (source stated; tiles from zoom 14, so the setting gained a first zoom), PNOA
  (CC BY 4.0 SCNE), basemap.at (CC BY 4.0, "Grundkarte: basemap.at"), ČÚZK’s Ortofoto ČR (open
  data under CC BY 4.0 since July 2023), Luxembourg’s BD-L-ORTHO (CC0) and Maa-amet’s orthophoto
  (CC BY 4.0; a TMS address counting rows from the south, so the setting gained {-y}). The entry carries the credit wording the publisher asks for and a link to the
  terms, and the log repeats both when a service is picked. Picking one is the user asking: only
  then are tiles fetched.
- **Left out, and why.** Denmark (a token is needed), North Rhine-Westphalia and Flanders (their
  WMTS answered with empty or refused tiles at the addresses tried), and any provider whose terms
  forbid use outside its own products. A service that changes its address stops working until the list is updated: the
  address field stays for that.

## D59 — Bring-your-own imagery: an address, not a provider (2026-09-23)

- **Why.** The one thing the panel could not show was a sharp aerial picture of a street: Blue Marble
  stops at zoom 5, the free open orthophotos are per country and the big providers forbid caching
  their tiles (D1, D18). The plan (P4) kept a way out: any XYZ, WMTS or PMTiles address the user
  supplies, under that source’s terms.
- **Decision.** One setting per map (core/style/ownImagery.ts): an https address with {z}/{x}/{y}
  or ending in .pmtiles, an attribution, an opacity, the tile size and an optional top zoom. It
  becomes a raster source and a raster layer of the imagery group, so it is in the base, land and
  water passes and never in a matte (OI1 checks the land matte stays white and clear). The layer
  goes after the last ground fill and before the first line; with downloaded areas the region
  fills move under it and the region lines over it, which only happens when the setting is on, so
  every other render stays as it was.
- **Nothing bundled, nothing stored.** The panel ships no address and no key; tiles are fetched
  while previewing and rendering and kept only in the renderer’s memory for the session. The
  attribution the user types is the credit (the map’s credit line, the scene’s credit layer).
  Because tiles come from the network, a render with the setting on needs it - the one case where
  a render goes online, and it is the user’s own address.
- **Tested offline.** OI1 serves magenta tiles from a Node http server inside the panel and checks
  the base pass over land and sea, the half-opacity blend and the credit; U1 uses an address that
  refuses, so no tile leaves the machine.

## D58 — A changed label template restyles the names already placed (2026-09-23)

- **Why.** Phase 6 left it undone: the template only shaped names placed after it changed, so a
  designer who tuned the look after placing names had to place them again and lose nothing but
  time. Names are ordinary text layers; changing their text documents is cheap.
- **Decision.** One function in core (`textStyle` / `dotStyle` in core/labels/restyle.ts) gives a
  label's style from the template, and both paths use it: placing names, and restyling them. The
  host lists a map’s label layers by their tag (label id and part); core plans the new text and
  style per layer; the host applies them in batches of forty, taking the scene out of the viewer
  while it does, like a build. Auto labels and the values of a data map are restyled together.
- **Capitals both ways.** The words a name was placed with go into its tag (`raw`) when it is
  built, so capitals can be taken off again; names placed before this keep the words they show.
- **Dots.** The template dropping dots removes them; wanting dots that were never made is counted
  and said, not done: a dot needs the place’s position, which only placing knows.

## D57 — No translations of the panel (2026-09-23)

- **Decision.** The panel stays in English only; the plan’s “translations (Bengali first)” is dropped.
  Sohan’s call: motion designers work in an English After Effects, the panel’s own words are few and
  plain, and every map already speaks the local language where it matters - the names on it.

## D56 — An update check that sends nothing, and a report the user posts himself (2026-09-23)

- **Why.** The plan (P9) asks for an update checker and a bug reporter. The rule is no telemetry:
  nothing about the person or the project may leave the computer without them doing it.
- **Update check.** One GET to GitHub's release list, at most once a day, with the panel's version in
  the user agent and nothing else; the newest version and the time are kept in the panel's own
  settings file, so a known newer version shows even offline, and "Later" silences that version.
  A switch on the Maps screen turns the check off, after which the panel never goes online by
  itself. Pre-releases and drafts are ignored.
- **Problem report.** A text file (versions, host, platform, the panel's last messages, the tail
  of the panel log) written to the user data folder, and the new-issue page opened in the browser
  with the versions filled in. The user reads the file and pastes it: they see what is shared.
- **Not done.** No crash upload, no usage counting, and no check of the data packs' versions.

## D55 — The look's details as knobs on the finished style (2026-09-23)

- **Why.** The plan (P7) left a style editor for the smaller details: road widths and label
  density. A full style editor (every layer, every property) would be a map design tool of its own
  and would break the promise that a look stays coherent; three knobs cover what designers ask for.
- **Decision.** Three settings kept with the map (core/style/lookDetails.ts): lines and roads as
  multiples of the look’s own widths (a quarter to three times), and names as fewer, as the look has
  them, or more. They are applied to the finished style, after the look and the regions, by group:
  line layers of the boundaries and water groups for lines, of the roads group for roads, symbol
  layers of the labels group for names (more room around each and a zoom later for fewer, the
  reverse for more). So every look takes them the same way, a look file stays a file of colours, and
  a style layer never needs to know about them. The preview and the render apply the same function;
  a changed detail changes the base pass’s key, so the map re-renders.

## D54 — Reverse geocoding from the bundled data, as a readout (2026-09-23)

- **Why.** The plan (P4) asked for reverse geocoding. Online services (Nominatim and the like) would
  break the offline rule and their terms; the panel already holds what a designer wants to know
  about a point: the nearest named place, the province, the country, and the district once it is
  downloaded.
- **Decision.** A readout under the pointer, refreshed a few times a second (90 ms after the last
  move): the coordinates, then the nearest place within about fifty screen pixels (the search
  index’s nearest-place lookup, larger places preferred), the district and the province the point
  lies in (point-in-polygon on the bundled and downloaded outlines), and the country the preview’s
  hit layer reports. A name that repeats its neighbour is dropped ("Dhaka · Dhaka Division" is
  kept, "Dhaka · Dhaka" is not). Over the sea it says so. Nothing is written anywhere: a pin still
  takes its place name the way it did (D49).

## D53 — A layer copied onto every place, sized by its number (2026-09-23)

- **Why.** Bubbles and spikes are the panel's shapes; a designer's map wants the designer's own
  artwork on every city, and doing that by hand is one attach per place. The plan’s “data-driven
  values” (P5) is this: a value driving the size of the user’s own layers.
- **Decision.** The layer selected in After Effects is duplicated once per place (host
  `copyToPlaces`), each copy named "Layer: Place", its Scale multiplied by a factor and then wired
  to its place through the same effects and expressions an attached layer gets, so the copies move
  with the camera and Unlink works on them. The factor is the square root of the value’s share of
  the largest (area stands for the value, as with bubbles), with a floor of a fifth so a tiny value
  still shows; not sized, every place gets a full-size copy. At most two hundred copies, largest
  first (core/style/copies.ts).
- **The original.** Left exactly as it is, selected or not; hiding it would be touching a layer the
  user did not ask to change. The log says so.
- **Places.** The joined table’s places (countries, provinces, districts) with their numbers when
  the map has a data fill, else the last import’s places, unsized - the same sources heat uses.

## D52 — Tables join to downloaded districts (2026-09-23)

- **Why.** Countries and provinces are bundled, so a table of them joins offline; districts are
  downloaded per country (D27), and a table of them had nowhere to go. A district map of one country
  is the commonest data map in local news.
- **Decision.** A third level of data fill, `district`, keyed by the downloaded units’ ids, with the
  country it belongs to. The join targets are the installed set’s unit names (the manifest already
  holds them for search); the fill renders the units with a number from the set’s polygons, as the
  provinces do from theirs; bubbles, spikes, values and heat take the units’ label points. Left to
  itself the join tries countries, then the provinces of the country the rows point at, then the
  districts of that country - or of every country whose districts are downloaded when the rows
  name no province - and keeps the level most rows fit, the coarser one when they tie. Asked for
  districts, it takes the best set; with none, it falls back and says so through the counts.
- **Not done.** No short codes for districts (the sets carry none). Since 2026-09-23 the Data sheet
  offers the download itself when a chosen country's districts are missing, and joins the table to
  them as soon as they arrive; the country stays chosen meanwhile.

## D51 — Heat as a render pass, not as layers (2026-09-23)

- **Why.** Bubbles and spikes are one group per place; a heat map is the sum of thousands of
  points, soft-edged, and its look depends on the zoom. Groups with blurred fills in After Effects
  would be slow past a few hundred places and would not add up the way heat should.
- **Decision.** The renderer draws the heat itself, as a layer of its own in the highlight group
  (`lml:highlight` = HEAT), so it becomes one render pass and one image sequence in After Effects,
  like the data fill (core/style/heat.ts, the world style). The points, with their weights scaled
  so the heaviest is 1, are a GeoJSON source; the colours run from see-through through the ramp
  the Data sheet has chosen, turned over on a dark look so the warmest spot is the palest. The pass
  is keyed by its points and settings, so changing them redraws that pass alone.
- **Sources of points.** The joined table's places with their numbers when the map has a data fill;
  otherwise the places of the last imported file, each counting 1. Places without a number, or
  with none, warm nothing. At most 5,000 points, heaviest first: the setting lives on the map
  layer's own comment line, like the polygons of custom areas, with a summary in the tag.
- **Legend.** Since 2026-09-23 the legend takes the heat as three steps - low, medium, high - in
  the ramp's colours, since its scale is a density and not a value; with a data fill as well, the
  heat's rows say "heat". Not measured yet: heat on the globe.

## D50 — Spikes: height stands for the value, rising up the frame (2026-09-23)

- **Why.** Bubbles show a value by area, which the eye reads roughly; a spike shows it by length,
  which the eye reads well, and a hundred spikes fit where a hundred circles would overlap. The
  plan (P8) lists spikes as one of the five map types.
- **Shape.** A spike is an isosceles triangle on a fixed base (12 px at 1080 lines), without an outline (on a base that narrow a stroke is all that shows), whose height
  follows the value linearly, with a floor so a tiny value still shows and a cap of two hundred
  spikes, largest first (core/style/spikes.ts). No square root: length is read straight, unlike area.
- **Up the frame, not up the globe.** Every spike rises straight up the comp from its place, on any
  tilt of the camera, as a billboard would. A spike rising along the globe’s normal would need a
  second projected point per spike on every frame and would lean out of the frame at the edges of
  a tilted view; a screen-up spike is cheaper, reads the same everywhere, and is how spike maps
  are usually drawn.
- **One layer.** Like the bubbles: one shape layer per map ("Spikes: column"), a group per place
  with the place’s position expression, the accent colour or the step colours of the data fill,
  tagged `spikes` so a rebuild replaces it and Remove finds it. The legend gains a third kind of
  swatch, a triangle of the spike’s own width and height, in the same column as the circles.

## D49 — Layers named after places; flows in step colours (2026-09-23)

- **Why.** A layer list of "Pin 1 … Pin 12" and "Route 3" says nothing about what is where; a
  designer renames every one by hand. Flows drawn only by width lose the smaller arcs on a busy
  map, and the data fill already has ramps and steps that could tell them apart.
- **Names.** A pin or a route end takes the nearest named place from the bundled place index when
  one is within about forty kilometres (placeNameAt in the store, the search’s own nearest-place
  lookup), so the host names the layer "Pin: Dhaka" or "Dhaka to Chittagong". A name used again this
  session gets a number ("Dhaka 2"), flat and 3D pins counting apart because their prefixes
  differ. Beyond that distance, or where the index has nothing, the old "Pin N" / "Route N" stays.
  Existing layers are never renamed.
- **Flow colours.** "In step colours" builds the same scale the data fill would (buildScale with the
  Data row’s ramp, steps and method) from the flow amounts and gives every arc, its comet and its
  arrow the colour of its step; off, every arc keeps the look’s accent colour. The ramp turns over
  on a dark look as the data fill does, so the largest flow reads as the brightest line. No second
  legend: the width legend already lists the amounts.

## D48 — Shape layers with two levels of detail (2026-09-22)

- **Why.** A shape layer held one thinned outline of 900 points across its rings, which is right
  at world zooms and blocky when the camera comes close. The plan (P6) asked for level of detail
  per zoom band, and Phase 5 had it as the one thing left.
- **Decision.** Every ring bakes two point sets into its path expression
  (lodPathExpression in src/core/ae/shapeExpressions.ts): the coarse set as before, and a fine set
  thinned to 3,600 points across the rings. The expression reads the map layer’s Zoom control and
  projects only the set in use, with the switch at zoom 5.5, so the fine outline costs nothing while
  the map shows the world. Two bands, not more: a third would double the baked text for little gain.
- **No jump at the switch.** Both sets come from the same polygons through the same topology-aware
  thinning, so the coarse points are a subset of the fine ones (95 % or more, unit-tested): at the
  switch the outline gains vertices where it was straight and never moves where it was.
- **Rings pair by order.** Both levels keep the same polygons in the same order; a ring that only
  one level has falls back to its coarse points, so a mismatch can never draw the wrong ring.
- **The bundled outlines had nothing finer to show.** SL1 found both levels of Bangladesh at 376
  vertices: prepare-countries.ts thinned every country to about 500 points, below the coarse budget,
  so the fine level was the same ring. The outlines are now built at about 1,600 points per country
  (413,000 in all, 7.4 MB instead of 2.5 MB; Bangladesh 1,719), which the coarse level thins and the
  fine level keeps. Rings whose two levels hold the same points are baked once.
- **Tested.** Unit tests for the expression and the subset property; 48 new fixtures run the
  levelled path in the ES3 engine on both sides of the switch (897 expressions now); SL1 reads the
  vertex count of a Bangladesh ring at zoom 6.4 and at zoom 4 and expects more when zoomed in.
