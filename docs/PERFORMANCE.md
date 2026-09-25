# Performance budgets

What the panel must never be slower than, measured on the development machine (Windows 11, After
Effects 2026, CEP 12 / Chromium 99, an NVIDIA GeForce RTX 3070) and enforced by the in-AE tests where
a number can be checked. A budget is a ceiling, not a target: the measured values are what a release
is expected to reach again. When a test runs right after other tests have filled After Effects'
caches, the label timings can come out two or three times slower (docs/SPIKES.md, LB1); a budget
failure is confirmed on a fresh instance before anything is changed.

| What | Budget | Measured | Enforced by |
|---|---|---|---|
| One 1080p basemap frame, base pass, steady state | 300 ms | 75–170 ms | S1 |
| One 4K basemap frame, base pass, steady state | 1200 ms | 280–640 ms | S1 |
| One 1080p frame with all 8 passes and 2× supersampling | 400 ms per drawn frame | 206–316 ms | R1 |
| A 10-second 4K move, 2× supersampling | 250 ms per frame | 88 ms (2026-09-24) | R2 (runs only when named) |
| Pops in a 4K descent | none | none, largest frame change 17.3 of 255 | R2 |
| Rendering again with nothing changed | 0 frames drawn | 0 | R1 |
| Changing one keyframe of a 750-frame move | only the affected frames drawn | 63 of 750 | R1 |
| Applying the shot list again | 800 ms | about 30 ms | SH1 |
| Auto labels: the longest single call into After Effects | 3000 ms | 1.1–1.6 s | LB1 |
| Auto labels: 60 names on a fresh instance | about 10 s in all | 9.8 s | LB1 (reported) |
| Restyling the names already on the map: the longest call | 1500 ms on a fresh instance, 4000 ms after a heavy render | 316 ms for 32 layers fresh; 1,859-2,955 ms in a run that follows D1's 4K demo, as LB1 also does | LB2 |
| Placing the names already on the map again: the longest call | the same two bars | 1,558 ms in a full run, 316 ms fresh | LB2 |
| A shape layer's expressions at world zooms | 0 ms added per frame | 0 ms (coarse level only) | SL1 (reported) |
| Shape layers from a data map | at most 40, largest first | 40 | core/style/dataShapes.ts |
| Shape layers from the feature browser | at most 40 in one go, with progress and a stop | 40 | src/panel/store.ts |
| Bars in a chart of the numbers | 8 by default, 30 at most | 8 | core/style/chart.ts |
| Connection lines between features | 60 drawn in one go, 200 in core | 60 | src/panel/overlays/mesh.ts |
| The scale bar and the north arrow | 2 expression evaluations per frame each | 2 | core/ae/mapFurniture.ts |
| The inset map's view box | 32 projected points per frame | 32 | core/ae/mapFurniture.ts |
| A watched table re-read after the file changes | 2 s | the poll's own interval | src/panel/store.ts |
| A satellite area of nine tiles at zoom 13 | 30 s and 8 MB | 18 s and 3.9 MB (2026-09-25, measured outside the panel) | SN1 |
| The panel alive after After Effects starts | about 10 s | 9 s | the test runner's log |

A heavy render means D1's 4K demo, TH1's twelve-look contact sheet or WB1's fourteen band frames.
Each one fills After Effects' caches and every call after it in the same run pays for that, so the
second bar is for those runs and not a licence to be slow: on its own the same call takes 316 ms.

## Rules the budgets come from

- **Batch everything that builds many layers.** One huge call into After Effects is far slower than
  the same work in several small calls, and it blocks the interface meanwhile. Labels go in eights,
  flows in sixes, restyles in forties, and every batch is its own undo step. No call may keep After
  Effects busy for more than about a second.
- **Never redraw what did not change.** Every rendered frame is keyed by its content, and a pass is
  keyed by its own layers, so a changed highlight redraws that pass alone and a changed keyframe
  redraws the frames it moved.
- **Expressions cost on every frame.** A layer that follows the map projects its points on every
  frame: shape layers keep 900 coarse points and project the fine ones only past zoom 5.5, flows are
  capped at 120 arcs, spikes at 200, copies at 200, heat is rendered rather than expressed.
- **Measure in After Effects, not from ExtendScript.** `valueAtTime` from a script costs about
  1.6 ms of call overhead each; compare `saveFrameToPng` times with a layer on and off instead.

Related: docs/SPIKES.md holds every measurement with its date and the frames it was taken on.
