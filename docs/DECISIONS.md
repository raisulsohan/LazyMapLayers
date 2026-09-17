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
  lower-detail regions around a city fill that stretch (to be supported as tiers).
