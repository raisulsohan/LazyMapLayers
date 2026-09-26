# LazyMapLayers guide

Everything the panel does, sheet by sheet, with a few things to make step by step. The README has the
install and a first flight; this is the rest.

## How the panel thinks

A **map** is a comp that draws the basemap, with five camera controls on its layer: latitude,
longitude, zoom, bearing and pitch. Everything else - pins, routes, names, outlines, spikes, your own
artwork - is an ordinary After Effects layer in the scene that reads those controls through
expressions, so it stays on its place whatever the camera does. The panel's **preview** shows the exact
frame the map will render; move it and you move the camera.

The basemap itself is rendered by the panel, frame by frame, from open map data on your disk, and
imported as an image sequence (one per pass). Only frames that changed are drawn again.

Every action of the panel is one undo step in After Effects. Layers the panel made carry an `LML:`
line in their comment; it never touches a layer without one unless you attach it.

## The top of the panel

- **Maps** (the list icon): the maps in this project, **New map**, and two samples: **Build the world
  flight sample** (globe, borders, a flight to Paris, a route to Tokyo) and **Build the numbers
  sample** (every country by its population, with spikes and a legend). Under **About**: the
  version, the releases page, **Report a problem** (writes a report to your LazyMapLayers folder and
  opens a new issue for you to paste it into; nothing is sent by itself) and the switch for the
  once-a-day look at the release list.
- **Map settings** (the sliders icon): the map's name, the basemap (World, or a downloaded area),
  and **Globe**.
- **Preview** and **Render**: half resolution and fast, or full quality with the Render tab's
  settings. A preview becomes an After Effects proxy once a final render exists.
- **Search**: a country, province, district or city in 26 languages, or `lat, lng`. Offline. A result
  can be highlighted straight from the list.
- **The preview**: drag to move, scroll to zoom, right-drag to rotate and tilt. The line at the bottom
  says what is under the pointer - place, district, province, country - and the numbers at the left
  are the frame's latitude, longitude, zoom, bearing and pitch. The compass sets north up (Alt+click
  also looks straight down). **Exact look** shows names and lines at the size they render.

Keys: **Esc** ends the tool that is on. **Space** plays the shot list in the preview. **Alt+click**
the map drops a pin, **Alt+Shift+click** a 3D pin.

## The camera

### Shots tab

Build the camera from shots: **+ Shot** takes the view in the preview (after the selected shot).
Between two shots is a move; click it to change it:

- **Fly** rises and lands like a flight (a tilted shot looks straight down while it is high, and
  tilts again on the way down). **Straight** keeps the zoom between the shots - for short routes.
  **Along route** follows a line (imported, or drawn with the Route tool), turning the camera with
  the direction of travel and looking a little ahead. **Cut** jumps.
- A **duration**, a **flight height**, and an **easing**: Linear, Smooth (Easy Ease), Cinematic
  (long gentle start and landing), Soft start, Soft landing, Snappy, or your own cubic-bezier.
- A shot's **hold**: how long the camera stays, and what it does meanwhile - turn the globe, orbit
  around the centre, push in or pull out.

**Play** runs the list in the preview. **Apply to timeline** writes the keys to the map layer's five
controls with a marker per shot, in one undo step; apply again after changing the list and the keys
are replaced. Double-click a shot to see it; **Update from preview** replaces a shot's view with the preview's.

### Without the shot list

**Keyframe view** keys the preview's view at the current time. **Fly here** keys one smooth flight
from the camera at the current time to the preview (with a duration next to it). **Live link** moves
the map at the current time while you move the preview. **Match AE** shows the camera of the current
time in the preview. **3D camera** adds an After Effects camera that matches the map, so your own 3D
layers sit on the ground.

## The tools (the row of icons)

**Pin** and **3D pin**: click the tool, then a place (or Alt+click the map). The layer is named after
the place - "Pin: Dhaka". A 3D pin lies on the ground under the matched 3D camera.

**Callout**: a leader line with a title box next to a place, set in the label font.

**Route**: click two places. The sheet has the duration, **Arrow** (a Traveller layer rides the line
and turns with it - parent your own plane to it), **Comet** (a bright head runs along the line as it
draws) and **Dashed**. The route draws on from the current time; the layer is named "Dhaka to
Chittagong".

**Attach**: select your own layers in After Effects - an icon, a photo, a precomp - then click a
place. They get a pin's controls (Latitude, Longitude, Elevation, Scale with map, Rotate with map)
and stay on the place while the camera moves; their own comment and any expression you wrote are
kept. **Unlink selected** puts a selected layer back as it was.

**Highlight**: click countries, provinces or districts on the map (the chips choose which). Every
highlight renders as its own layer above the basemap, with its colour, fill and outline; **One layer**
puts them all on one. Districts are downloaded per country the first time you ask (open data from
geoBoundaries; the size is shown first). In the sheet:
- **Shape** adds the highlighted outline as an editable After Effects shape layer: real paths that
  follow the map, an even-odd fill, a stroke, an optional draw-on. It carries a coarse outline for
  world zooms and a fine one for close-ups.
- **Make a new area**: **Merge** the highlights into one shape with the borders between them gone,
  **Grow** or **Shrink** them by a distance in kilometres, or drop a distance circle around the
  preview's centre (**Circle here**). Each is a new area you can highlight, add as a shape, or save.

**Import**: GPX, KML, KMZ, GeoJSON, CSV, or a zipped shapefile. For each line: **Fit** (frame it),
**Draw** or **Draw + arrow** (a route that draws on, with an arrow riding it; **Comet**, **Dashed**
and, for a GPS track with times, **Recorded pace** are switches above) or **Camera** (shots along
it). Places become pins; areas can be
highlighted. A CSV of places with a name column becomes pins; a CSV of names and numbers opens the
Numbers sheet instead.

**Numbers**: see below.

**OpenStreetMap**: type a name (or pick water, parks and forest, islands, airports, boundaries,
buildings, roads or railways) and **Find** what OpenStreetMap holds for the area in the preview. It
arrives as an import: draw it, highlight it, add it as a shape. Rendering a map with OpenStreetMap
data adds a small credit layer, which the licence asks for.

**Save as GeoJSON**: pins, routes, outlines, callouts and highlighted areas back out as a file.

**Auto labels**: the names of countries, cities, seas, rivers and mountains over the whole timeline,
in each place's own language (or one language, with or without an English line under it), as
editable text layers that never overlap or flicker. **What to name** switches Countries, Cities,
Seas and rivers, Mountains and deserts, and Streets and landmarks on and off. Water is written in
italic in the colour of water, ranges and deserts in spaced capitals, a peak with a small triangle
and its height. Over a downloaded area the names inside it come from its own data: districts,
parks, landmarks, stations, the river through town and the main streets, with street and river names
laid along their line and turning with the camera. **Your own design** puts a comp you made on every place instead: draw a box, an icon, a
rule, and give its text layers fields like `{name}` or `Pop. {populationShort}`; a layer called
**Anchor** marks where the place sits. A picture layer named like `{flag}` takes a picture per place
from a folder you choose (**Pictures for {flag}…**), found by country code or name and fitted to the
placeholder. The panel fills the fields per place and places the copies with the same collision
rules. **Few / Normal / Many** sets how many. **How the names look** sets colour, size, halo,
capitals for countries, and dots for cities, or takes them **From the selected text layer** you
styled yourself; a change restyles the names already on the map and places them again, so bigger
names step apart instead of overlapping (one that no longer fits anywhere fades out, and the log
says how many). **Use for every map** gives the template and the keep-out zones to the other maps in
the project, and places their names again too. **Keep the names out of**
blocks the lower third, a top bar, or whatever your own selected layers cover, for the seconds those
layers are on screen; the zones are drawn over the preview.

**Animate borders**: country borders draw on over four seconds from the current time.

**Look**: twelve looks (Midnight, Satellite, Daylight, Atlas, Blueprint, Mono, Paper, Noir, Slate,
Terracotta, Arctic, Emerald), **Shaded relief**, the **sky** above the horizon, and:
- **Your own colours**: sea, land, lines and names; roads, borders, buildings, parks, coasts and the
  sky are worked out from them, and the names are kept readable on the land you chose. **From a
  picture** takes the palette of a still from your film; **Open a look** reads a saved look or an
  Illustrator / Photoshop palette (.ase, .act); **Save the look** keeps yours in a file.
- **Details**: lines and roads heavier or lighter, fewer or more names, in every look.
- **Use for every map**: the other maps in the project take this look, its details, the layer style,
  relief, sky and imagery.
- **Imagery of your own**: any XYZ tile address (`https://…/{z}/{x}/{y}.png`, with your own key if
  it needs one) or a PMTiles archive on the web, drawn over the ground and under every line, with
  an opacity and the credit the source asks for. The source's terms are yours to keep; tiles are
  fetched while previewing and rendering. **Open services** lists aerial pictures governments
  publish for anyone to use (the United States, the Netherlands, Switzerland, France, Japan, Spain,
  Austria, Czechia, Luxembourg, Estonia), each with its licence; picking one fills the address and
  the credit.
- **Pins, routes and callouts**: the colour, line width and glow of the layers this map makes, or
  picked up from a selected layer.
- **Inset map**: **Add inset map** puts a small locator in the corner you pick, **Wider by** as
  many zoom levels as you like, with a framed box on it showing where this map is looking. The box
  moves and turns with the map on every frame. The inset is a map of its own: pick it at the top of
  the panel to give it a look, names and a render.
- **Scale bar and north arrow**: **Add scale bar** puts a bar in the corner you pick, in metres
  and kilometres or in feet and miles. It measures itself from the map on every frame, so it
  always shows a round distance and stays right through a zoom, even if you scale the map layer.
  **Add north arrow** puts an arrow that turns with the bearing, and follows the pole on the
  globe, with an upright **N** under it. Both are plain layers: move them, recolour them, keyframe
  them. Each has its own **Remove**.
- **Terrain**: **Download…** an elevation pack for the area in the preview (open data through
  Mapterhorn). With a pack: **Shaded slopes** at any zoom, and **3D height** - real mountains,
  1× true to scale or more. Pins, labels and routes made with the pack sit on the ground; key the map
  layer's **Terrain Height** slider and the mountains rise. **Ground level** reads the elevation at
  the map's centre.

**Download this area** (the arrow at the top right): OpenStreetMap detail for the area in the
preview - roads, buildings, water, 3D buildings - once, then it works offline. Give it a name; pick
the detail level (the tile count is shown). Several areas layer on top of the world map.

## The feature browser

**Browse features…** in the Highlight sheet lists everything the panel can put on a map: every
country, the provinces or districts of one country, the shapes of the file you last imported, and
the areas this map already holds.

- **Search** looks through names and every property.
- **Filter** is one written line: `population > 200000000`, `kind = country`, `name has delta`.
  The tests are `>` `>=` `<` `<=` `=` `!=` and `has` (text that contains). A feature that does not
  carry that property is left out.
- **Sort** by any property, largest or smallest first.
- **Go to** frames one feature in the preview.

Tick what you want, then:

- **Highlight** them all, **Shape layers** for editable outlines, **Merge** into one area.
- **Break apart** splits one outline into its parts, largest first.
- **Cut out** takes the other ticked shapes out of the first as holes (each has to lie wholly
  inside it).
- **Count points** counts the imported points inside each one, as a property called `inside` you
  can sort or filter on.
- **Connect** draws a line between them all, or only between the **nearest** neighbours you ask
  for, all drawing on from the current time.

## Numbers on the map

Import a CSV with a column of names and a column of numbers. The Numbers sheet opens with the columns guessed; change **Country** and **Colour by** if it guessed wrong.

- **Match**: whatever fits, countries, provinces, or districts. Names are matched in 26 languages,
  by ISO code, by a state's short code (CA, US-CA) or by the map's own code; rows that match nothing
  are listed, never coloured on a guess. For districts, pick the country: if its districts are not on
  this computer, the sheet offers the download right there.
- **Colour again**: fills every matched place as one layer above the basemap, in the colour of its
  step. Ramp, number of steps, even steps or quantiles, opacity, and **Flip** for a dark map.
- **Add bubbles**: circles whose area stands for the value, as one shape layer with a group per place
  (every circle has its own transform to animate). Size sets the largest; **In step colours** gives
  each its step's colour.
- **Add spikes**: a triangle per place rising straight up the frame, its height the value, read
  straight. Height sets the tallest.
- **Add heat**: every place warms the map around it by its number; the renderer draws the warmth in
  the ramp's colours as a layer of its own. Radius sets the reach. Works with the places of the last
  imported file too.
- **Copy selected layer onto places**: a layer of your own - an icon, a flag, a photo - copied onto
  every place, named after it, **Sized by number** (its area stands for the value) and wired to its
  place like an attached layer. The original is left as it is.
- **Add numbers**: the values as text layers under their circles, **With names** if you like.
- **Flows**: when the table has a place at each end of a row and an amount (origin, destination,
  passengers), **Draw flows** makes one great-circle arc per row, its width the amount, all drawing
  on together from the current time, with **Arrows** riding and **In step colours** if you like.
- **Add shapes**: every place that has a number as its own editable shape layer - fill strength and
  stroke width from the value, colour from its step. Real paths that follow the map, so you can
  animate or restyle one country by hand. Up to forty, largest first.
- **Add chart**: a bar chart of the places in the corner you pick - longest first, each bar
  growing in turn from the current time, with the name and the number beside it in that place's
  colour. **Bars** sets how many. An ordinary precomp: move it, restyle it, animate it.
- **Add legend**: a precomp with the colours, the bubble sizes, the spike heights and the heat's
  three steps, in the corner you pick. It is an ordinary precomp: move it, restyle it, animate it.

Every one of these has a **Remove**; **Remove** at the bottom takes the numbers off the map.

## A satellite picture of your area

Under the look, **Build for this area…** makes a real satellite basemap of whatever the preview is
showing, at ten metres a pixel, from the European Union's Sentinel-2 imagery. It is free for any
use, films you are paid for included, as long as the credit stays on the map, and it needs no
account and no key.

1. Frame the area in the preview.
2. **Build for this area…**, give it a name, choose the detail (zoom 14 is ten metres a pixel) and
   how far back to look for a clear pass.
3. The panel says how many scenes it found, how cloudy they were, and about how much it will
   download. Press **Build**.

Each pixel comes from the clearest pass over that ground; where the clearest one had cloud or its
shadow, the next pass fills in. The finished area is kept on your computer and drawn under every
line and label, like any other imagery. Pick it again for another map from the same row, or remove
it with the ✕ beside its name.

A city at zoom 13 is a few megabytes and a couple of minutes; zoom 14 is four times that. Very
cloudy places may need a longer window, and the panel says when it found nothing clear.

## A camera from Google Earth Studio

Earth Studio (earth.google.com/studio, free with a Google account) renders photoreal Google Earth
animations in the browser. To put the panel's layers on that footage:

1. Animate and render your shot in Earth Studio as usual.
2. There, **File > Export > 3D Tracking Data…**, pick **JSON**, and save it.
3. In the panel: **+** (new map) > **Open a tracking file…** under *From Google Earth Studio*.

The panel makes a scene the size, length and frame rate of your render and keys the map's camera
to theirs, frame by frame. Import your rendered frames in After Effects and drop them under the
map layer: the names, pins, routes and outlines you add from then on sit on the footage. Track
points you set in Earth Studio come in as pins with their names.

A flat or gently tilted shot lines up closely. A steep, low shot over hills or tall buildings will
not line up as well, because Earth Studio renders real 3D and the panel renders a map; the panel
says so when the camera tilts past 25 degrees.

## Live numbers

**Watch a file…** in the Numbers sheet reads a table from a file on disk and keeps reading it.
Edit and save that file anywhere - a spreadsheet, a script, an export from somewhere else - and
the table is read again and the map coloured again. The columns you picked are kept as long as
the headings still fit. **Stop watching** leaves everything on the map as it is.

## Driving the panel from a script

Turn on **Let scripts on this computer drive the panel** in About and another program can leave a
request in a folder for the panel to do: make a map, move and keyframe the camera, add pins,
names, highlights, a scale bar, an inset map, a chart, read a CSV, render. docs/SCRIPTING.md lists
the calls and has an ExtendScript helper you can paste into your own script. It is off until you
turn it on, and only the listed calls can ever be asked for.

## Rendering

**Preview** renders at half resolution without supersampling, fast. **Render** renders every frame at
full quality and imports the passes into the map comp. Only frames that changed since the last render
are drawn again, and a changed keyframe redraws only the frames it moved.

The **Render tab** holds the settings of the selected map:
- **Passes**: Base (everything), or Land, Water, Boundaries, Roads, Buildings and Terrain (the
  shaded slopes alone, when the map has an elevation pack) as separate layers, plus Land Matte and
  Water Matte - white where land or water is - for compositing. Highlights and
  the numbers always come as their own layers.
- **Supersampling**: 1× to 4×, averaged on the GPU. **Motion blur**: sub-frame samples; the shutter
  angle and phase come from the scene comp, so the basemap blurs like the layers above it.
- **Renders on disk**: what the renders take. A saved project's renders live in a "LazyMapLayers
  Renders" folder next to it; an unsaved project's in the data folder, and those can be removed once
  the project is closed. A map you rendered before saving its project keeps its frames in the data
  folder, where its footage points, and they are kept for as long as that project file exists.

A job from another project waits in the list, with a plain sentence, until its project is open.

## Recipes

**A flight from one city to another, with an arrow.** New map. Search Dhaka, click it, scroll to the
zoom you want, **+ Shot**. Search Chittagong, set the zoom, **+ Shot**. Click the move between the
shots: Along route, 6 s, Cinematic; **Play**; **Apply to timeline**. Route tool: click Dhaka, then
Chittagong, switch **Arrow** on, **Add route**. Auto labels for the names. **Preview**, then
**Render**.

**A data map.** Import `population.csv` (Country, Population). Check the join line under the columns,
**Colour again**. **Add spikes** or **Add bubbles**, **Add legend** bottom left. Change the ramp and
watch the layer follow. **Render**.

**A city at street level.** Move the preview over the city, **Download this area** at zoom 15, name
it. Map settings > Basemap: the area (or leave World: downloaded areas layer over it by themselves).
Tilt the preview; buildings rise. Look > Terrain > Download for the mountains.

**Your own look.** Look > Your own colours: pick the sea and the land from your film's stills, or
**From a picture** with a still. Save the look; open it in the next project.

**Your artwork on every capital.** Colour the map by a table of countries. Draw or import a flag,
select it in After Effects, **Copy selected layer onto places**, Sized by number off. Every capital
has a flag that stays put while the camera flies.

**Categories and years.** In the Numbers sheet, **Colour by** also lists columns of categories
(marked "categories"): each kind gets its own colour and a row in the legend. A table with years -
a column per year, or a row per place per year - shows **Animate over the years**: the map then runs
from the first year to the last over the comp on the map layer's "Data Time" slider (key it as you
like), and **Add the year** puts the year on screen, counting with the slider. With years, **Add
chart** can also draw **Lines over the years** or **Areas over the years**, which grow with the map
and follow the same slider.

## Data, downloads and credits

The world map (Natural Earth, with the provinces of every country) is inside the panel and works
offline. It carries coastlines, borders, rivers, lakes, place names, built-up areas and the
motorways between cities, so a flight from the globe down to a city still has something on the
ground at the zooms in between. The cities and motorways fade out as you come closer, where a
downloaded area takes over with the real streets. Everything else is downloaded only when you ask, and the size is shown first: OpenStreetMap
areas (the free Protomaps planet build), satellite pictures (NASA Blue Marble, 20 MB) and shaded
relief (Natural Earth, 48 MB), district boundaries per country (geoBoundaries), elevation packs
(Mapterhorn), and any OpenStreetMap search (Overpass). Downloads live in `%APPDATA%\LazyMapLayers`
(Windows) or `~/Library/Application Support/LazyMapLayers` (macOS).

The panel never sends anything about you or your project. Rendering OpenStreetMap data, district
boundaries or terrain adds one small credit text layer to the scene; keep it, or put the credit in
your end titles.

## What it does not do yet

- **Cut out** only works when the shape being taken away lies wholly inside the one it comes out
  of. A shape that half overlaps is counted and left alone rather than cut wrongly; a full polygon
  clipper is not part of the panel yet.
- Feature properties can be searched, filtered and sorted, but not edited. Rename the layers in
  After Effects instead.
- Everything here is tested on Windows. macOS should work the same way; it has not been run
  through yet.

## If something goes wrong

- The panel is not in the Window menu: restart After Effects, which looks for new panels while it
  starts.
- The panel opens blank: run "Fix a blank panel.bat" (Windows) or, on macOS, `defaults write
  com.adobe.CSXS.12 PlayerDebugMode 1` in Terminal, then restart After Effects.
- The preview stays black: the panel needs WebGL 2; update the graphics driver.
- Expression errors in a new project: the project uses the Legacy ExtendScript expression engine;
  the panel's expressions run on it, but File > Project Settings > Expressions > JavaScript plays
  back faster.
- You duplicated a scene: the copy gets a map of its own the next time the panel looks (the log says
  so). It shows the same frames until you render it. Ctrl+Z puts it back as a shared copy, and the
  panel leaves it that way.
- Anything else: Maps > About > **Report a problem**, and paste the report into the issue it opens.
