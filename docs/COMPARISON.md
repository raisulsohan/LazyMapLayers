# LazyMapLayers vs GEOlayers 3

Two map panels for After Effects, compared row by row: what each costs, how the picture is made,
what it can draw, and where each one is still ahead.

**LazyMapLayers 1.2** (12 Oct 2026) · **GEOlayers 3** as documented up to v1.19 · compared 12 Oct 2026.
A page version with filters is in [comparison/lazymaplayers-vs-geolayers.html](comparison/lazymaplayers-vs-geolayers.html)
(download it and open it in a browser).

✅ yes · ◐ partly · ❌ no. Of 37 rows, LazyMapLayers is ahead on 17, GEOlayers 3 on 3, and 17 are even.

| Pick LazyMapLayers when | Pick GEOlayers 3 when |
|---|---|
| the budget is zero and nothing may expire | you work on a Mac, or on After Effects older than 2024 |
| you work without internet, or want street detail anywhere with no subscription | you want Esri or Bing imagery built in |
| you need a globe, one smooth flight to street level, and crisp frames at every zoom | you want paid support and a long track record |
| you want 3D terrain and compositing passes without extra plugins | |
| you tell data stories (flows, prisms) or history (borders by year) | |

## Cost, licence and data

| | GEOlayers 3 | LazyMapLayers | Ahead |
|---|---|---|---|
| **Price** | ◐ Paid, one-time licence from aescripts. | ✅ Free and open source (MIT). | LazyMapLayers |
| **Map data** | ◐ Styled maps come from MapTiler Cloud: six months included, then a MapTiler subscription. | ✅ Open data only: OpenStreetMap, Natural Earth, Mapterhorn elevation, NASA, geoBoundaries. No subscription. | LazyMapLayers |
| **After the data period** | ◐ Styled maps, 3D buildings, multilingual auto labels and the water mask need the subscription; basic imagery such as Bing and CartoDB stays. | ✅ Nothing expires. | LazyMapLayers |
| **Account and key** | ◐ aescripts licence activation; a trial is available. | ✅ No account, no key, no trial. | LazyMapLayers |
| **Without internet** | ◐ Natural Earth search works offline; map imagery is fetched online. | ✅ The Full install (a 2 GB download) carries OpenStreetMap for the world to zoom 9, elevation, satellite and relief pictures, and every country's districts; street detail fetched once stays for offline work. | LazyMapLayers |
| **Disk space** | ✅ Small install; tiles are cached as you work. | ✅ Online about 50 MB, detail kept as maps need it; Light about 175 MB; Full about 2.1 GB to work offline. | Even |

## Picture and camera

| | GEOlayers 3 | LazyMapLayers | Ahead |
|---|---|---|---|
| **Basemap** | ◐ Raster tiles placed as layers; zoom levels cross-fade over a short blend. | ✅ Every frame is rendered at its exact camera: no tile steps, no zoom cross-fades, no shrinking labels. | LazyMapLayers |
| **Fly-to** | ◐ Zoom out, pan, zoom in, in visible phases. | ✅ One continuous zoom-and-pan curve (van Wijk–Nuij) from globe to street. | LazyMapLayers |
| **Globe** | ❌ Flat Web Mercator only. | ✅ A turning globe with atmosphere that becomes the flat map by zoom 8. | LazyMapLayers |
| **Camera pitch** | ◐ Up to 60°. | ✅ Up to 85°. | LazyMapLayers |
| **3D terrain** | ◐ Through third-party plugins: Helium, FreeForm Pro, Plexus or Mir. | ✅ Built in: open elevation, real mountains, sky above the horizon, a keyable Terrain Height slider. | LazyMapLayers |
| **3D buildings** | ✅ Extruded shape layers (Cinema 4D or ray-traced renderer). | ✅ Drawn by the renderer, also as a pass of their own. | Even |
| **Compositing** | ◐ A water mask comp. | ✅ Land, water, roads, boundaries and buildings as separate passes, plus land and water mattes. | LazyMapLayers |
| **Your layers on the map** | ✅ Pin layers to a place; an anchor layer lets overlays follow the map. | ✅ Attach your artwork to a place; a matched AE camera keeps 3D layers on the ground. | Even |
| **Renaming comps** | ◐ Rename map comps from the panel; a Repair button fixes broken expressions. | ✅ Links use layer controls, so a rename breaks nothing. | LazyMapLayers |

## Labels

| | GEOlayers 3 | LazyMapLayers | Ahead |
|---|---|---|---|
| **Auto labels** | ✅ One click, with collision checks and fades. | ✅ Placed over the whole timeline with collision checks, a minimum time on screen and no flicker. | Even |
| **Label languages** | ✅ Many languages through MapTiler's multilingual data. | ✅ Local script with an English subtitle, offline; search in 26 languages. | Even |
| **Label templates** | ✅ Any comp becomes a template with `{property}` fields. | ✅ Any comp becomes a template with `{property}` fields, plus a flag per country and keep-out zones. | Even |
| **Names along a curve** | ❌ Not available. | ✅ Street and river names bend along their line. | LazyMapLayers |

## Data and drawing

| | GEOlayers 3 | LazyMapLayers | Ahead |
|---|---|---|---|
| **File import** | ✅ GeoJSON, KML/KMZ, GPX, TCX, CSV, shapefile. | ✅ GeoJSON, KML/KMZ, GPX, CSV, shapefile. | Even |
| **OpenStreetMap features** | ✅ Overpass search over the current view. | ✅ Overpass search over the preview area, free. | Even |
| **Feature browser** | ✅ Filter, merge, subtract, mesh, points in polygons. | ✅ Filter in words, merge, cut, break apart, count points, connection lines. | Even |
| **Numbers on the map** | ✅ Data-driven shape styles; heatmap, choropleth and circle styles. | ✅ Colours, bubbles, spikes, heat, flows as arcs, prism maps in 3D, legend and bar chart. | LazyMapLayers |
| **Data over time** | ✅ Array values animate over the comp. | ✅ Years animate, with a line or area chart that follows. | Even |
| **Live CSV and scripting** | ✅ ExtendScript API with CSV watch. | ✅ Scripting API with CSV watch. | Even |
| **Arrows** | ✅ A dedicated arrow rig: taper, dashes, head size. | ✅ An arrow rig on any route: taper, a head on the tip (triangle, chevron or none), both ends, flowing dashes, an outline, each a keyable control. | Even |
| **Routes on roads** | ✅ Driving routes from a routing service. | ✅ By car, bicycle or on foot over OpenStreetMap's roads, found by its own router: no service, account or key, and kept for offline use. | Even |
| **Imagery sources** | ✅ Esri, Bing, CartoDB, any XYZ or WMS server, local tile folders. | ✅ Any XYZ, WMTS, WMS or PMTiles address, local tile folders and MBTiles files; 17 open government services listed. No Esri or Bing built in. | Even |
| **Free satellite picture** | ◐ Bing aerial; MapTiler satellite with the subscription. | ✅ Sentinel-2 at 10 m a pixel, built cloud-free, no account. | LazyMapLayers |
| **Historical borders** | ❌ Not available. | ✅ 56 moments from 123,000 BC to 2010, with a keyable History Year slider. | LazyMapLayers |
| **Google Earth Studio camera** | ❌ Not available. | ✅ Imported frame by frame from Earth Studio's JSON. | LazyMapLayers |
| **Inset, scale bar, north arrow** | ✅ Included as scripts. | ✅ Built-in tools; the inset is a real second map. | Even |
| **Linked maps** | ✅ One map comp can follow another. | ✅ One map can take another's camera. | Even |

## Platform and support

| | GEOlayers 3 | LazyMapLayers | Ahead |
|---|---|---|---|
| **After Effects versions** | ✅ Back to CC 2015 (see the compatibility tab on aescripts). | ◐ 2024 or newer. | GEOlayers |
| **macOS** | ✅ Windows and macOS. | ◐ Experimental: not yet run in After Effects on a Mac; CI builds, tests and runs the installer on macOS. | GEOlayers |
| **Street detail anywhere** | ✅ Any city at street level, online, with the subscription. | ✅ Any city at street level, online: only the tiles the frames need are fetched, free, and kept for offline use. | Even |
| **Support** | ✅ aescripts support tickets and years of tutorials. | ◐ GitHub issues and Discussions, a FAQ, a Self-test that fills in the report, a 40-chapter manual and video tutorials; one developer. | GEOlayers |

## How this was put together

Written by the author of LazyMapLayers, so read it with that in mind. The GEOlayers 3 rows come from
the aescripts product page, MapTiler's guide, the aescripts forum and the help that ships with
GEOlayers 3 up to v1.19. Later versions may have changed things, and today's price is on the aescripts
page. If a row is wrong, please [open an issue](https://github.com/raisulsohan/LazyMapLayers/issues)
and it will be corrected.

- [aescripts: GEOlayers 3](https://aescripts.com/geolayers/)
- [MapTiler: maps for After Effects via GEOlayers 3](https://docs.maptiler.com/guides/maps-apis/maps-platform/maptiler-cloud-maps-for-adobe-after-effects-via-geolayers-3-plugin)
- [aescripts forum: GEOlayers map data](https://aescripts.com/forums/discussion/2017/geolayers-mapdata)
- [ToolFarm: GEOlayers 3](https://www.toolfarm.com/?p=13904)

GEOlayers is a product of Markus Bergelt, sold through aescripts + aeplugins. LazyMapLayers is an
independent project, not affiliated with either.
