# 🗺️ LazyMapLayers — Free Map Animation for After Effects

<p align="center">
  <img src="https://img.shields.io/badge/Adobe%20After%20Effects-2024+-9999FF?style=for-the-badge&logo=adobeaftereffects&logoColor=white" alt="AE Support" />
  <img src="https://img.shields.io/badge/CEP-12-FF5722?style=for-the-badge" alt="CEP Version" />
  <img src="https://img.shields.io/badge/Version-0.1-orange?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT%20%C2%B7%20Free-yellow?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/Developed%20By-RaisulSohan-00E676?style=for-the-badge&logo=github" alt="Developer" />
</p>

<p align="center">
  <strong>Maps, flights, routes and data stories for motion designers, rendered frame-exact inside After Effects. Free forever: no account, no key, no trial.</strong>
</p>

Developed by **[Raisul Sohan](https://raisulsohan.com)** · Part of the Lazy suite · Free & open source ([MIT](LICENSE))

> **Version 0.3** — looks of your own (or taken from a still of your film), numbers on the map from a CSV, any OpenStreetMap feature, editable shape layers and label templates. Features on the roadmap are still to come; see [docs/PLAN.md](docs/PLAN.md) for the plan and [docs/SPIKES.md](docs/SPIKES.md) for what has been measured inside After Effects.

## Install

Requirements: After Effects 2024 or newer, on Windows 10/11 or macOS. Tested on Windows 11 with After
Effects 2026; the macOS installer has not been tried on a Mac yet.

1. Download `LazyMapLayers-v0.3.zip` from the [Releases](https://github.com/raisulsohan/LazyMapLayers/releases) page and unzip it.
2. Close After Effects.
3. Windows: double-click **Install LazyMapLayers.bat**. macOS: double-click
   **Install LazyMapLayers (macOS).command** (if macOS refuses, right-click it and choose Open).
4. Start After Effects and open **Window > Extensions > LazyMapLayers**.

The package is signed, so no extension manager or debug setting is needed. If the panel opens blank,
run **Fix a blank panel.bat** (Windows) and restart After Effects.

**First map in a minute:** click **World flight sample**, then **Render**. For the street-level ending,
move the preview over Paris or Tokyo, click **Download this area…**, name the region `paris` or
`tokyo`, and build the sample again.

---

## Why another map tool?

Paid map plugins for After Effects work, but they are expensive, depend on paid data partners, and
still show their seams: blurry zoom steps, labels that pop, moves that stop halfway. LazyMapLayers is
built to be free **and** to give better final frames.

| | LazyMapLayers |
|---|---|
| Basemap | Every frame is rendered at its exact camera, so there are no tile steps, zoom cross-fades or shrinking labels. |
| Camera | One continuous zoom-and-pan curve (van Wijk–Nuij), globe to street level, pitch up to 85°, 3D terrain and buildings. |
| Compositing | Separate render passes: land, water, roads, boundaries, buildings, plus mattes. |
| AE layers | Pins, labels, routes and borders are real AE layers that line up with the rendered map to sub-pixel accuracy. |
| Labels | Placed over the whole timeline with collision checks and smooth fades. Arabic, Hindi, Bengali, Thai, CJK and every other script shape correctly. |
| Data | Offline Natural Earth world data, OpenStreetMap detail for any region you download, open terrain and imagery. |
| Undo | Every panel action is one Ctrl+Z. |

## What works today (0.3)

- **A look of your own.** Set the sea, the land, the lines and the names, and the rest of the map -
  roads, borders, buildings, parks, coasts, sky - is worked out from them, with the names kept
  readable on whatever land you chose. **From a picture** takes the palette of a still from your
  film; a look can be saved to a file, shared, and opened again, and Illustrator or Photoshop
  palettes (.ase, .act) open straight into one.
- **Numbers on the map.** A CSV with a country column (or one country's states and provinces) and a
  column of numbers colours every place it names as one layer, adds circles whose area is the value,
  writes the numbers as text layers, and builds a legend precomp. Places are found by name in 26
  languages, by ISO code, by a state's short code or by the map's own code; rows that match nothing
  are listed rather than coloured on a guess.
- **Any OpenStreetMap feature.** Type a name (or pick water, parks, islands, airports, boundaries,
  buildings, roads or railways) and the panel finds what OpenStreetMap holds for the area in the
  preview: a lake with its islands as real holes, a river, a district outline. It arrives as an
  import, so everything you do with a GeoJSON file works with it.
- **Label templates and keep-out zones.** One row sets the colour, size, halo, capitals and dots of
  every name, or takes them from a text layer you styled yourself; names can be kept out of the lower
  third, a top bar, or whatever your own layers cover while they are on screen.
- **Areas of your own.** Merge the highlights into one shape with the borders between them gone, grow
  or shrink them by a distance in kilometres, or drop a distance circle.

### From 0.2, and the work since

- **Shot list.** Build the camera from shots: **+ Shot** takes the view in the preview; between
  shots a Fly, Straight, Along route or Cut move with a duration, flight height and easing; **Play**
  runs it in the preview; **Apply to timeline** writes the keys in one undo step. The preview is the
  exact frame.
- **Looks.** Midnight, Satellite (NASA Blue Marble), Daylight, Atlas, Blueprint, Mono and Paper, with
  optional shaded relief; one palette colours the map, regions, the globe's haze, borders and labels.
- **3D terrain.** Download an elevation pack for an area (open data through Mapterhorn), then shaded
  slopes and real 3D mountains with the sky above the horizon; pins, labels and routes sit on the
  ground, and a keyed Terrain Height slider makes the mountains rise.
- **Highlights.** Countries, provinces (4,589 built in), districts (downloaded per country from
  geoBoundaries) and shapes from your own files, each rendered as its own layer above the basemap.
- **Export.** Save what is on the map back out as GeoJSON: pins, routes, outlines, callouts and
  highlighted areas.
- **Your own layers on the map.** Select your artwork in After Effects, click a place, and it stays
  there while the camera moves; Unlink puts it back as it was.
- **Shape layers.** Any highlighted country, province, district or imported area can be added to the
  comp as an editable After Effects shape layer: real paths that follow the map, with a fill, a
  stroke and an optional draw-on.
- **Search.** Countries, provinces, districts and cities in 26 languages, or coordinates, offline.
- **Import.** GPX, KML, KMZ, GeoJSON, CSV and shapefiles: routes that draw on (at the recorded pace
  of a GPS track if you like), a traveller that rides the line, pins for places, areas to highlight,
  and camera moves along a line.
- **Auto labels in batches.** Names arrive a few at a time with progress and cancel; three densities.

### From 0.1

- **Globe to street level.** A Globe checkbox per map: a turning planet with an atmosphere at low
  zoom that becomes the flat map by zoom 8, and **Fly here** keys one continuous flight to the
  preview view.
- **Auto labels.** Country and city names in the local language and script, with English subtitles,
  as editable After Effects text layers placed over the whole timeline without overlaps or flicker.
- **Animated borders, routes and callouts.** Borders draw on frame-exactly in the renders;
  great-circle routes arc above the globe and draw on; callouts with a leader line, title and
  subtitle.
- **Layered regions.** Several downloaded regions work together: a wide region hands over to the
  detailed city inside it, over the offline world map.

- **Offline world basemap.** Built from Natural Earth: countries (names in 26 languages), coastlines,
  boundaries, lakes, rivers and cities.
- **Frame renderer inside After Effects.** MapLibre GL JS renders 1080p frames in about 75–170 ms and
  4K frames in about 280–640 ms, including PNG encoding.
- **Region downloads.** Any area of the OpenStreetMap planet (Protomaps builds) is fetched with HTTP
  range requests into a local file, then rendered offline with 3D buildings.
- **Camera maths.** Our camera equals MapLibre's projection to within 0.00000003 px.
- **Map comp creation from the panel.** Tagged comps, camera controls and view keyframes, all
  undoable.
- **Render queue.** The panel renders the basemap for every frame of the map comp at its exact
  camera and imports it as an image sequence. Only frames that changed are drawn again, renders can
  be cancelled and resumed, and previews become After Effects proxies.
- **Final quality.** Up to 4× supersampling, motion blur that matches After Effects' shutter, and a
  10-second 4K move in about 30 seconds on a mid-range GPU.
- **Passes and mattes.** Land, water, boundaries, roads and 3D buildings as separate footage, plus
  land and water mattes, for grading and effects in After Effects.
- **Pins.** 2D pins follow the animated camera. In After Effects' own render they sit on the exact
  pixel the renderer draws (worst error 0.006 px at 1080p and 4K).
- **Matched 3D camera.** One click adds an After Effects camera that matches the map, so 3D layers
  and 3D pins sit on the ground as the camera moves (worst error 0.004 px).
- **Region download safety.** Tile estimates for each detail level, and warnings for large
  downloads and existing names.

## Development

Requirements: Windows or macOS, Node.js 24+, After Effects 2024 or newer with
`PlayerDebugMode = 1` for unsigned extensions.

```
npm install
node tools/prepare-natural-earth.ts     # needs the Natural Earth zips in .cache/ne (see the script header)
node tools/prepare-world-overlays.ts    # borders and names for draw-on borders, labels and search
node tools/prepare-admin1.ts            # provinces for search and highlights (ne_10m_admin_1_states_provinces.zip)
npm run verify                          # unit tests, typecheck, build, ExtendScript checks
npm run install:dev                     # link dist/ into the CEP extensions folder
npm run ae:spikes                       # optional: run the in-AE test suite (starts After Effects)
node tools/extract-region.ts --name paris --bbox 2.2,48.8,2.48,48.92 --max-zoom 15
node tools/package-zxp.mjs              # release: build, sign and zip (see docs/RELEASING.md)
```

Project layout:

```
CSXS/          extension manifest
panel/         panel HTML and CSS
src/core/      pure TypeScript: projection, camera, fly paths, tiles, PMTiles, PNG
src/panel/     panel UI, CEP bridge, MapLibre renderer
src/host/      ExtendScript (ES3), concatenated into dist/host/lazymaplayers.jsx
tools/         build, data preparation, region download, AE test automation
tests/         unit tests (node --test)
docs/          plan, decisions, spike results, changelog, release steps
```

## Data and credits

- **[Natural Earth](https://www.naturalearthdata.com)** (public domain). "Made with Natural Earth."
- **[OpenStreetMap](https://www.openstreetmap.org/copyright)** data (ODbL), through the
  [Protomaps](https://protomaps.com) basemap builds. Maps that show OSM data must credit
  "© OpenStreetMap contributors".
- **[NASA Blue Marble Next Generation](https://visibleearth.nasa.gov/collection/1484/blue-marble)**
  (public domain; NASA Earth Observatory) for the optional satellite imagery pack, and Natural Earth's
  shaded relief for the optional relief pack. Both packs are published as assets of the
  [Imagery packs release](https://github.com/raisulsohan/LazyMapLayers/releases/tag/imagery-1) and
  downloaded from the panel when you ask.
- **[geoBoundaries](https://www.geoboundaries.org)** (open release; each country's boundaries under
  their own open licence, shown in the panel before a download) for district boundaries, which are
  downloaded per country when you ask for them. Runfola, D. et al. (2020), geoBoundaries: A global
  database of political administrative boundaries, PLoS ONE 15(4).
- **[Mapterhorn](https://mapterhorn.com)** (open elevation tiles built from the Copernicus 30 m
  model and national open data, "© Mapterhorn"; the sources and their licences are listed at
  mapterhorn.com/attribution) for elevation packs, which are downloaded per area when you ask.
- **[MapLibre GL JS](https://maplibre.org)** (BSD-3-Clause), **[PMTiles](https://github.com/protomaps/PMTiles)**
  (BSD-3-Clause), and the other open-source packages listed in `package.json`.

LazyMapLayers is an independent project. It is not affiliated with or endorsed by Adobe, Protomaps,
OpenStreetMap, NASA, geoBoundaries or Mapterhorn.

## License

[MIT](LICENSE) © Raisul Sohan
