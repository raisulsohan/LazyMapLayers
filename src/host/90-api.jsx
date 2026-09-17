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

LML.api.addLabels = function (args) {
    return LML.withUndo("Auto labels", function () {
        return LML.labels.addLabels(args);
    });
};

/** Several overlay layers (paths, boxes, texts) in one undo step: args.items = [{ type, ...args }]. */
LML.api.addOverlays = function (args) {
    return LML.withUndo(args.undoName || "Add overlays", function () {
        var results = [];
        var errors = [];
        if (args.replaceKinds) {
            for (var k = 0; k < args.replaceKinds.length; k++) LML.overlays.removeKind({ mapId: args.mapId, kind: args.replaceKinds[k] });
        }
        // Items are listed bottom to top; each new layer goes directly above the map layer, so build
        // the top one first.
        for (var i = args.items.length - 1; i >= 0; i--) {
            var item = args.items[i];
            item.mapId = args.mapId;
            // No chained ?: here: ExtendScript evaluates chained conditional operators wrongly.
            var result;
            if (item.type === "path") result = LML.overlays.addPath(item);
            else if (item.type === "box") result = LML.overlays.addBox(item);
            else result = LML.overlays.addText(item);
            for (var e = 0; e < result.expressionErrors.length; e++) errors.push(result.expressionErrors[e]);
            results.unshift(result.name);
        }
        return { layers: results, expressionErrors: errors };
    });
};

/** Keys a transform property of a tagged layer of the map: args { mapId, layerName, property: "opacity" | "scale", keys: [[frame, value]] }. */
LML.api.keyLayer = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    return LML.withUndo("Animate " + args.layerName, function () {
        for (var i = 1; i <= scene.numLayers; i++) {
            var layer = scene.layer(i);
            if (layer.name !== args.layerName || !LML.tag.read(layer)) continue;
            var match = args.property === "scale" ? "ADBE Scale" : "ADBE Opacity";
            var prop = layer.property("ADBE Transform Group").property(match);
            LML.overlays.keyFrames(prop, mapLayer, args.keys);
            return { layer: layer.name, keys: args.keys.length };
        }
        throw LML.util.error("LAYER_NOT_FOUND", "No tagged layer named " + args.layerName);
    });
};

/** A dark space gradient behind the map in its scene comp (for globe maps, whose space is transparent). */
LML.api.addBackground = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    return LML.withUndo("Add space background", function () {
        LML.labels.removeTagged(scene, args.mapId, "background");
        var solid = scene.layers.addSolid(args.color || [0.02, 0.035, 0.06], "Space", scene.width, scene.height, 1, scene.duration);
        try {
            var ramp = solid.property("ADBE Effect Parade").addProperty("ADBE Ramp");
            ramp.property("ADBE Ramp-0001").setValue([scene.width / 2, 0]);
            ramp.property("ADBE Ramp-0002").setValue(args.top || [0.05, 0.09, 0.16]);
            ramp.property("ADBE Ramp-0003").setValue([scene.width / 2, scene.height]);
            ramp.property("ADBE Ramp-0004").setValue(args.bottom || [0.005, 0.01, 0.02]);
            ramp.property("ADBE Ramp-0005").setValue(2);
        } catch (e) {
            // A flat colour is fine.
        }
        solid.moveToEnd();
        LML.tag.write(solid, { kind: "background", v: 1, mapId: args.mapId });
        return { layer: solid.name };
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
            time: comp.time,
            frameRate: comp.frameRate,
            width: layer.source ? layer.source.width : comp.width,
            height: layer.source ? layer.source.height : comp.height,
            view: LML.map.readViewAtTime(layer, comp.time)
        });
    }
    return out;
};

/** A flight or any baked camera move: one key per frame, replacing keys in its time range. */
LML.api.setViewKeys = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Fly to", function () {
        LML.map.setViewKeys(layer, args.times, args.views);
        if (args.moveTime) layer.containingComp.time = args.times[args.times.length - 1];
        return { keys: args.times.length };
    });
};

/** Keys any slider control on the map layer (created if missing), for example "Borders Draw-on". */
LML.api.setControlKeys = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Animate " + args.name, function () {
        var prop = LML.map.controlValueProperty(layer, args.name);
        if (!prop) {
            var effect = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            effect.name = args.name;
            prop = effect.property(1);
        }
        for (var k = prop.numKeys; k >= 1; k--) prop.removeKey(k);
        if (args.times.length === 1) prop.setValue(args.values[0]);
        else prop.setValuesAtTimes(args.times, args.values);
        return { keys: args.times.length };
    });
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
