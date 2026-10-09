# The LazyMapLayers manual

Every option of the panel, one chapter at a time: what it does, where it is, how to use it step by
step, every setting it has, and the mistakes to avoid. Each chapter shows the panel as you will see
it and the result in After Effects, captured from the real panel in After Effects.

The short version of all this is the [guide](../GUIDE.md). This manual is the long one. It is also on
[raisulsohan.com](https://raisulsohan.com/en/portfolio/lazymaplayers/documentation/).

## How every chapter is laid out

1. **What it does**: one paragraph and a picture of the result.
2. **Where to find it**: the panel with the control marked.
3. **Step by step**: numbered steps.
4. **Every setting**: a table of each field and what it changes.
5. **Tips and pitfalls**: what goes wrong, and why.
6. **Related**: the chapters that build on this one.

## Part 1. Getting started

1. [Installing, and opening the panel](01-install.md)
2. [The panel at a glance](02-panel-at-a-glance.md): the header, the tool row, the preview, the strip, the status line, the keys
3. [How the panel thinks](03-how-it-thinks.md): the map comp, its five camera controls, `LML:` tags, undo
4. [The Maps screen](04-maps-screen.md): new map, the two samples, About
5. [Map settings](05-map-settings.md): name, basemap, globe, following another map's camera
6. [Search](06-search.md): places in 26 languages, coordinates, streets through OpenStreetMap

## Part 2. The camera

7. [Moving the preview](07-moving-the-preview.md): drag, zoom, turn and tilt, the compass, the readout, Exact look
8. [The quick camera](08-quick-camera.md): Keyframe view, Fly here, Live link, 3D camera
9. [The Shots tab](09-shots.md): shots, moves, easing, holds, Apply to timeline

## Part 3. Things on the map

10. [Pins and 3D pins](10-pins.md)
11. [Callouts](11-callouts.md)
12. [Routes](12-routes.md): Arrow, Comet, Dashed
13. [Attaching your own layers](13-attach.md)
14. [Highlights](14-highlights.md): countries, provinces, districts, shape layers, merge, grow, shrink, circles
15. [The feature browser](15-feature-browser.md): search, filter, sort, break apart, cut out, edit, count, connect
16. [Importing files](16-import.md): GPX, KML, KMZ, GeoJSON, CSV, shapefile
17. [Your own drawing with the Pen tool](17-your-own-drawing.md)
18. [Finding things on OpenStreetMap](18-openstreetmap.md)
19. [Saving the map as GeoJSON](19-save-geojson.md)
20. [Auto labels](20-auto-labels.md): what to name, languages, how many, how they look, your own design, keep-out zones
21. [Animate borders](21-animate-borders.md)

## Part 4. The look of the map

22. [The looks, and a look of your own](22-looks.md)
23. [Sky, shaded relief, and the style of pins, routes and callouts](23-sky-relief-layer-style.md)
24. [Imagery](24-imagery.md): the Satellite look, your own tiles, open government services, Sentinel-2
25. [Terrain](25-terrain.md): shaded slopes and 3D height
26. [Inset map, scale bar and north arrow](26-inset-scale-north.md)
27. [Downloading an area for street-level detail](27-download-area.md)

## Part 5. Numbers on the map

28. [Colouring places by a number](28-numbers-colour.md): matching, ramps, steps, categories
29. [Bubbles, spikes, heat and shapes](29-bubbles-spikes-heat-shapes.md)
30. [Numbers as text, and copies of your own layer on every place](30-values-and-copies.md)
31. [Legend and chart](31-legend-chart.md)
32. [Flows between places](32-flows.md)
33. [Years: a map that moves through time](33-years.md)
34. [Prism maps](34-prism.md)
35. [Live numbers from a watched file](35-live-numbers.md)

## Part 6. Getting it out

36. [Preview, Render and the Render tab](36-render.md): supersampling, motion blur, passes, mattes, renders on disk
37. [A camera from Google Earth Studio](37-earth-studio.md)
38. [Driving the panel from a script](38-scripting.md)
39. [Data, downloads, credits and working offline](39-data-offline.md)
40. [When something goes wrong](40-troubleshooting.md)

## [Recipes](recipes.md)

Whole pieces from an empty project to a render: a flight between two cities, a data map, a map
through the years, a city at street level, your own look, artwork on every capital, a split screen,
a distance ring, a journey from a GPS track.

## For contributors

The pictures are made in the real After Effects by `tools/manual/` (see the header of
`tools/manual/capture.mjs`): `node tools/manual/capture.mjs --only 10-pins` captures one chapter
again after the panel changes. The sample data is in `tools/manual/samples/`. raisulsohan.com reads these
files straight from this repository (a subfolder of `docs/` with its own README is a book there),
so a push is all it takes.
