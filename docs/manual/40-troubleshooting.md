# 40. When something goes wrong

Start with the **log**: click the status line at the bottom of the panel ([chapter 2](02-panel-at-a-glance.md)).
Red lines say what failed and usually why.

## The panel

| What you see | What to do |
|---|---|
| LazyMapLayers is not in **Window > Extensions** | Restart After Effects: it only looks for new panels while it starts |
| The panel opens **blank** | Windows: run **Fix a blank panel.bat** from the download, restart After Effects. macOS: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1` in Terminal, restart |
| The **preview stays black** | Update the graphics driver. The panel needs WebGL 2 |
| Tools are **greyed out** | Select a map in the header, or make one (**New map**) |
| *the panel is busy* | It is rendering or downloading; wait, or cancel the job in the Render tab |

## In After Effects

| What you see | What to do |
|---|---|
| **Expression errors** in a new project | The project uses the Legacy ExtendScript expression engine. The panel's expressions run on it, but **File > Project Settings > Expressions > JavaScript** plays back faster |
| The basemap is **missing or black** in the comp | Press **Preview** or **Render**: the basemap only exists after a render |
| The basemap shows an **old camera** | Render again; only the changed frames are drawn |
| A pin or name **slides** off its place | Its Position was moved by hand: move it with its Latitude and Longitude effects instead. Or its **Map** effect points at another layer: pick the map layer again |
| You **duplicated a scene** | The copy gets a map of its own the next time the panel looks (the log says so). It shows the same frames until you render it. Ctrl+Z puts it back as a shared copy, and the panel leaves it that way |
| You **renamed** things | Nothing breaks: links go through effects, not names |
| Something the panel made is **wrong** | Ctrl+Z: every panel action is one undo step |

## Data and downloads

| What you see | What to do |
|---|---|
| *Too large to download in one go* | Zoom the preview in to the area you need, or pick less detail |
| A **search** finds nothing | Try the English or the local spelling, or **Search OpenStreetMap** for streets and addresses |
| **Rows did not match** in the Numbers sheet | They are listed by name: use the ISO code, or the spelling the map uses |
| No **district set** for a country | geoBoundaries has none for it: import a KML, GeoJSON or shapefile of its districts instead |
| **Satellite**: nothing clear found | Choose a longer **Within** (14 or 24 months) |
| Renders take **too much disk** | Render tab > **Renders on disk…** ([chapter 36](36-render.md)) |

## macOS

macOS is experimental: everything is tested on Windows and should work the same on a Mac, but it has
not been run on one yet. If something differs, please report it.

## Report a problem

**Maps > About > Report a problem** writes a report with the panel's last messages and your versions
to your LazyMapLayers folder, and opens a new issue on GitHub for you to paste it into. Nothing is
sent by itself. Say what you did, what you expected and what happened; a screenshot helps.

## Related

- [1. Installing](01-install.md)
- [39. Data, downloads, credits and working offline](39-data-offline.md)
