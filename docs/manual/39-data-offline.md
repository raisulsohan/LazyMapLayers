# 39. Data, downloads, credits and working offline

LazyMapLayers is free forever: no account, no key, no trial, no telemetry. Every map is drawn from open
data on your own computer, and the panel goes online only when you ask.

## What comes with the download

The installer puts all of this on your computer; it works with no internet connection:

| Data | Source | Used for |
|---|---|---|
| The world map, with the provinces of every country | Natural Earth (public domain) | Coastlines, borders, names; the globe and the continents to zoom 6 |
| OpenStreetMap for the whole world to zoom 9 | OpenStreetMap contributors (ODbL), through Protomaps | Coasts, rivers, lakes, roads, parks and borders under every map; takes over between zoom 6 and 7 |
| Elevation for the whole world to zoom 6 | Mapterhorn (open elevation data) | The **world** pack: 3D ground and shaded slopes at country scale |
| Satellite pictures | NASA Blue Marble (public domain) | The Satellite look |
| Shaded relief | Natural Earth | The Shaded relief switch |
| The districts of every country | geoBoundaries (open licences per country) | Highlights, numbers joined to districts, search |

`offline\CREDITS.txt` in the data folder lists every source and its licence.

## What goes online, and only when you ask

| You ask for | The panel asks | Shown first |
|---|---|---|
| **Download this area** | The free Protomaps planet build (OpenStreetMap) | Tiles and megabytes |
| **Terrain > Download…** | Mapterhorn | Tiles and megabytes |
| **Build for this area…** (satellite) | The Copernicus catalogue and Sentinel-2 scenes | Scenes, cloud, megabytes |
| **Find in view** (OpenStreetMap) | Overpass | |
| **Search OpenStreetMap for "…"** | Nominatim | |
| A district set not on the computer | geoBoundaries | Its size and licence |
| **Historical borders > Download** | The pack on the project's GitHub page (historical-basemaps, GPL-3.0) | 13.9 MB |
| **Imagery of your own** | The address you typed, while previewing and rendering | |
| **Look for new versions once a day** | GitHub's release list, once a day | Off with one switch |

Nothing about you or your project is ever sent.

## Where everything is kept

| | Windows | macOS |
|---|---|---|
| Data folder | `%APPDATA%\LazyMapLayers` | `~/Library/Application Support/LazyMapLayers` |
| Offline world | `offline\` | `offline/` |
| Downloaded areas | `regions\` | `regions/` |
| Elevation packs | `terrain\` | `terrain/` |
| Satellite and relief pictures | `imagery\` | `imagery/` |
| District sets | `boundaries\` | `boundaries/` |
| Historical borders | `history\` | `history/` |
| Script requests | `api\` | `api/` |
| Renders of unsaved projects | `renders\` | `renders/` |

## Credits on your map

Rendering a map adds **one small credit text layer** to the scene when the frame uses data that asks
for one:

| When the map shows | The credit |
|---|---|
| OpenStreetMap detail (the offline world closer in, or a downloaded area) | © OpenStreetMap contributors |
| District boundaries | Boundaries: geoBoundaries |
| Terrain | Terrain: © Mapterhorn |
| Historical borders (a year, or a highlight of the past) | Historical borders: historical-basemaps (GPL-3.0) |
| Imagery of your own | The credit you typed |
| A Sentinel-2 area | The Copernicus credit |

**Keep it, or put the credit in your end titles.** That is all the licences ask; commercial work is
fine with every source the panel uses.

## Related

- [1. Installing](01-install.md)
- [27. Downloading an area](27-download-area.md)
- [24. Imagery](24-imagery.md)
