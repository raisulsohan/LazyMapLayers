# Driving LazyMapLayers from a script

The panel can be driven by another program on the same computer: your own ExtendScript, a Node
script, a Python job, anything that can write a file. You leave a request in a folder, the panel does
it and writes the answer beside it.

This is **off** until you turn it on: **About → Let scripts on this computer drive the panel**. Only
the calls listed below can ever be asked for, and nothing in a request file is run as code.

## The folder

| Windows | `%APPDATA%\LazyMapLayers\api` |
| macOS | `~/Library/Application Support/LazyMapLayers/api` |

Write `<name>.json`; the panel removes it and writes `<name>.result.json` next to it, usually within a
second. A request that is never answered (the panel was closed) is swept away after ten minutes.

A request:

```json
{ "id": "job-1", "call": "addPin", "args": { "lat": 23.8106, "lng": 90.4125, "name": "Dhaka" } }
```

An answer:

```json
{ "id": "job-1", "ok": true, "result": { "log": ["pin added at 23.81, 90.41"] } }
```

or

```json
{ "id": "job-1", "ok": false, "error": "no map is selected; call select first, or make one with newMap" }
```

The panel does one thing at a time. A call that arrives while it is busy - rendering, downloading -
is refused with `the panel is busy`; try it again in a moment.

## The calls

| Call | Arguments | What it does |
|---|---|---|
| `version` | | The panel's version, the request format's version, and every call this build offers. |
| `maps` | | Every map in the project: its id, comp name, size and frame rate. |
| `select` | `mapId` | Works on that map from now on. |
| `view` | | Where the selected map is looking. |
| `setView` | `lat`, `lng`, `zoom`, `bearing`, `pitch`, `keyframe`, `glide` | Moves the map; `keyframe: true` also keys the camera at the current time. |
| `newMap` | `name`, `width`, `height`, `frameRate`, `duration`, `newScene` | A new map at the view on screen. |
| `addPin` | `lat`, `lng`, `threeD` | A pin on a place. |
| `labels` | | The names of the places in view, placed over the whole timeline. |
| `removeLabels` | | Takes this map's names off. |
| `highlight` | `codes` | Highlights countries by their three-letter code (`["IND","FRA"]`). |
| `clearHighlights` | | Removes every highlight from this map. |
| `look` | `theme` | One of the bundled looks, by its id. |
| `render` | `quality` | `preview` or `final`; the render runs in the background. |
| `csv` | `path` | Reads a table of numbers from a file and keeps reading it as it changes. |
| `colour` | | Colours the map by the table that is open. |
| `scaleBar` | `corner`, `units` | A scale bar, in `metric` or `imperial`. |
| `northArrow` | `corner`, `letter` | A north arrow that turns with the map. |
| `inset` | `corner`, `zoomOut` | An inset locator map with a view box. |
| `chart` | `corner`, `bars` | A bar chart of the numbers. |
| `legend` | `corner` | The legend of the numbers. |

`corner` is one of `bottomLeft`, `bottomRight`, `topLeft`, `topRight`. Anything a call does not
understand is refused with a message that says what it expected.

## An ExtendScript helper

Save this beside your own script and `#include` it, or paste it in. It writes a request, waits for
the answer and gives it back as an object.

```javascript
// LazyMapLayers.jsx - talks to the LazyMapLayers panel. The panel has to be open, with
// "Let scripts on this computer drive the panel" turned on in About.
var LazyMapLayers = (function () {
    function folder() {
        var base = $.os.indexOf("Windows") >= 0 ? Folder("~/AppData/Roaming/LazyMapLayers") : Folder("~/Library/Application Support/LazyMapLayers");
        var api = Folder(base.fsName + "/api");
        if (!api.exists) api.create();
        return api;
    }

    function write(file, text) {
        file.encoding = "UTF-8";
        if (!file.open("w")) throw new Error("cannot write " + file.fsName);
        file.write(text);
        file.close();
    }

    function read(file) {
        file.encoding = "UTF-8";
        if (!file.open("r")) return null;
        var text = file.read();
        file.close();
        return text;
    }

    /** Asks the panel for one call and waits up to `seconds` for the answer. */
    function call(name, args, seconds) {
        var api = folder();
        var id = "js" + new Date().getTime() + Math.floor(Math.random() * 1000);
        var request = File(api.fsName + "/" + id + ".json");
        var answer = File(api.fsName + "/" + id + ".result.json");
        write(request, '{"id":"' + id + '","call":"' + name + '","args":' + (args || "{}") + "}");
        var waited = 0, step = 200, most = (seconds || 30) * 1000;
        while (waited < most) {
            $.sleep(step);
            waited += step;
            answer = File(answer.fsName);
            if (answer.exists) {
                var text = read(answer);
                answer.remove();
                return text;
            }
        }
        request.remove();
        throw new Error("LazyMapLayers did not answer in " + (seconds || 30) + " s. Is the panel open, with scripting turned on?");
    }

    return { call: call };
})();
```

Using it:

```javascript
#include "LazyMapLayers.jsx"

alert(LazyMapLayers.call("version"));
LazyMapLayers.call("newMap", '{"name":"Delta","newScene":true}', 60);
LazyMapLayers.call("setView", '{"lat":23.81,"lng":90.41,"zoom":7,"keyframe":true}');
LazyMapLayers.call("addPin", '{"lat":23.81,"lng":90.41}');
LazyMapLayers.call("scaleBar", '{"corner":"bottomLeft","units":"metric"}');
LazyMapLayers.call("render", '{"quality":"final"}');
```

The answers come back as JSON text; parse them however your script likes.

## From Node, Python or a shell

Nothing about this is particular to ExtendScript. Write the file, wait for `<name>.result.json`,
read it, remove it. A job that runs while nobody is watching can drive a whole scene this way.
