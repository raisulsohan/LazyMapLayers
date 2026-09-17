/*
 * Functions the panel may call through LML.call(name, argsJson).
 */
LML.api.ping = function () {
    return {
        lml: LML.version,
        appVersion: app.version,
        buildName: app.buildName,
        language: app.isoLanguage,
        projectFile: app.project.file ? app.project.file.fsName : null
    };
};

LML.api.createMapComp = function (args) {
    return LML.withUndo("Create map comp", function () {
        return LML.map.createMapComp(args);
    });
};

LML.api.addPin = function (args) {
    return LML.withUndo("Add pin", function () {
        return LML.pins.addPin(args);
    });
};

LML.api.addCameraRig = function (args) {
    return LML.withUndo("Add 3D camera", function () {
        return LML.camera.addCameraRig(args);
    });
};

LML.api.sampleViews = function (args) {
    return LML.basemap.sampleViews(args);
};

LML.api.renderInfo = function (args) {
    return LML.basemap.renderInfo(args);
};

/** Imports or swaps rendered pass sequences (one undo step) and keeps the data credit in place. */
LML.api.importPasses = function (args) {
    return LML.withUndo(args.quality === "preview" ? "Update basemap preview" : "Update basemap", function () {
        return LML.basemap.importPasses(args);
    });
};

/** Pass layers of a map comp with their footage state, for the panel's render section. */
LML.api.listPasses = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var mapComp = mapLayer.source;
    var out = [];
    for (var i = 1; i <= mapComp.numLayers; i++) {
        var layer = mapComp.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "basemap") continue;
        var footage = layer.source instanceof FootageItem ? layer.source : null;
        var footageTag = footage ? LML.tag.read(footage) || {} : {};
        out.push({
            pass: tag.pass || "base",
            layerName: layer.name,
            enabled: layer.enabled,
            main: footageTag.main || "final",
            finalStamp: footageTag.finalStamp || null,
            proxyStamp: footageTag.proxyStamp || null,
            hasProxy: LML.basemap.hasProxy(footage),
            useProxy: footage ? footage.useProxy : false,
            path: footage && footage.mainSource.file ? footage.mainSource.file.fsName : null,
            proxyPath: LML.basemap.hasProxy(footage) && footage.proxySource.file ? footage.proxySource.file.fsName : null
        });
    }
    return out;
};

/** Stores per-map settings (such as the basemap source) in the map layer's tag. */
LML.api.setMapSettings = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    var tag = LML.tag.read(layer);
    if (args.basemap !== undefined) tag.basemap = args.basemap;
    if (args.render !== undefined) tag.render = args.render;
    if (args.projection !== undefined) {
        var globe = LML.map.controlValueProperty(layer, LML.map.GLOBE_CONTROL);
        if (!globe) {
            var effect = layer.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control");
            effect.name = LML.map.GLOBE_CONTROL;
            globe = effect.property(1);
        }
        globe.setValue(args.projection === "globe" ? 1 : 0);
        tag.projection = args.projection;
    }
    LML.tag.write(layer, tag);
    return tag;
};

/** Opens the map's scene comp in the viewer. */
LML.api.revealMap = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    layer.containingComp.openInViewer();
    return true;
};

LML.api.listMaps = function () {
    var layers = LML.map.findMapLayers();
    var out = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var comp = layer.containingComp;
        var tag = LML.tag.read(layer);
        out.push({
            mapId: tag.mapId,
            mapCompName: layer.source ? layer.source.name : layer.name,
            sceneCompId: comp.id,
            sceneCompName: comp.name,
            layerIndex: layer.index,
            basemap: tag.basemap || null,
            render: tag.render || null,
            projection: LML.map.projectionOf(layer),
            hasCamera: !!LML.camera.findRig(layer).camera,
            isActiveScene: app.project.activeItem === comp,
            view: LML.map.readViewAtTime(layer, comp.time)
        });
    }
    return out;
};

LML.api.setView = function (args) {
    var layers = LML.map.findMapLayers();
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (LML.tag.read(layer).mapId !== args.mapId) continue;
        return LML.withUndo(args.keyframe ? "Set view keyframe" : "Set view", function () {
            var time = args.keyframe ? layer.containingComp.time : null;
            LML.map.setViewAtTime(layer, args.view, time);
            return true;
        });
    }
    throw LML.util.error("MAP_NOT_FOUND", "No map layer with id " + args.mapId);
};

/*
 * Developer automation only: tools/ae-spikes.mjs creates the flag file, the panel calls this when
 * its spikes finish, and After Effects closes the throwaway test project unsaved and quits.
 * Without the flag file this does nothing.
 */
LML.api.devQuitAfterSpikes = function () {
    var flag = new File(Folder.temp.fsName + "/LazyMapLayers/spikes/allow-quit.flag");
    if (!flag.exists) throw LML.util.error("NOT_ALLOWED", "Quit is only allowed during an automated spike run");
    flag.remove();
    // Quitting inside the panel's own evalScript call does not close After Effects; do it right
    // after the call returns instead.
    app.scheduleTask("LML.devQuitNow()", 300, false);
    return true;
};

LML.devQuitNow = function () {
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.quit();
};

LML.loaded = true;
