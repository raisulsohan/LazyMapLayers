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
