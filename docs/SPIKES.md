# Spike and in-AE test results

Machine: Windows 11, After Effects 2026 (26.5x89), CEP 12.0.1 (Chromium 99.0.4844.84), NVIDIA GeForce
RTX 3070 (ANGLE, Direct3D 11). Run with `npm run ae:spikes` (`tools/ae-spikes.mjs`), which starts After
Effects, runs the host spikes, opens the panel, runs the renderer spikes and quits. R2 is long and
only runs with `-- --only R2`.

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
