# 🗺️ LazyMapLayers — Free Map Animation for After Effects

<p align="center">
  <img src="https://img.shields.io/badge/Adobe%20After%20Effects-2024+-9999FF?style=for-the-badge&logo=adobeaftereffects&logoColor=white" alt="AE Support" />
  <img src="https://img.shields.io/badge/CEP-12-FF5722?style=for-the-badge" alt="CEP Version" />
  <img src="https://img.shields.io/badge/Status-Early%20development-orange?style=for-the-badge" alt="Status" />
  <img src="https://img.shields.io/badge/License-MIT%20%C2%B7%20Free-yellow?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/Developed%20By-RaisulSohan-00E676?style=for-the-badge&logo=github" alt="Developer" />
</p>

<p align="center">
  <strong>Maps, flights, routes and data stories for motion designers, rendered frame-exact inside After Effects. Free forever: no account, no key, no trial.</strong>
</p>

Developed by **[Raisul Sohan](https://raisulsohan.com)** · Part of the Lazy suite · Free & open source ([MIT](LICENSE))

> **Status:** early development. There is no installer yet. See [docs/PLAN.md](docs/PLAN.md) for the roadmap and [docs/SPIKES.md](docs/SPIKES.md) for what has been proven inside After Effects so far.

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

## What works today

- **Offline world basemap.** Built from Natural Earth: countries (names in 26 languages), coastlines,
  boundaries, lakes, rivers and cities.
- **Frame renderer inside After Effects.** MapLibre GL JS renders 1080p frames in about 75–170 ms and
  4K frames in about 280–640 ms, including PNG encoding.
- **Region downloads.** Any area of the OpenStreetMap planet (Protomaps builds) is fetched with HTTP
  range requests into a local file, then rendered offline with 3D buildings.
- **Camera maths.** Our camera equals MapLibre's projection to within 0.00000003 px.
- **Map comp creation from the panel.** Tagged comps, camera controls and view keyframes, all
  undoable.
- **Render map.** The panel renders the basemap for every frame of the map comp and imports it as an
  image sequence, at preview or full resolution.
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
npm run verify                          # unit tests, typecheck, build, ExtendScript checks
npm run install:dev                     # link dist/ into the CEP extensions folder
npm run ae:spikes                       # optional: run the in-AE test suite (starts After Effects)
node tools/extract-region.ts --name paris --bbox 2.2,48.8,2.48,48.92 --max-zoom 15
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
docs/          plan, decisions, spike results, changelog
```

## Data and credits

- **[Natural Earth](https://www.naturalearthdata.com)** (public domain). "Made with Natural Earth."
- **[OpenStreetMap](https://www.openstreetmap.org/copyright)** data (ODbL), through the
  [Protomaps](https://protomaps.com) basemap builds. Maps that show OSM data must credit
  "© OpenStreetMap contributors".
- **[MapLibre GL JS](https://maplibre.org)** (BSD-3-Clause), **[PMTiles](https://github.com/protomaps/PMTiles)**
  (BSD-3-Clause), and the other open-source packages listed in `package.json`.

LazyMapLayers is an independent project. It is not affiliated with or endorsed by Adobe, Protomaps or
OpenStreetMap.

## License

[MIT](LICENSE) © Raisul Sohan
