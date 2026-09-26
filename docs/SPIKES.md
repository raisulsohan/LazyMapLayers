# Spike and in-AE test results

Machine: Windows 11, After Effects 2026 (26.5x89), CEP 12.0.1 (Chromium 99.0.4844.84), NVIDIA GeForce
RTX 3070 (ANGLE, Direct3D 11). Run with `npm run ae:spikes` (`tools/ae-spikes.mjs`), which starts After
Effects, runs the host spikes, opens the panel, runs the renderer spikes and quits. R2 is long and
only runs with `-- --only R2`.

Last full offline run: 2026-09-23, after D49-D61 (spikes, heat, district joins, layer copies, the readout, look
details, the update check, label restyling, the heat legend, imagery of the user's own): H1, P1, C1, E1, X1, R1,
G2, D1, SH1, TH1, SAT1, HL1, LB1, LB2, LB3, RT1, SL1, AT1, ST1, DT1, LK1, FL1, HT1, OI1 and U1 all pass on the dev
build.

## The in-AE tests, and what each one settles

Every one of these runs inside After Effects through `npm run ae:spikes -- --only <ID>`. The five
that go online run only when they are named.

| Id | What it settles | Result |
|---|---|---|
| H1 | The host API through the real panel bridge | PASS 9/9 |
| P1, C1 | Pins and the matched 3D camera against the camera maths | 0.0061 px worst, 0.004 px in 3D |
| E1, X1 | After Effects' own render, and both expression engines | 20/20; 21 expressions, both engines |
| R1, R2 | The renderer, its passes and a 10-second 4K move; both take their map out of the project before deleting its frames | 17/17; no pops (measured again 2026-09-24: 88 ms per frame) |
| G2, D1, D1L | The globe, and the world flight demo at 1080p and 4K | PASS |
| SH1 | The shot list: 601 frames match the core maths, Apply in ~30 ms | PASS |
| TH1, SAT1 | Every look, with and without the imagery packs | PASS |
| HL1 | Highlights as their own render pass, one layer each | PASS |
| LB1 | Auto labels in batches: no call longer than about a second | PASS |
| LD1 | Labels from a comp of your own: the design is found with its fields and anchor, a copy per place with the fields filled, and the copies go with the labels | PASS |
| LB2 | The label template: colour, size, halo, capitals, dots, a style picked up from a layer, and the names already placed restyled (capitals on and off again) | PASS |
| LB3 | Keep-out zones: 42 names in the lower third become 0, and only while the zone holds | PASS |
| RT1 | Imported routes, travellers and recorded pace | PASS |
| SL1 | Outlines as editable shape layers: the drawn shape covers the rendered country to 98 % | PASS |
| AT1 | Your own layers attached to a place: 0.008 px, and Unlink puts them back; a layer copied onto three places, each copy sized by its number and on its place to the pixel, the original untouched | PASS |
| ST1 | The style of the generated layers, and the callout font | PASS |
| DT1 | Numbers on the map: the join (countries, states, downloaded districts), the colours in the rendered pixels, bubbles and spikes 0.000 px off their places, the numbers as text layers, and the legend | PASS |
| OI1 | Imagery of the user's own: tiles served on this computer drawn over land and sea in the base pass, blended at half opacity, kept out of the mattes, credited | PASS |
| HT1 | Heat: weighted points rendered as their own pass, warm at the points, nothing away from them, the heaviest the warmest, the layer named after the column, and a three-step legend | PASS |
| LK1 | A look of your own in the rendered pixels (sea 58,13,82 for #3a0d52), and a look from a picture | PASS |
| MF1 | The map's furniture: a scale bar that measures itself every frame, a north arrow that turns with the map, a graticule | PASS |
| FB1 | The feature browser: what is under the view, listed and searched, and turned into pins, names, highlights or shape layers; half a real country clipped off with nothing left west of the cut | PASS |
| ES1 | A Google Earth Studio camera read from its exported numbers: 256 orientations round-tripped, the comp built to the render's size, length and frame rate, track points placed as pins | PASS |
| WB1 | Cities and roads fill zooms 7 to 9: 36.5 %, 52.9 % and 66.3 % of the frame against 10.0 % at zoom 5, and gone by 11 | PASS |
| LB4 | Names of the natural world from the Bay of Bengal to Everest: italic water names in the water colour, ranges in spaced capitals, Everest with a triangle and 8,848 m, local-language names with an English line, Bengali upright and shaped | PASS |
| LB5 | Names inside Paris from the region's own tiles: districts, landmarks, stations, parks, the Seine and 18 streets, street and river names turning with their line and the map, upright, kept when placed again | PASS |
| DT2 | Categories and years: blocs in their palette colours to the pixel; Bangladesh in its 2000 colour on the first frame and its 2020 colour on the last, Nepal between its years, all 25 frames drawn; the year layer counting 2000, 2010, 2020; an area chart whose time follows the slider and whose areas hold the points of their year | PASS |
| DT3 | Prism maps: the same numbers rendered flat and raised over a tilted South Asia; the raised data pass covers 176,514 pixels against 67,169 flat, a prism stands above India where the flat map has nothing, and the prisms render on the globe | PASS |
| DR1 | A drawn path becomes a route: a curved Pen path in a moved, scaled and turned group on a turned layer and a mask on a solid, read at 1 s while the camera moves, come back as Dhaka to Chittagong (within 1e-6 degrees, the curve kept) and an area around Dhaka; the route made from them lies on the drawing at 1 s (0.0002 px) and on the map at 0 s (0.0007 px); a line on a globe comes back as Dhaka to Tokyo; nothing selected gives a message | PASS |
| LD2 | Pictures in a label design: India, Bangladesh and Nepal each wear their own flag (by code, by short code, by name) fitted at 30 %, every other country with the field off, one footage item per picture | PASS |
| DU1 | A duplicated scene gets its own map: new id, map comp and footage on the same frames, pins moved with it, the two render apart, the unrendered copy keeps its frames through the original's clean-up, Undo is left alone (fails on the old clean-up rule) | PASS |
| RD1 | Renders on disk: a map rendered before its project was saved keeps its folder and names the project; Remove takes only what nothing can reach (fails six ways on the old code) | PASS |
| U1 | The real panel, driven through DevTools: every sheet and tool | PASS |
| DS1, TR1, IM1, OSM1 | Online: districts, elevation packs, imagery packs, OpenStreetMap features | PASS |
| GC1 | Online: OpenStreetMap search from the panel, Rue de Rivoli in Paris and Gulshan 2 in Dhaka a second apart, the same search answered again from the disk | PASS |
| SN1 | Online: a Sentinel-2 satellite pack built for an area, 5 tiles of Dhaka in 6-14 s each | PASS |

## X1 — Both expression engines in After Effects: PASS (2026-09-17)

- **Why.** Release 0.1.0 failed in a project from a template that uses the Legacy ExtendScript
  expression engine: its const and arrow-function expressions did not parse (D14).
- **Test.** `src/panel/engineTests.ts` builds a 3-second globe map with 2D pins (scale and rotation
  with the map), a 3D camera and a 3D pin, a route, a callout and auto labels. Every expression is
  read at 5 times with the JavaScript engine, then the project is switched to the Legacy ExtendScript
  engine, every expression is set again (After Effects keeps expressions compiled by their original
  engine) and read again. A probe expression (`typeof [].map`) proves which engine ran each pass.
- **Result.** 21 expressions of 8 kinds: no errors in either engine, worst difference 0.0000000001,
  identical rendered frames. With the 0.1.0 expressions the same test fails in the Legacy
  ExtendScript engine with errors like the ones seen in the release test.
- **Also.** `npm run check:expressions` runs 515 generated expressions in JScript (an ES3 engine) and
  matches Node; it rejects the 0.1.0 expressions too.

## D1L — The world flight in a Legacy ExtendScript project: PASS (2026-09-17)

- The whole D1 demo built in a project switched to the Legacy ExtendScript engine, with the minified
  release code: built in 39 s, 900 frames rendered in 52 s.
- All 324 expressions in the scene evaluate without errors. The 15 saved frames match the
  JavaScript-engine D1 frames (mean difference at most 0.001 of 255).
- P1, C1, E1 (40/40 and 20/20), G2 and D1 pass again with the ES3 expressions; X1, G2, E1 and D1
  also with the minified build.

## D1 — Milestone A world flight at 1080p and 4K: PASS (2026-09-17)

- **What it builds.** `src/panel/demo/worldFlight.ts` (also the panel's **World flight sample**
  button) makes a 36-second, 25 fps globe map: the globe turns while country borders draw on, one
  continuous flight goes down to the Eiffel Tower, a slow orbit shows a pin and a callout, a second
  flight goes to Tokyo Tower along a great-circle route that draws on, and a second pin and callout
  end the move. Country and city labels in the local language are placed over the whole timeline.
- **Data.** The offline world map plus four downloaded OpenStreetMap regions used together:
  paris-wide (zoom 12), paris (zoom 15), tokyo-wide (zoom 12) and tokyo (zoom 15). The wide regions
  hand over to the city regions (D13).
- **1080p.** Built in 30–56 s: 140 labels (324 text, subtitle and dot layers, chosen from 7,359
  candidates), a route, 2 pins and 2 callouts, no expression errors. All 900 frames rendered with 2×
  supersampling in 30–53 s. After Effects' own render was saved at 15 moments and reviewed, before and
  after purging its image cache (identical files).
- **4K.** The same move at 3840×2160 keeps the 1080p framing (`zoomOffset = log2(height / 1080)`, with
  pins and routes scaled by height). The 900 frames rendered in 132–142 s, 158–169 ms per frame.
- **Release code.** With the minified release build (`node tools/build.mjs --dev --minify`), R1
  (15/15), G2 and D1 pass again: D1 built in 29 s with no expression errors and rendered its 900
  frames in 37 s (43 ms per frame).
- **Review.** Globe with labels in each country's own script and no labels outside the planet; the descent to Paris without empty zooms or floating region patches; the Eiffel
  Tower in 3D with its callout; the route arc across Asia; Tokyo's towers at arrival with the 東京
  callout.

## G1 — Globe projection against MapLibre: PASS (2026-09-17)

- `src/core/camera/globe.ts` projects points for MapLibre's globe projection: a vertical-perspective
  globe up to zoom 7, mixed in clip space with Mercator between zoom 7 and 8 (as MapLibre's shaders
  do), and flat Mercator from zoom 8 (D11). Points can sit above the ground, and points behind the
  planet are reported hidden.
- **CPU.** 268 random globe views (zoom 1 to 7, any bearing, pitch up to 60°) against
  `map.project()`: worst error 0.000000000007 px.
- **GPU.** 57 renders of a red dot, half of them in the transition zooms, where `map.project()` does
  not mix like the shaders: the dot centre found in the pixels is within 0.19 px of the core
  projection (0.13 px in the transition; centroid noise).

## G2 — Pins on a globe map in After Effects' own render: PASS (2026-09-17)

- A 1280×720 globe map turns from the Atlantic to Europe, then flies down to Paris through the
  transition (zoom 7.5), on to zoom 11.5 and ends at zoom 12.6, pitched 50°. Seven pins (Paris,
  London, Cairo, New York, Tokyo, São Paulo, Versailles) use the shared projection expression
  (`src/core/ae/projectionExpression.ts`).
- At 8 times, every shown pin (22) sits on the red dot the renderer drew, and every pin hidden behind
  the planet (6) has no dot under it. No expression errors.

## R1 — Phase 2 renderer in After Effects: PASS 15/15 (2026-09-17)

`src/panel/renderTests.ts`. A 1920×1080, 4-second map comp over Paris (OpenStreetMap region, 3D
buildings) holds a view for 1 s, moves to a pitched view by 3.5 s and holds it. Every render goes
through the real render job (`src/panel/render/renderJob.ts`) and import (`LML.api.importPasses`).

| Check | Result |
|---|---|
| Holds render once | 100 frames, 64 drawn (26 + 12 held frames collapse into 2) |
| First render, all 8 passes, 2× supersampling | 206–245 ms per drawn frame, 13.5 s in total |
| One layer and one footage item per pass | 8 and 8; passes stacked in order, only the basemap switched on |
| Data credit | "© OpenStreetMap contributors" text layer added to the scene |
| Land and water mattes | cover every pixel exactly once (0 errors) |
| Colour passes | roads 25 %, buildings 57 %, land 96 %, water 5 % of the frame |
| Ground passes rebuild the basemap | 99.4 % of building-free pixels within 3 per channel |
| Pops in the base sequence | none |
| Unchanged re-render | 0 frames drawn, 0.4 s |
| Keyframe change at 3.5 s | 63 frames drawn (exactly the frames whose camera changed), 37 reused |
| Preview after a final render | becomes the footage's After Effects proxy, switched on |
| Final render with the same move | keeps the proxy, switches it off |
| Motion blur, 8 samples | moving frames change (mean difference 8.4), held frames identical and reused; 306 ms per frame |
| Cancel after 15 frames, render again | cancelled cleanly; the resumed render drew 49 of 64 |
| GPU box filter against the CPU reference | worst channel difference 1 (rounding) |

## R2 — 10-second 4K move: PASS (2026-09-17)

- **Move.** 3840×2160, 25 fps, 250 frames over Paris: zoom 12.2 (flat) to zoom 15.4 (bearing 40°,
  pitch 60°) by 6 s, then an orbit to bearing 100°, pitch 65° by 10 s, with easy ease.
- **Speed.** 2× supersampling (a 7680×4320 canvas): **125 ms per frame**, 31 s for the whole move,
  including camera sampling, encoding in workers and import.
- **Pops.** None. The frame-to-frame change curve is smooth (largest change 17.4 of 255).
- **Keyframe change.** Changing only the 10 s keyframe redrew 99 frames and reused 151: exactly the
  frames after 6 s.
- **Known.** Small steps in the change curve remain where tiles switch zoom level (new minor roads
  and small buildings appear). They are below the pop threshold; smoothing them is noted in D10.

## S3 — Complex scripts in AE text layers: PASS (2026-09-17)

- `ComposerEngine.UNIVERSAL_TYPE_ENGINE` can be set from ExtendScript, and it reads back.
- 11 scripts shape correctly with Windows system fonts, checked visually in a rendered frame:

  | Script | Sample | Font |
  |---|---|---|
  | Latin | Paris · São Paulo · Zürich | Segoe UI |
  | Arabic | القاهرة (joined, right to left) | Segoe UI |
  | Hebrew | ירושלים | Segoe UI |
  | Devanagari | नई दिल्ली (conjuncts) | Nirmala UI |
  | Bengali | ঢাকা চট্টগ্রাম ক্ষ্ম (conjuncts) | Nirmala UI |
  | Tamil | சென்னை | Nirmala UI |
  | Thai | กรุงเทพมหานคร | Leelawadee UI |
  | Myanmar | ရန်ကုန် | Myanmar Text |
  | Chinese | 北京 | Microsoft YaHei |
  | Japanese | 東京 | Yu Gothic |
  | Korean | 서울 | Malgun Gothic |

- **Timings.** Creating 500 text layers took 12.2 s, about 24 ms per layer. Measuring all 500 with
  `sourceRectAtTime` took 0.2 s.
- **Measuring glitch.** In one of five runs, the first Bengali layer measured 0 × 0 even though it
  rendered correctly in the saved frame. The label engine must retry a zero-size measurement of
  non-empty text (`tools/ae/spikes.jsx` retries 20 times, 50 ms apart).
  - Seen again in a full run on 2026-09-17 despite the retries: a 1-second retry window is not
    enough every time. The label engine (Phase 6) needs a longer, event-driven wait, or a fallback
    that measures after the first render.
- **Consequence for labels.** Measure label text in AE, then do collision and placement in core. It
  is cheap enough to measure every candidate. Create layers only for labels that survive placement,
  and batch the creation behind a progress bar.

## C1 — Matched 3D camera in After Effects: PASS (2026-09-17)

- **Rig.** `src/core/ae/cameraRig.ts` generates the expressions and `LML.api.addCameraRig` builds
  the layers:
  - "Map Camera Target": a 3D null at the ground position of the view centre, rotated by the
    bearing, and linked to the map layer through a Layer Control effect.
  - "Map Camera": a one-node camera parented to the null. It sits at local
    `(0, D·u·sin p, −D·u·cos p)` with X Rotation = pitch and Zoom = D, where
    `D = map height / 2 / tan(fov / 2)` and `u = 2^(reference zoom − zoom)`.
  - The ground plane is the scene's z = 0 plane at a fixed reference zoom. Its origin is stored
    float32-exact on the map layer as "3D Origin Latitude/Longitude" and "3D Reference Zoom".
  - Everything reads the map controls, so the camera follows every keyframe.
- **3D pins** (`addPin` with `threeD`) are 3D shape layers on the ground plane. An
  "Altitude (m)" slider lifts them at MapLibre's metre scale.
- **Test.** `src/panel/cameraAlignment.ts` animates New York from zoom 13.4 (bearing −29°,
  pitch 40°) to zoom 16.9 (bearing 70°, pitch 72°). It adds the rig and 18 3D pins, a third of
  them 30–400 m above the ground. It then reads where AE's own camera projects each pin through
  `toComp` in an expression.
  - Ground pins are compared with the core projection (MapLibre's camera, see S2a).
  - Lifted pins are compared with the rig maths.

| Case | Comparisons | Worst error |
|---|---|---|
| 1080p, animated camera, 5 times | 88 | 0.00004 px |
| 1080p, map layer scaled to 62 % | 18 | 0.0037 px |
| 4K, animated camera and scaled map layer | 126 | 0.00003 px |

- No expression errors. A second `addCameraRig` call reuses the rig instead of adding another.
- **In AE's own render.** E1 also places the five landmarks as 3D pins: 20 of 20 centres land on
  the renderer's red dots. In U1's frame with the 2D pins hidden, the 3D rings lie flat on the map
  exactly where the 2D pins were.
- **Limits.** The camera cannot match a map layer that is moved off centre, rotated or scaled
  unevenly (AE cameras have no lens shift). `addCameraRig` returns a warning in those cases.
  3D layers are sized in ground units of the reference zoom. Very long zoom ranges (such as world
  to street) are a Phase 3 topic.

## U1 — The real panel UI, driven through DevTools: PASS (2026-09-17)

- `npm run ae:spikes -- --ui` starts After Effects and connects to the panel's DevTools port (8123,
  dev builds only). It clicks through the UI like a user:
  1. Picks the downloaded "paris" basemap.
  2. Frames Paris in the preview.
  3. Opens **Download this area…**, types "Paris" and checks the existing-region warning and the
     per-zoom tile estimates (no download).
  4. Clicks **New map**.
  5. Drops three pins, then the same three places as 3D pins (this adds the 3D camera).
  6. Clicks **Render preview**, then opens the render settings (⚙), picks 2× supersampling with a
     Roads pass and a Water Matte, and clicks **Render**. Both jobs go through the render queue.
- Screenshots of each step, an AE-rendered frame, and a second frame with only the 3D pins are
  saved to `.cache/ui/`.
- **Result.** Both queue jobs finish. The map does not move, so each 250-frame render draws one
  frame and reuses it 249 times (1.1 s and 2.1 s). AE's own frame shows the Paris basemap with the
  pins on the Arc de Triomphe, Louvre and Eiffel Tower, and the OpenStreetMap credit in the corner.

## E1 — End to end in After Effects' own render: PASS 20/20 (2026-09-17)

- **Setup.** A 1280×720, 2-second map comp animates from Paris at zoom 12.6 (flat) to zoom 13.4
  (bearing 35°, pitch 50°).
  - Pins: hollow green rings at the Eiffel Tower, Arc de Triomphe, Louvre, Notre-Dame and
    Sacré-Cœur.
- **Render map.** `src/panel/render/renderMap.ts`:
  1. Samples the camera for all 50 frames through `LML.api.sampleViews`.
  2. Renders the Paris OpenStreetMap region with 3D buildings, plus solid red dots at the same five
     coordinates. Speed: 67 ms per frame, including PNG encoding.
  3. Imports the sequence into the map comp through `LML.api.importBasemap`.
- **Check.** After Effects renders the scene comp at four times with `saveFrameToPng`. At every pin
  centre that AE evaluates, the pixel of AE's own frame is pure red (255, 0, 0).
- **Result.** 20 of 20 checks hit. The AE layer rig and the renderer agree inside a real AE render.
- **With the 3D camera (C1).** The five landmarks are added again as 3D pins under the matched
  camera. 40 of 40 checks hit, 20 of them 3D pins.
- **Phase 2.** E1 now renders through the render job with 2× supersampling and GPU box filtering,
  and still hits 40 of 40.

## P1 — Pins in After Effects against the camera maths: PASS (2026-09-17)

- **Pins.** `src/core/ae/pinExpressions.ts` generates the expressions for position, scale, rotation
  and opacity. `LML.api.addPin` builds the shape layer, its effects and a Layer Control link to
  the map layer.
- **Test.** `src/panel/alignment.ts` animates the camera from Paris at zoom 11.3 (bearing 25°,
  pitch 45°) to the Eiffel Tower at zoom 16.8 (bearing −60°, pitch 70°). It places 14 pins across
  both views and compares each pin's evaluated AE position with the core projection of its exact
  coordinates. The core projection uses the camera values AE reports at that time and goes through
  `sourcePointToComp`.

| Case | Comparisons | Worst error |
|---|---|---|
| Animated camera, 5 times | 70 | 0.0061 px |
| Map layer moved, scaled to 55 % and rotated −12° | 28 | 0.0002 px |
| After renaming the map layer and its comp | 14 | 0.0042 px |
| 4K (3840×2160), all three cases | 112 | 0.0042 px |

- No expression errors.
- **Precision.** Slider Controls are float32, so the exact double coordinates are baked into each
  expression. They are used while the slider still holds their float32 rounding. Unit tests show
  that float32 alone would miss by more than 0.5 px at zoom 20.

## H1 — Host API through the real panel bridge: PASS 9/9 (2026-09-17)

- `src/panel/smoke.ts` calls the host exactly as the UI does:
  - `ping` through `LML.call`.
  - `createMapComp` with the name "Map Tōkyō · ঢাকা · القاهرة" (Unicode survives both ways).
  - Checks for the `LML:` tags, the five camera controls in order, and control values equal to the
    requested view.
  - `setView` as keyframes: one key per control.
- **Undo.** One Edit > Undo removes the keyframes; a second removes the whole map comp. Each action
  is exactly one undo step, and nothing purges undo history.

## S5 — Image sequences, proxies, re-render in place: PASS (2026-09-17)

- A PNG sequence imported with `ImportOptions.sequence` gets the expected duration (10 frames at
  25 fps).
- `setProxyWithSequence` attaches a half-size proxy sequence, and `useProxy` toggles it.
- `replaceWithSequence` swaps in a re-rendered sequence. The layer, its effects and its comp
  survive. A pixel check confirms the new frames: red before, green after.
- **Side note.** In UI mode, `app.quit()` stops at the "save changes" prompt. Automation closes the
  project with `CloseOptions.DO_NOT_SAVE_CHANGES` first.

## S1 — Frame renderer speed in CEP: PASS (2026-09-17)

The offline Natural Earth style was rendered along a van Wijk–Nuij flight from Paris to Tokyo. Each
frame covers: wait for tiles, synchronous draw, `readPixels` with flip and unpremultiply, PNG
encode (zlib level 1, opaque) and a write to disk.

| Size | Frames | Steady average | Max | First frame | Wait | Read | PNG encode | Budget |
|---|---|---|---|---|---|---|---|---|
| 1080p | 50 | 75 ms | 138 ms | 232 ms | 10 ms | 13 ms | 54 ms | 300 ms |
| 4K | 20 | 283 ms | 393 ms | 465 ms | 28 ms | 67 ms | 195 ms | 1200 ms |

- PNG encoding is the largest cost. Encoding in a worker pool, or JPEG for opaque base passes, would
  speed renders up several times.
- WebGL2 is available: `MAX_TEXTURE_SIZE` and `MAX_RENDERBUFFER_SIZE` are 16384.
- Chromium 99 lacks `AbortSignal.reason` and `throwIfAborted`, which `pmtiles` uses. Both are
  polyfilled in `src/panel/polyfills.ts`. A scan of the bundles found no other post-99 APIs.

## S2a — Core camera maths against MapLibre: PASS (2026-09-17)

- **Test.** Over 300 random views (zoom 2–18, any bearing, pitch 0–80°), our closed-form
  `project()` was compared with `map.project()`.
- **Result.** The worst error was **0.00000003 px**, so the core camera is exactly MapLibre's camera.
- **Next.** S2 proper, the After Effects rig against this maths, is part of Phase 1.

## S6 — Deterministic frames: PASS without renderer labels (2026-09-17)

- **With basemap labels.** 74,759 bytes differed between two renders of the same frame with another
  frame in between. Symbol placement and fade state depend on which frames were drawn before, not
  only on the clock.
- **S6b, labels off.** 0 bytes differed: the frame is identical.
- **Phase 2.** The renderer now runs with no fades (`fadeDuration: 0`) and no style transitions. With
  labels on, 5,714 bytes still differ (placement depends on earlier frames); without labels frames
  stay identical.
- **Decision.** Final-render labels stay out of the renderer. They are AE text layers placed by our
  own engine (Phase 6), or a label pass that engine draws. Basemap passes are deterministic, so
  re-rendering a single frame is safe.

## Automation note

- **Problem.** Starting After Effects with `AfterFX.com -r <script>` ended the session at a random
  moment after the script finished. The shutdown was a normal "App Exit", not a crash.
- **Fix.**
  - `tools/ae-spikes.mjs` starts `AfterFX.exe` normally.
  - The panel writes a heartbeat and polls for `run-request.json`.
  - Only if the panel is not open after 45 s does it send `tools/ae/open-panel.jsx` to the
    running instance.
  - The panel runs the host spikes with `$.evalFile`, then the renderer spikes.
  - It asks the host to quit, and the host quits from `app.scheduleTask` once the call has
    returned.
- **Result.** After Effects closes by itself when the run finishes.
- `npm run ae:spikes -- --only S4,S6b` runs a subset.

## S4 — Regional OpenStreetMap extract: PASS (2026-09-17)

- **Tool.** `tools/extract-region.ts` plans with range reads first, then downloads.
- **Source.** The newest Protomaps planet build, `20260917.pmtiles`: 138 GB, basemap schema 4.15.2.
- **Paris extract.** bbox 2.20,48.80,2.48,48.92, z0–15.
  - Planning read 9 directories (1.0 MB in 10 requests, 7.6 s).
  - Download: 624 tiles, 37.7 MB, in 43 s over 57 requests.
  - Saved to `%APPDATA%/LazyMapLayers/regions/paris.pmtiles`.
- **Contents.** Layers: earth, water, landcover, landuse, roads, buildings (`height`,
  `min_height`), boundaries, places, pois. Names in 41 languages. Attribution: © OpenStreetMap.
- **Render.** A 48-frame orbit around the Eiffel Tower at 1080p (zoom 15.6→14.8, pitch 62°,
  bearing −30°→90°) with 3D buildings, fully offline.
  - Average 140 ms per frame, maximum 214 ms, first frame 491 ms.
  - Checked visually: the Seine, Champ de Mars, Arc de Triomphe and La Défense towers are correct.
- **Found.** OpenStreetMap maps the Eiffel Tower as one footprint with a height, so it extrudes into
  a solid block. That needs landmark handling in Phase 7, such as skipping tall open structures or
  using landmark models.
