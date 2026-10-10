# Recipes

Whole pieces, from an empty project to a render, each using several chapters. Every step names its
chapter, so you can look up what a control does.

## A flight from one city to another, with an arrow

1. **New map**, Globe on ([4](04-maps-screen.md), [5](05-map-settings.md)).
2. Search the first city, scroll to the zoom you want, tilt a little; **Shots** tab > **+ Shot**
   ([6](06-search.md), [9](09-shots.md)).
3. Search the second city, frame it, **+ Shot**.
4. Click the move: **Along route**, 6 s, **Cinematic**, **Turn with the route**. **Play**, then
   **Apply to timeline**.
5. **Route** tool: click the first city, then the second; **Arrow** on; **Draws on over** the same
   6 s; **Add route** at the time the move starts ([12](12-routes.md)).
6. Parent your own plane to the **Traveller** layer.
7. **Auto labels** > **Place labels** ([20](20-auto-labels.md)).
8. **Preview**, check, **Render** ([36](36-render.md)).

## A data map

1. **New map** on the world, flat.
2. **Numbers** > your CSV of countries and a number ([28](28-numbers-colour.md)). Check the match
   line: fix any row it lists.
3. **Colour the map**. Try **Equal counts** if a few large numbers flatten the rest.
4. **Add bubbles** or **Add spikes** for the amount ([29](29-bubbles-spikes-heat-shapes.md)).
5. **Add legend** bottom left, **Add chart** top right ([31](31-legend-chart.md)).
6. **Render**. Change the ramp, render again: only the fill changes.

## A map that runs through the years

1. A table with a column per year (or a row per place per year).
2. **Numbers** > open it, tick **Animate over the years**, **Colour the map** ([33](33-years.md)).
3. **Add the year**; **Add chart** > **Lines over the years**.
4. Retime the **Data Time** slider on the map layer: hold on the key years.
5. Optional: **3D: raise by the numbers** and a tilted camera ([34](34-prism.md)).

## A city at street level

1. Move the preview over the city, zoomed in until it fills the preview.
2. **Download this area**, name it, detail 14 or 15, **Check size**, **Download**
   ([27](27-download-area.md)).
3. **New map** on the city. Tilt the preview: buildings rise.
4. **Look > Terrain > Download…** for the hills ([25](25-terrain.md)).
5. **Auto labels** with **Streets and landmarks** on ([20](20-auto-labels.md)).
6. A flight from space with **Fly here**, Globe on ([8](08-quick-camera.md)).

## Your own look, every map

1. **Look > From a picture** with a still of your film, or set Sea, Land, Lines and Names by hand
   ([22](22-looks.md)).
2. **Look > Details**: lines heavier, names fewer.
3. **Auto labels > From the selected text layer** with a text layer in your film's font
   ([20](20-auto-labels.md)).
4. **Save the look**. In the next project, **Open a look**.
5. With several maps: **Use for every map** in Look and in Auto labels.

## Your artwork on every capital

1. Colour the map by a table of countries ([28](28-numbers-colour.md)).
2. Draw or import your icon in the scene comp and select it.
3. **Copy selected layer onto places**, **Sized by number** on or off ([30](30-values-and-copies.md)).
4. Hide the original. Pop the copies on in turn with Scale keys.

## A split screen with an overview

1. Make and animate the main map.
2. **New map** with **Put it into the open comp**; scale it into a corner ([5](05-map-settings.md)).
3. In its **Map settings**: **Follow the camera of** the main map, **Zoom offset** −3, **Tilt** off.
4. Give it its own look; render both.

## A partition map, 1945 to 1947

1. **New map** over South Asia, a little tilted.
2. **Look > Historical borders**: Download once, Year **1945**, Move to **1947**, **Add the year**
   ([Historical borders](historical-borders.md)).
3. **Auto labels**: the British Raj fades out as India and Pakistan fade in
   ([20](20-auto-labels.md)).
4. A slow push in with **Fly here** ([8](08-quick-camera.md)). **Render**.

## A distance ring around an event

1. Frame the place in the preview, centred.
2. **Highlight** sheet: type the distance in **km**, **Circle here** ([14](14-highlights.md)).
3. **Shape** on the new area, with **Shape layers draw on**.
4. Pin the place; a **Callout** with the distance ([10](10-pins.md), [11](11-callouts.md)).

## A journey from a GPS track

1. **Import** the GPX ([16](16-import.md)).
2. **Camera** on the track: shots along it in the Shots tab; **Apply to timeline**.
3. **Draw + arrow** with **Recorded pace** on, over the same length.
4. **Pin N places** for the waypoints.
5. **Look > Terrain** with the world pack or a finer one, so the track sits on the hills.
