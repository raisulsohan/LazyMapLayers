/*
 * Map comps (Phase 0 skeleton; Phase 1 adds the camera rig).
 * A map comp is a tagged precomp. Its layer in the scene comp carries the camera controls.
 */
LML.map = LML.map || {};

LML.map.CONTROLS = [
    { name: "Latitude", matchName: "ADBE Slider Control", key: "lat" },
    { name: "Longitude", matchName: "ADBE Slider Control", key: "lng" },
    { name: "Zoom", matchName: "ADBE Slider Control", key: "zoom" },
    { name: "Bearing", matchName: "ADBE Angle Control", key: "bearing" },
    { name: "Pitch", matchName: "ADBE Slider Control", key: "pitch" }
];

LML.map.GLOBE_CONTROL = "Globe";

/** Style animations driven by sliders on the map layer (0 to 100). The renderer reads them per frame. */
LML.map.ANIMATION_CONTROLS = [{ name: "Borders Draw-on", key: "bordersDraw" }];

/** The animation controls present on a map layer, in ANIMATION_CONTROLS order. */
LML.map.animationControlsOf = function (layer) {
    var out = [];
    for (var i = 0; i < LML.map.ANIMATION_CONTROLS.length; i++) {
        var control = LML.map.ANIMATION_CONTROLS[i];
        var prop = LML.map.controlValueProperty(layer, control.name);
        if (prop) out.push({ name: control.name, key: control.key, prop: prop });
    }
    return out;
};

/** "globe" when the map layer's Globe checkbox is on (at the start of the comp), else "mercator". */
LML.map.projectionOf = function (layer) {
    var prop = LML.map.controlValueProperty(layer, LML.map.GLOBE_CONTROL);
    return prop && prop.valueAtTime(layer.startTime, false) ? "globe" : "mercator";
};

LML.map.uid = function () {
    return "m" + new Date().getTime().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
};

LML.map.projectFolder = function () {
    var root = app.project.rootFolder;
    for (var i = 1; i <= root.numItems; i++) {
        var item = root.item(i);
        if (item instanceof FolderItem && LML.tag.is(item, "folder")) return item;
    }
    var folder = app.project.items.addFolder("LazyMapLayers");
    LML.tag.write(folder, { kind: "folder", v: 1 });
    return folder;
};

LML.map.uniqueCompName = function (base) {
    var names = {};
    for (var i = 1; i <= app.project.numItems; i++) names[app.project.item(i).name] = true;
    if (!names[base]) return base;
    for (var n = 2; n < 10000; n++) {
        if (!names[base + " " + n]) return base + " " + n;
    }
    return base + " " + LML.map.uid();
};

LML.map.controlValueProperty = function (layer, name) {
    var effect = layer.property("ADBE Effect Parade").property(name);
    return effect ? effect.property(1) : null;
};

LML.map.createMapComp = function (args) {
    args = args || {};
    var active = app.project.activeItem;
    var reference = (!args.newScene && active instanceof CompItem && !LML.tag.is(active, "mapComp")) ? active : null;
    var width = args.width || (reference ? reference.width : 1920);
    var height = args.height || (reference ? reference.height : 1080);
    var duration = args.duration || (reference ? reference.duration : 10);
    var frameRate = args.frameRate || (reference ? reference.frameRate : 25);
    var view = args.view || { center: { lng: 0, lat: 20 }, zoom: 1.5, bearing: 0, pitch: 0 };

    var folder = LML.map.projectFolder();
    var id = LML.map.uid();
    var mapComp = app.project.items.addComp(LML.map.uniqueCompName(args.name || "Map"), width, height, 1, duration, frameRate);
    mapComp.parentFolder = folder;
    mapComp.bgColor = [0.05, 0.07, 0.1];
    LML.tag.write(mapComp, { kind: "mapComp", v: 1, id: id });

    var scene = reference;
    if (!scene) {
        scene = app.project.items.addComp(LML.map.uniqueCompName("Map Scene"), width, height, 1, duration, frameRate);
        LML.tag.write(scene, { kind: "scene", v: 1 });
    }

    var layer = scene.layers.add(mapComp);
    LML.tag.write(layer, { kind: "mapLayer", v: 1, mapId: id });
    var effects = layer.property("ADBE Effect Parade");
    for (var i = 0; i < LML.map.CONTROLS.length; i++) {
        var control = LML.map.CONTROLS[i];
        var effect = effects.addProperty(control.matchName);
        effect.name = control.name;
    }
    LML.map.setViewAtTime(layer, view, null);
    // Projection: a checkbox the expressions read; the renderer reads it at render time.
    var globe = effects.addProperty("ADBE Checkbox Control");
    globe.name = LML.map.GLOBE_CONTROL;
    globe.property(1).setValue(args.projection === "globe" ? 1 : 0);
    if (args.projection === "globe") {
        var mapTag = LML.tag.read(layer);
        mapTag.projection = "globe";
        LML.tag.write(layer, mapTag);
    }

    try {
        scene.openInViewer();
    } catch (e) {
        // No viewer in -noui mode.
    }
    return {
        id: id,
        mapCompId: mapComp.id,
        mapCompName: mapComp.name,
        sceneCompId: scene.id,
        sceneCompName: scene.name,
        layerIndex: layer.index
    };
};

/** Writes a view to the controls; with a time, sets keyframes at that time. */
LML.map.setViewAtTime = function (layer, view, time) {
    var values = { lat: view.center.lat, lng: view.center.lng, zoom: view.zoom, bearing: view.bearing, pitch: view.pitch };
    for (var i = 0; i < LML.map.CONTROLS.length; i++) {
        var control = LML.map.CONTROLS[i];
        var prop = LML.map.controlValueProperty(layer, control.name);
        if (!prop) continue;
        if (time === null || time === undefined) {
            if (prop.numKeys > 0) prop.setValueAtTime(layer.containingComp.time, values[control.key]);
            else prop.setValue(values[control.key]);
        } else {
            prop.setValueAtTime(time, values[control.key]);
        }
    }
};

/**
 * Replaces the camera keys between the first and last time with one key per given view
 * ([lat, lng, zoom, bearing, pitch], the order of LML.map.CONTROLS). Times are scene comp times.
 */
LML.map.setViewKeys = function (layer, times, views) {
    var from = times[0];
    var to = times[times.length - 1];
    var eps = 0.25 / layer.containingComp.frameRate;
    for (var c = 0; c < LML.map.CONTROLS.length; c++) {
        var prop = LML.map.controlValueProperty(layer, LML.map.CONTROLS[c].name);
        if (!prop) continue;
        for (var k = prop.numKeys; k >= 1; k--) {
            var t = prop.keyTime(k);
            if (t >= from - eps && t <= to + eps) prop.removeKey(k);
        }
        var values = [];
        for (var i = 0; i < views.length; i++) values.push(views[i][c]);
        prop.setValuesAtTimes(times, values);
    }
};

/** The controls live on the map layer, so `time` is the scene comp's time, not the map comp's. */
LML.map.readViewAtTime = function (layer, time) {
    var read = function (name) {
        var prop = LML.map.controlValueProperty(layer, name);
        return prop ? prop.valueAtTime(time, false) : 0;
    };
    return {
        center: { lat: read("Latitude"), lng: read("Longitude") },
        zoom: read("Zoom"),
        bearing: read("Bearing"),
        pitch: read("Pitch")
    };
};

LML.map.findMapLayers = function () {
    var found = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var comp = app.project.item(i);
        if (!(comp instanceof CompItem)) continue;
        for (var l = 1; l <= comp.numLayers; l++) {
            var layer = comp.layer(l);
            if (LML.tag.is(layer, "mapLayer")) found.push(layer);
        }
    }
    return found;
};
