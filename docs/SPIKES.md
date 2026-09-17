# Phase 0 spike results

Machine: Windows 11, After Effects 2026 (26.5x89), CEP 12.0.1 (Chromium 99.0.4844.84), NVIDIA GeForce
RTX 3070 (ANGLE, Direct3D 11). Run with `npm run ae:spikes` (`tools/ae-spikes.mjs`), which starts After
Effects, runs the host spikes, opens the panel, runs the renderer spikes and quits.

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
- **Consequence for labels.** Measure label text in AE, then do collision and placement in core. It
  is cheap enough to measure every candidate. Create layers only for labels that survive placement,
  and batch the creation behind a progress bar.

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
