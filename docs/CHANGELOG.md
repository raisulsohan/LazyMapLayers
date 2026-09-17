# Changelog

## Unreleased — Phase 3: cinematic camera and the new panel

- **Shot list.** Build the camera from shots instead of keyframing five controls:
  - **+ Shot** adds the view in the preview. Each shot has a hold time and can orbit, push in or (on a
    globe) spin while it holds.
  - Between two shots sits a move: **Fly** (one continuous zoom-and-pan curve), **Straight**,
    **Along route** (the great circle between the shots, like an airliner; it can turn with the
    route) or **Cut**, with a duration, a flight height and an easing: Linear, Smooth, Cinematic, Soft
    start, Soft landing, Snappy or your own curve.
  - **Play** runs the camera in the preview in real time. Nothing renders and After Effects is not
    touched.
  - **Apply to timeline** writes the keys in one undo step, adds a marker per shot and makes the comp
    longer when the shots need it. Still holds get two keys instead of one per frame. Keys changed by
    hand are noticed before they are replaced.
  - The list is saved inside the project, on the map layer.
- **The preview is the frame.** The preview has the comp's shape and frames exactly what renders, at
  any comp size. Names and lines are enlarged to stay readable in a small panel; the frame button on
  the map shows them at the size they render instead.
- **Looks.** Six map looks, picked from the palette button and saved with the map: Midnight (deep navy
  with glowing coasts), Daylight, Atlas (a political map, every country in its own colour), Blueprint,
  Mono (neutral greys for grading) and Paper. One palette colours the world map, downloaded city
  regions, the globe's haze, animated borders and the labels made by Auto labels (dark text on light
  maps).
- **Satellite and relief.** Two optional imagery packs in the data folder, both from public-domain
  sources: **Satellite** (NASA Blue Marble, a seventh look; best for continents and countries, zoom 0
  to 5) and **Shaded relief** (Natural Earth; a checkbox in the Look sheet that lays mountains and
  valleys over the land of any other look). With imagery, the Land and Water passes carry the picture
  and the mattes still follow the land's outline exactly. The packs are built on the development
  machine for now; downloading them from inside the panel comes next.
- **Highlight countries.** Click the highlight tool and then countries on the map, or the highlight
  button next to a country in the search results. Each gets a colour; fill and outline are adjustable.
  Highlights render as their own **Highlight** layer above a basemap that stays clean, switched on, so
  in After Effects they can be faded, coloured or given a glow. Changing a highlight redraws only that
  layer, and removing the last highlight removes the layer.
- **Highlight any area.** Polygons in an imported KML or GeoJSON file (provinces, districts, a park,
  a shape of your own) are listed as areas: **Highlight** puts one on the same Highlight layer as the
  countries, holes included. The outline is thinned to 600 points and saved inside the project, so the
  file is not needed again.
- **Provinces, states and divisions built in.** 4,589 provinces of 251 countries (Natural Earth) are
  part of the panel: search finds them by name in 26 languages and frames them, the highlight button
  next to a result highlights one, and in the Highlight tool **Provinces** makes a click on the map
  pick the province under it instead of the country. Neighbouring provinces share exactly the same
  border, so two of them never show a gap. A country's outlines are read only when first needed
  (Bangladesh: 15 KB).
- Fixed: over a downloaded region a highlight lost its outline when zoomed in and sat under the
  region's land in the preview. Highlights now stay whole at every zoom, above the region, and a
  province or custom area always draws above a highlighted country.
- **Auto labels without waiting.** Names arrive in After Effects eight at a time with a progress count
  and a **Cancel** button, so it never blocks for more than about a second (the world flight's 140
  names: 14 seconds in all instead of 49 in one frozen call). **How many** picks Few, Normal or Many
  names (the most important first), and **Remove labels** clears them in one undo step.
- **Import GPX, KML and GeoJSON.** The import button reads a file and lists its lines (tracks, routes,
  outlines of areas) with their length, and its places. For every line:
  - **Fit** frames it in the preview.
  - **Draw** makes a route layer that follows the map and draws on with Trim Paths from the current
    time. Long tracks are thinned to 300 points, so After Effects stays quick.
  - **Draw + arrow** adds a traveller: an arrow that rides the tip of the line as it draws on and turns
    with it, under any camera. Its "Progress" slider counts along the line as drawn on screen, exactly
    like Trim Paths. For your own artwork (a plane, a car), parent it to the Traveller layer and switch
    the arrow's Contents off.
  - **Camera** adds shots that move the camera along the line (Shots tab; Play shows it at once).
  Places become pins with one click.
- **Search.** Countries and cities by name in 26 languages, and "lat, lng" coordinates, all offline.
  A country is framed whole; a city at a zoom that suits its size.
- **Automatic names.** New maps and shots are named after the place they show ("Paris Map").
- **New panel layout.** A header with the map's name and the render buttons, a row of tools (pin, 3D
  pin, callout, route, auto labels, borders, 3D camera), search above the map, keyframe, live link,
  Fly here and zoom under it, Shots and Render tabs, and a one-line status with the log behind it.
- **Tools.** Callouts and routes can now be added from the panel: click the tool, then the place.
- **Live link.** While on, moving the preview moves the map at the current time.
- **New map screen.** Name, size, frame rate, duration, basemap and globe in one step, into the open
  comp or a new scene. Maps can be renamed safely.
- **No waiting.** Applying 24 seconds of camera takes about 30 ms, also the second time: After Effects
  removes keys one at a time (over a millisecond each), so a control full of keys is replaced by a
  fresh one with the same name instead. Fly here uses the same path. Play starts at the move into the
  selected shot.
- **Render tab.** Finished renders of earlier sessions no longer come back in the queue; jobs that can
  resume still do.
- **Tests.** Unit tests for easing, fitting, route moves, the shot list and search; SH1 checks the
  shot list inside After Effects (every frame against core maths, key counts, cuts, markers, comp
  length, hand edits, a 40-shot list); U1 drives the new interface; TH1 renders a contact sheet of
  every look with the real renderer; SAT1 checks passes and mattes under satellite imagery; HL1
  checks the highlight layer pixel by pixel; RT1 imports a GPX track and checks the route and its
  traveller against core maths inside After Effects.

## 0.1.1 — works with the Legacy ExtendScript expression engine (2026-09-17)

- **Fixed.** In projects that use After Effects' Legacy ExtendScript expression engine (older
  projects, and new projects made from many project templates), every pin, label, route, callout
  and 3D camera expression failed with errors such as "does not have a value", and nothing followed
  the map. All generated expressions now run in both expression engines (DECISIONS D14).
  - Layers made by 0.1.0 in such a project keep their old expressions: run **Auto labels** or
    **World flight sample** again, and add pins, routes and callouts again.
- **Panel.** The log notes when a project uses the Legacy ExtendScript engine, which works but plays
  back more slowly than the JavaScript engine (File > Project Settings > Expressions).
- **Tests.**
  - `npm run check:expressions` runs 515 generated expressions of every kind in an ES3 engine and
    compares them with Node.
  - In After Effects, X1 checks every kind of linked layer in both engines (proven by a probe
    expression), and D1L builds and renders the whole world flight in a Legacy ExtendScript
    project: 324 expressions without errors, and frames identical to the JavaScript engine.
- **Release testing** on the development PC: `tools/release-test/` and `docs/RELEASING.md`.

## 0.1.0 — first release (2026-09-17)

The first release: everything below, from the foundation to the world flight, in one signed
installer for After Effects 2024 or newer. Tested on Windows 11 with After Effects 2026; the macOS
installer is included but has not been tried on a Mac yet.

### Milestone A (world flight)

- **Installer.** A signed package with double-click installers for Windows and macOS, a "Fix a blank
  panel" helper and uninstallers. No extension manager and no debug switch needed.
- **Panel buttons.**
  - **Auto labels** with a language picker: the local language with English subtitles, the local
    language only, or any of the 26 name languages.
  - **Animate borders** keys the borders to draw on over 4 seconds from the current time.
  - **World flight sample** builds the whole demo in a new scene. Without city regions it stays
    above Paris and Tokyo, and the log says which regions to download for the street-level ending.
  - **All downloaded regions** as a basemap choice.
- **4K framing.** The sample keeps the same shot at any comp height; pins and routes scale with it.
- **Data folder on macOS.** Regions, the render cache and the render queue live in
  ~/Library/Application Support/LazyMapLayers on macOS (%APPDATA%\LazyMapLayers on Windows).
- **Globe.** A **Globe** checkbox per map switches the preview and the renders to MapLibre's globe:
  a planet with an atmosphere and transparent space at low zoom, turning into the flat map between
  zoom 7 and 8.
- **Pins on the globe.** Pin expressions share one projection (Mercator and globe, with the
  transition) and hide pins behind the planet. With "Rotate with Map" on a globe, pins follow the
  local north.
- **Tests.** G1 (globe maths against MapLibre, CPU and rendered pixels) and G2 (globe pins in After
  Effects' own render).
- **Fly here.** Keys a smooth van Wijk–Nuij flight with Easy Ease from the camera at the current time
  to the preview view, one key per frame. The pitch fades out while the camera is high above both
  ends. Flights chain: the time indicator moves to the end.
- **World and regions in one map.** Downloaded OpenStreetMap regions sit on top of the offline world
  map and fade in once the frame fits inside them; several regions can be used together, and a wide
  region around a city hands over to the detailed city region inside it. Rivers and canals are drawn
  as lines, so no broken water polygons show at low zoom.
- **Animated borders.** A "Borders Draw-on" slider on the map layer draws country borders on, frame
  exact, in the renders.
- **Auto labels.** Country and city names in the local language (with English subtitles) as After
  Effects text layers, placed over the whole timeline without overlaps or flicker, with fonts picked
  per writing system.
- **Routes and callouts.** Great-circle routes that arc above the globe and draw on with Trim Paths;
  callouts with a leader line, a box, a title and a subtitle.
- **World flight demo** (`src/panel/demo/worldFlight.ts`, test D1): a 36-second globe-to-Paris-to-
  Tokyo flight with borders, labels, pins, callouts and a route. At 1080p it builds and renders in
  about 2 minutes; the 4K render takes about 2.5 minutes.
- **Cleaner city detail.** OpenStreetMap outlines tagged building=no (such as the outline around the
  Eiffel Tower's parts) are not drawn as solid blocks.
- **Development only.** The test automation that reads request files runs in development builds
  only.
- **Fixed.** Chained conditional operators in host scripts (ExtendScript evaluates them wrongly);
  the ES3 check now rejects them.

### Phase 2 (frame renderer and passes)

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

### Phase 1 (camera rig and pins)

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

### Phase 0 (foundation and spikes)

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
