# Changelog

## Unreleased

- **Live numbers.** **Watch a file…** in the Numbers sheet reads a table from a file on disk and
  keeps reading it: edit and save that file in a spreadsheet, a script or anything else, and the
  table is read again and the map coloured again, without an import. The columns you picked are
  kept as long as the headings still fit.
- **Scripts can drive the panel.** Turn it on in About and another program on the same computer -
  your own ExtendScript, a Node job, anything that can write a file - can leave a request in a
  folder and the panel does it: make a map, move and keyframe the camera, add pins, names,
  highlights, a scale bar, an inset, a chart, read a CSV, render. docs/SCRIPTING.md has the calls
  and an ExtendScript helper. It is off by default, and only the listed calls can ever be asked
  for.
- **A feature browser.** **Browse features…** in the Highlight sheet opens a list of everything the
  panel can put on a map: every country, the provinces or districts of one country, the shapes of
  the file you imported and the areas this map already holds. Search it, sort it by any property,
  and filter it in words, like `population > 200000000` or `name has delta`. Tick what you want and
  highlight it, add it as shape layers, or merge it into one area.
- **What a shape can be made into.** With features ticked: **Break apart** splits an outline into
  its parts, largest first, so a mainland comes away from its islands. **Cut out** takes the other
  ticked shapes out of the first one as holes. **Count points** counts the imported points that
  fall inside each one and writes it as a property you can then sort or filter on. **Connect**
  draws a line between them all, or only between nearest neighbours, drawing on together: a
  network map in one click.
- **Imported shapes keep their properties.** A GeoJSON, KML or shapefile feature arrives with the
  fields the file gave it, so the browser can list and filter on them.
- **An inset map.** **Add inset map** puts a small locator in the corner: a second map, as many
  zoom levels wider as you ask, with a framed box on it that moves and turns with the big map on
  every frame. The inset is a map of its own - pick it at the top of the panel to give it its own
  look, its own names and its own render - and the box is clipped to it, so a map that flies away
  never draws over the scene.
- **A scale bar and a north arrow.** Two buttons under the look put them in any corner. The bar
  measures itself from the map on every frame, so it always shows a round distance (1, 2 or 5 of
  something) and stays right through a zoom, in metres and kilometres or in feet and miles; the
  arrow turns with the bearing, and on the globe it follows the pole, where north stops being
  straight up. Both are plain layers you can move, recolour and keyframe, and they hold even if you
  scale the map layer itself.
- **A chart of the numbers.** **Add chart** in the Numbers sheet builds a bar chart of the places
  you coloured the map by: longest first, each bar growing in turn from the current time, with the
  place's name and its number beside it, in the colour that place has on the map. It is an ordinary
  precomp in the scene: move it, restyle it, animate it.

- **Shapes from the numbers.** **Add shapes** in the Numbers sheet turns every place that has a
  number into its own editable shape layer: the fill strength and the stroke width follow the value,
  and the colour is the step the map gives it. They are ordinary shape layers with real paths that
  follow the camera, so a single country can be animated, glowed or restyled by hand. Up to forty,
  largest first.
- **Labels you design yourself.** Make a comp - a box, an icon, a line, whatever you draw - with text
  layers that say `{name}`, `Pop. {populationShort}`, `{country}` and so on, and pick it under **Your
  own design** in the Labels sheet. Every place then gets a copy of your comp with its fields filled
  in, placed over the whole timeline with the same collision rules as plain names. A layer called
  **Anchor** marks where the place sits inside your design; without one the comp's centre is used.
  Fields: name, english, subtitle, country, countryName, region, population, populationShort,
  capital, kind, lat, lng.
- **A terrain pass.** The shaded slopes can be rendered as their own layer, with alpha, to grade or
  switch off in After Effects; the land and water passes still carry them as before. Switch it on in
  the Render tab. A map without an elevation pack leaves the pass out instead of making an empty
  layer.
- **Names move when the template resizes them.** Changing the size (or the halo, or capitals) of the
  names now places the ones already on the map again over the whole timeline, with the same
  collision rules that placed them: bigger names step apart, and one that no longer fits anywhere
  fades out instead of sitting on another. The words, the language and which places were chosen stay
  as they were.

## 0.5.0 — imagery of your own, open aerial services, names that follow the template, and the guide (2026-09-23)

- **Use for every map.** A button under the look and one under the names give every other map in
  the project this map's look (colours, details, layer style, relief, sky, imagery) or its names
  (template and keep-out zones), restyling the names already placed on them.
- **Imagery of your own.** Under the Look sheet: any XYZ tile address (`https://…/{z}/{x}/{y}.png`,
  with your own key if it needs one) or a PMTiles archive on the web is drawn over the ground and
  under every line - in a downloaded area, under its roads and buildings too - in the preview and the
  render alike, at the opacity you set. The credit you type goes on the map's credit line and into
  the scene's credit layer. Nothing is bundled and nothing is cached beyond the session: the source's
  terms are yours to keep. **Open services** lists aerial pictures governments publish for anyone to
  use - the United States (USGS), the Netherlands (PDOK), Switzerland (swisstopo), France (IGN), Japan
  (GSI), Spain (PNOA), Austria (basemap.at), Czechia (ČÚZK), Luxembourg (ACT) and Estonia
  (Maa-amet), each checked with its licence - and picking one fills the address and the credit. An
  address that counts tile rows from the south ({-y}) works too.
- **A legend for the heat.** Add legend works with heat alone, or with heat and colours together: three
  steps, low to high, in the ramp's colours, named after the column.
- **Districts from the Data sheet.** With Match set to Districts, pick any country: if its districts
  are not on this computer yet, the sheet says so and offers the download right there (the same
  geoBoundaries download the Highlight sheet makes), and the table joins to them as soon as they
  arrive.
- **The names already on the map follow the template.** Changing a name's colour, size, halo,
  capitals or font in the Labels sheet - or picking a style up from a text layer - now restyles the
  names Auto labels placed and the numbers of a data map at once, in one undo step, instead of
  only the names placed afterwards. Capitals come off again as well as on: every name keeps the
  words it was placed with. Switching dots off removes them; switching them on needs the names
  placed again, and the panel says so.

## 0.4.0 — spikes, heat, flows in colour, your layer on every place, and the look's details (2026-09-23)

- **The numbers sample.** Maps list > Build the numbers sample: a world map of every country by its
  population from the bundled data, with the colours, spikes for the numbers and a legend, ready to
  render - a data map to take apart before bringing your own CSV.
- **New versions, and problems.** The panel looks at the release list on GitHub once a day and says
  when a newer version is out (Get it / Later); the Maps screen has the switch to turn that off, and
  it is one request that sends nothing. Report a problem writes a text file with the panel's last
  messages to your LazyMapLayers folder and opens a new issue for you to paste it into - nothing
  leaves your computer on its own.
- **The look's details.** Under the colours of the Look sheet: how heavy the lines are (borders,
  coasts, rivers, province lines), how wide the roads of a detailed region, and whether the map
  draws fewer or more names. They apply to every look, bundled or your own, in the preview and the
  render alike, and are kept with the map.
- **What is here.** A readout in the preview follows the pointer: the coordinates, the nearest
  place, its district (when downloaded) and province, and the country - "23.8103, 90.4125 · Dhaka ·
  Bangladesh" - all from the bundled data, offline.
- **Your own layer on every place.** Select a layer in After Effects - an icon, a flag, a photo, a
  precomp - and the Data sheet copies it onto every place of the table, each copy named after its
  place, sized so its area stands for the number (the largest at the layer's own size, none below a
  fifth) and wired to its place like an attached layer. Without a table, the places of the last
  imported file get a copy each. The original is left as it is; Unlink puts a copy back to plain.
- **Numbers by district.** A table of a country's districts (counties, departments) joins to the
  districts downloaded for that country, by name, and colours them from their own outlines, with
  bubbles, spikes, values, heat and the legend all following. The Match box has a Districts choice;
  left on "Whatever fits", the panel tries the downloaded districts as well and takes the level most
  rows fit.
- **Heat.** The places of a table warm the map around them by their numbers (or the places of the
  last imported file, alike), and the renderer draws the warmth in the colours of the ramp as a
  layer of its own that follows the camera - one image sequence, however many points. How far each
  place reaches is a number in the Data sheet; the ramp and opacity are the ones the colours use.
- **Spikes.** The numbers of a table as spikes on the map: one shape layer with a triangle per place
  rising straight up the frame, its height standing for the value, read straight (twice the value,
  twice the height). The tallest is as tall as you set, every spike has its own transform to
  animate, and the legend shows three heights beside the colours and the circles. In the accent
  colour, or each in the colour of its step.
- **Pins and routes named after their place.** A pin dropped on or near a town is "Pin: Dhaka", not
  "Pin 7", and a route drawn between two towns is "Dhaka to Chittagong" (a second pin on the same
  place is "Dhaka 2"). Far from any named place, the numbers stay.
- **Flows in step colours.** The Flows row has an "In step colours" switch: every arc takes the colour
  of its step of the ramp chosen above it (the same ramp, steps and method as the data fill), so a
  map of flows reads by colour as well as by width. Off, every arc keeps the look's accent colour.
- **Shape layers with two levels of detail.** An outline added as a shape layer now carries a coarse
  set of points for when the map is zoomed out and a fine one (four times as many) for when it is
  zoomed in past zoom 5.5, and only the level in use is worked out on each frame. Coastlines stay
  crisp when the camera comes close, at no cost at world zooms. The coarse points are part of the
  fine ones, so the outline never jumps at the switch. The bundled country outlines carry three times the
  points they did, so there is detail to show.
- **Five more looks.** Noir (black and white, high contrast), Slate (blue-grey newsroom), Terracotta (warm
  sand and clay), Arctic (ice-blue sea, near-white land) and Emerald (deep green land, gold lines) join
  the seven. Each is built from three colours with the same rules as a look of your own, so the names
  read on the land in every one of them. Twelve looks now.
- **Flows.** A table with a place at each end of a row and an amount - migration, trade, flights - is drawn
  as one great-circle arc per row whose width follows the amount, all drawing on together from the
  current time, with an arrow riding each one if you like. Places are found the way the search box
  finds them (a city, a country, a province, or "23.8, 90.4"), and a name the panel cannot place is
  listed rather than guessed. The Data sheet shows the Flows row as soon as a table has two columns
  of names.

## 0.3.1 — an arrow on any route, renders on disk, and a render whose map is gone (2026-09-22)

- **An arrow on a route you clicked.** The Route tool's sheet now has **Arrow** (and Comet and
  Dashed): the arrow rides the great-circle line as it draws on and turns with it. Parent your own
  plane or car to the Traveller layer. Before, only imported lines could carry one.
- **Renders on disk.** The Render tab shows what the renders take: this project's, next to the
  project file, and those of unsaved projects in the data folder - and removes the ones that belong
  to unsaved projects that are closed, which nothing can reach again. A day of test renders had
  quietly grown to 57 GB.
- **A render whose map is not in this project says so.** The render queue is kept in the data
  folder, so a job from another project used to come back and fail with "MAP_NOT_FOUND: No map layer
  with id …". It now waits with a plain sentence and no Resume button, and comes back to life when
  its own project is opened.
- The installer's read me and the README walk through a first flight, click by click: Dhaka to
  Chittagong with an arrow.

## 0.3.0 — your own looks, numbers on the map, OpenStreetMap features and label templates (2026-09-22)

- **Your own colours, or a film's.** The Look sheet now has **Your own colours**: the sea, the land,
  the lines and the names. Everything else - roads, borders, buildings, parks, coasts, the sky - is
  worked out from them, and the names are pushed until they can be read on whatever land you chose.
  **From a picture** takes the palette of a still from your film and builds the map look from it, so
  a map matches the piece it sits in. **Back to** the look you started from puts it all back.
  **Save the look** writes it to a small file to keep or share, and **Open a look** takes one back -
  or an Illustrator or Photoshop palette (.ase, .act), which becomes a map look in one click.
- **Your numbers on the map.** Import a CSV with a country column and a column of numbers and every
  country is filled with the colour of its step, as one layer above the basemap. A table of states,
  provinces or regions works the same way: the panel works out which country they belong to and
  matches their names or their short codes (CA, US-CA, Calif.). Countries are found
  by name in any of the 26 languages the panel carries, by ISO code (two letters, three letters or
  the number), or by the code the map itself uses; rows that match nothing are listed instead of
  being coloured on a guess. Five colour ramps, three to nine steps, even steps or equal counts, and
  a legend in the sheet. **Add legend** puts that legend into the scene as an ordinary precomp - a
  background, the title and one row per step, all real layers you can move, restyle or animate. On a
  dark map the ramp starts turned over, so the big numbers are the bright ones.
- **Numbers as bubbles.** **Add bubbles** puts a circle on every place, its area standing for the
  value, as one layer with a group per circle: they follow the camera like a pin and each one can be
  animated on its own. The legend then shows three circle sizes under the colour steps, so a viewer
  can read them. **Add numbers** writes each value next to its place as an ordinary text layer, in
  the font your names use, under the circle when there is one.
- **Any place on OpenStreetMap, straight into your map.** A new tool in the toolbar: type a name (or
  pick Water, Parks and forest, Islands, Airports, Boundaries, Buildings, Roads or Railways) and it
  finds what OpenStreetMap holds for the area the preview shows. A lake comes with its islands as
  real holes, a river as a line you can draw on, a district as an outline you can highlight or add
  as an editable shape layer — it all arrives as an import, so everything you already do with a
  GeoJSON file works with it. Searches are kept on disk, so the same one costs nothing twice.
- **The names look how you want them.** A **How the names look** row in the Labels sheet sets the
  colour, the size, the halo and whether country names are in capitals and cities get a dot. Every
  new label follows it. **From the selected text layer** takes the font, size, colour and halo of a
  title you styled yourself in After Effects, so the map matches the rest of your project in one
  click; that font is used for Latin, Cyrillic and Greek names, while Bengali, Arabic, Chinese and
  the rest keep fonts that shape them correctly. **Follow the look** goes back to the look's own
  names.
- **Keep the names out of your titles.** Under **Keep the names out of** in the Labels sheet, one
  click blocks the lower third, the top bar, a side third or the middle of the frame, and **From the
  selected layers** blocks whatever your own layers cover — only for the seconds those layers are on
  screen. The blocked areas are drawn over the preview, so you see what is left before you place the
  names.
- **Make the area you need.** Under **Make a new area** in the Highlight sheet: **Merge into one**
  puts every highlighted country, province, district or imported area together as a single shape
  with the borders between them gone (the European Union as one outline, not twenty-seven);
  **Grow** and **Shrink** push the edge out or pull it in by a distance in kilometres; and
  **Circle here** drops a distance ring around the middle of the preview. Each one becomes an
  ordinary area, so it renders as its own layer and can be added as an editable shape layer.
- **Any outline as an editable shape layer.** Next to every highlight in the Highlight sheet there
  is now a **Shape** button: it adds that country, province, district or imported area to the comp as
  an ordinary After Effects shape layer. Real paths, a fill and a stroke you can restyle, trim,
  animate or parent by hand, and they follow the map at every frame: the drawn outline covers the
  country the renderer draws to 98 %. Holes stay holes (Lesotho inside South Africa), the outline
  sits on the ground of 3D terrain, and **Shape layers draw on** trims them on over four seconds
  from the current time. Country outlines are part of the panel (Natural Earth, 258 countries).
- **Your own layers on a place.** A new tool in the panel: select your layers in After Effects
  (an icon, a photo, a precomp, text), click the place on the map, and they stay on it while the
  camera moves. They get the controls a pin has (Latitude, Longitude, Elevation, Grow with the map,
  Turn with the map), and nothing else about them changes: their size, their comment and any
  expression you wrote yourself are kept, and **Unlink selected** puts them back exactly as they
  were. A layer lands within 0.008 px of the place the camera maths gives.
- **Pins, routes and callouts follow the look.** Every look now carries an accent colour (gold on
  Midnight, ink red on Paper, yellow on Blueprint), and the layers the panel makes take it: a pin's
  dot, a route and its arrow, a callout's leader, box and text. Dark looks glow, light ones do not.
  The Look sheet has a **Pins, routes and callouts** row to override the colour, the line width and
  the glow for one map, **From the selected layer** to take the colour and width of a layer you
  styled yourself, and **Follow the look** to go back.
- **Comet trails and dashed lines.** Two switches next to a route: **Comet** adds a bright head
  that chases the tip of the line as it draws on (the same path trimmed at both ends, so it follows
  every bend), and **Dashed** draws the line as a dashed one. Both work for great-circle routes and
  for imported tracks, at an even pace or a recorded one.
- **Save the map as GeoJSON.** A button in the toolbar writes what is on the map back out as a
  GeoJSON file: pins and attached layers as points, routes as lines, shape layers as polygons,
  callouts as points with their title, and highlighted areas as polygons. The geography comes from
  the layers themselves, so a route you moved in After Effects exports where it now is.
- Outlines are thinned by how much shape each point carries, so a crenulated coastline (Norway,
  Canada) keeps its character instead of growing spikes where fjords collapse.
- Routes, travellers and outlines ask After Effects for its layer transforms once per frame instead
  of once per point, which cuts hundreds of calls per frame from every linked layer.

## 0.2.0 — cinematic camera, looks, terrain, highlights, districts and more files (2026-09-18)

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
  and the mattes still follow the land's outline exactly.
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
- **Satellite and relief packs download from the panel.** The Look sheet offers the two imagery
  packs when they are missing: **Satellite pictures** (NASA Blue Marble, 20 MB) and **Shaded
  relief** (Natural Earth, 48 MB), downloaded once from the project's GitHub page ("Imagery packs 1"
  release) into your data folder, checked by size and checksum, then used offline.
- **3D terrain and shaded slopes.** The Look sheet has a **Terrain** row: download an elevation
  pack for the area in the preview (open elevation data through Mapterhorn: the Copernicus 30 m
  model and national surveys, cut out of a 355 GB planet archive so only your area comes down, size
  shown before the download; Everest at full detail is 20 MB, Paris 3 MB). With a pack, **Shaded
  slopes** draws sharp hillshading at any zoom, and **3D height** raises the ground into real
  mountains (1× true to scale, up to 4×), in the preview and in every render, with the sky above the
  horizon. Pins, labels, callouts, routes and travellers made with a pack sit on the ground: a pin on
  Everest's peak lands within half a pixel of where the render draws the peak. The height and the
  ground level live in two sliders on the map layer (**Terrain Height**, **Ground Level**); key
  Terrain Height and the mountains rise frame by frame, in the render and in After Effects alike.
  Renders that use a pack add "Terrain: © Mapterhorn" to the data credit layer.
- **Sky above the horizon.** A tilted flat map now ends in the look's sky and haze instead of
  black. It belongs to the base pass (and the water pass, which holds the background); every other
  pass stays clear above the horizon, and on the globe the atmosphere no longer leaks into the roads,
  boundaries or highlight passes. **Sky above the horizon** in the Look sheet switches it off, which
  leaves the sky transparent for one of your own.
- **Districts, counties and departments.** In the Highlight tool, **Districts** makes a click pick
  the second-level unit under it. A country's districts are downloaded once, when you ask: the panel
  shows what geoBoundaries (open data) offers for the country you clicked, with its source, licence
  and size (Bangladesh: 64 districts, 1.7 MB; the United States: 3,233 counties, 7.9 MB), and
  **Download** installs it in under a second. Installed districts are found by search ("Sunamganj ·
  District, Sylhet, Bangladesh"), neighbours share exactly the same border, and renders that use
  them add "Boundaries: geoBoundaries" to the data credit layer. Nothing goes online unless you
  click a country with Districts switched on.
- **Every highlight is its own layer.** A render gives each highlighted country, province or area
  its own layer in the map comp ("Highlight: Bangladesh"), areas above countries, so they can fade
  in one after another or be styled one by one. Changing or removing one highlight redraws only
  that layer; the others come from the cache. **One layer for all highlights** in the Highlight
  sheet brings back a single layer, which renders faster when a map has many.
- **More files: KMZ, CSV and shapefiles.** The import button also reads KMZ (Google Earth), zipped
  shapefiles (a .prj inside is honoured, so projected data lands in the right place) and lone .shp
  files, and CSV or TSV tables. A table's columns are found by their headings (lat, latitude, lon,
  lng, x, y, one "position" column, name, time), in any order, with semicolons and decimal commas
  too; without headings it is read as latitude, longitude, name. Named rows become places and the
  journey through them in row order; a long table without names (a flight log, a GPS export) becomes
  a track.
- **Recorded pace.** Tracks that carry times (GPX, flight logs as CSV) can draw on the way they were
  recorded: fast where the recording was fast, slow where it was slow, squeezed into the duration
  you choose. Stops longer than 2 % of the moving time are shortened, so a lunch break does not
  freeze the animation. Trim Paths and the traveller get the same few linear keys (the turning
  points of the pace, 80 at most), so they stay together and can be retimed by hand.
- **Long legs bend with the globe.** A line between far places (a CSV of cities, a two-point KML
  path) follows the great circle in pieces of 2 degrees, like a flight route, and draws correctly
  on the globe. Outlines of areas stay straight, as their fills are.
- The file listed in the Import sheet is drawn over the preview (lines and places), so you see a
  track before you draw it. It is a guide in the panel only and never renders.
- Fixed: a GPS track that repeats a position (standing still) lost all of its times on import.
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
