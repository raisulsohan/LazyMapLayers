# The quality bar, item by item

docs/PLAN.md sets nine things every release must show before 1.0. This page says, for each one,
where it can be seen in a sample the panel builds, which test in After Effects checks it, and what
that test measured. The tests are in `src/panel/*Tests.ts` and run with `npm run ae:spikes`;
docs/SPIKES.md has every result.

The two samples are under **Maps**: **Build the world flight sample** (a globe, borders drawing on,
a flight to Paris and down to its streets if the Paris area is downloaded, a route to Tokyo, names
of countries, cities, seas and mountains) and **Build the numbers sample** (every country coloured
by its population, spikes, a legend).

## 1. Crisp basemap during zoom

Text and lines keep their size on screen at every zoom, with no cross-fade between zoom levels.

- **Why it holds:** every frame is rendered at the exact camera of that frame, from vector data; there
  are no tiles of fixed zoom laid over one another to fade between.
- **Seen in:** the world flight sample, from the globe down to Paris.
- **Checked by:** R1 (no pops in the base sequence; a keyframe change redraws only the frames it
  moved), R2 (a 10-second 4K move: 0 pops, 88 ms a frame), S6 (the same frame rendered twice is the
  same, pixel for pixel), WB1 (the band between the world and a city is not empty).

## 2. Alignment

Pins and shapes on After Effects layers stay within 0.5 px of the rendered basemap at 4K, with pitch
and bearing.

- **Why it holds:** the camera maths lives once, in core, and both the renderer and the expressions
  on the layers use it; the expressions are checked against Node in the ES3 engine (1,305 of them).
- **Seen in:** the pins and the route of the world flight sample.
- **Checked by:** P1 (0.0061 px worst at 1080p and 4K), C1 (0.004 px with the matched 3D camera),
  E1 (After Effects' own render, 20 of 20), G2 (pins on the globe), AT1 (a layer of the user's own
  attached to a place: 0.008 px).

## 3. Smooth fly-to

A move from one continent to a city on another is one continuous zoom-and-pan curve, with no held
phase.

- **Why it holds:** the flight is one curve that zooms out and in while it pans (core/camera), baked
  into keyframes at every frame the eye can tell apart.
- **Seen in:** the world flight sample, the jump from Paris to Tokyo.
- **Checked by:** SH1 (601 frames of a shot list match the core maths; Apply in about 30 ms),
  D1 (the world flight demo at 1080p and 4K), D1L (the same on the Legacy expression engine: 324
  expressions, none broken).

## 4. Stable auto labels

No name shows for less than the minimum time, none flickers, none overlaps another on any frame.

- **Why it holds:** names are placed over the whole timeline at once, with the ones already on screen
  kept first, a minimum time on screen of 0.8 s, and fades in and out that never cross the edges of
  the comp (D77).
- **Seen in:** the world flight sample's names.
- **Checked by:** LB1 (60 names, no overlaps, the longest call into After Effects 1.1 to 1.6 s
  against a budget of 3 s), LB2 and LB3 (template changes and keep-out zones), LB4 and LB5 (natural names and the
  names inside a city, each kind within its share).

## 5. Any script

Names in complex scripts shape correctly: Arabic, Hebrew, Hindi, Bengali, Thai, Chinese, Japanese and
Korean.

- **Why it holds:** each script has its own fonts that shape it, a template's font is used only for
  Latin, Cyrillic and Greek, and After Effects' Universal Type Engine is switched on for every name.
- **Seen in:** the world flight sample with the language set to any of the 26.
- **Checked by:** S3 (complex scripts in After Effects text layers), LB4 (the Bay of Bengal in Bengali,
  upright, in Nirmala UI; features in China named in Chinese).

## 6. Light comps

A 10-second fly-to comp holds one footage item per render pass, not hundreds of tile layers.

- **Seen in:** the map comp of either sample after a render: one layer per pass.
- **Checked by:** R1 ("comp stays light: one layer and one footage item per pass", 8 layers and 8
  items for 8 passes), DU1 (a duplicated scene gets its own items, still one per pass).

## 7. Undo

Every panel action can be undone with Ctrl+Z.

- **Why it holds:** every host action runs inside one undo group, and the undo history is never
  purged (CLAUDE.md, hard rule 2).
- **Checked by:** H1 (one undo removes the view keyframes, a second the whole map comp), DU1 (one
  undo brings a separated copy back, and the panel leaves it that way).

## 8. Level of detail

A country outline stays smooth at zoom 12 and light at zoom 2.

- **Why it holds:** shape layers carry a coarse and a fine outline and project only the one the zoom
  needs (D48).
- **Checked by:** SL1 (the fine level has more points than the coarse one, and the drawn shape covers
  the rendered country to 98 %).

## 9. Free

Every sample works with no account and no key.

- **Why it holds:** the world map, the names and the country and province data are inside the panel;
  every download (OpenStreetMap areas, elevation, district boundaries, satellite pictures) and the
  online search come from open services without an account or a key, credited as they ask.
- **Checked by:** DS1, TR1, IM1, OSM1, SN1 and GC1, the online tests, none of which signs in or sends
  a key.
