# LazyMapLayers FAQ

These answers come from what testing LazyMapLayers on real installs ran into. Questions from
[issues](https://github.com/raisulsohan/LazyMapLayers/issues) and
[Discussions](https://github.com/raisulsohan/LazyMapLayers/discussions) are added as they come.

## Installing

**The panel is not in Window > Extensions.** Restart After Effects: it looks for new panels only while
it starts. LazyMapLayers needs After Effects 2024 or newer.

**The panel opens blank.** Windows: run *Fix a blank panel.bat* from the download, then restart After
Effects. macOS: in Terminal run `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`, then restart.

**Full, Light or Online?** Maps look the same with each. *Full* (about 2 GB) works with no internet
down to city level, with elevation, satellite pictures and districts. *Light* (about 120 MB) and
*Online* fetch closer detail as your maps need it and keep it. Run the installer again to change.

**macOS refuses the installer.** Right-click *Install LazyMapLayers (macOS).command* and choose Open.

## Using it

**The preview stays black.** The panel needs WebGL 2: update the graphics driver.

**A render says some frames lack street detail.** The computer was offline (or *Street detail from the
internet* is off under Maps > About). Render again when online; only those frames are drawn again.

**Expression errors in a new project.** The project uses the Legacy ExtendScript expression engine.
The panel's expressions run on it, but File > Project Settings > Expressions > JavaScript is faster.

**Where does the data go, and how do I free space?** `%APPDATA%\LazyMapLayers` (Windows) or
`~/Library/Application Support/LazyMapLayers` (macOS). Renders of a saved project sit in a
*LazyMapLayers Renders* folder next to it; the Render tab's *Renders on disk* cleans up the rest.

**Can I use Google, Bing or Esri imagery?** Not built in: their terms forbid caching and rendering
their tiles into video. Bring any XYZ, WMS, tile folder or MBTiles you have the right to use, or pick
an open government service from the Look sheet.

## Free and private

**Is it free for paid work?** Yes, with no account, key or trial. Keep the small credit layer the
panel adds (for example "© OpenStreetMap contributors"), or put the credit in your end titles.

**Does it send anything?** No. It goes online only for what you ask, once a day to look at the release
list (switch under Maps > About), and for street detail as maps need it (switch there too).

## Reporting a problem

**How do I report one?** Maps > About > **Report a problem**. It runs the **Self-test** (a few seconds:
the host script, one rendered frame, a map comp made and removed again in one undo step, pins against
the camera, the map data on disk), puts the report on your clipboard and opens the issue form with your
versions filled in. Paste the report and submit. Your project is left as it was, and nothing is sent
until you submit.

**I have a Mac.** Please report, also when everything works: LazyMapLayers is tested on Windows and
macOS is experimental until Mac users say how it does. The same one step works there.
