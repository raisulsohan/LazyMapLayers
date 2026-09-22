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

/** The comp a new map would go into (the active comp, unless it is a map comp itself), or null. */
LML.api.activeComp = function () {
    var active = app.project.activeItem;
    if (!(active instanceof CompItem) || LML.tag.is(active, "mapComp")) return null;
    return { name: active.name, width: active.width, height: active.height, frameRate: active.frameRate, duration: active.duration };
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
    return LML.withUndo(args.undoName || "Auto labels", function () {
        return LML.labels.addLabels(args);
    });
};

/** Ends a batched label build that was cancelled or failed (brings the scene back into the viewer). */
LML.api.finishLabels = function () {
    return LML.labels.finish();
};

/** Removes every label Auto labels made for a map, in one undo step. */
LML.api.removeLabels = function (args) {
    var scene = LML.pins.findMapLayer(args.mapId).containingComp;
    return LML.withUndo("Remove labels", function () {
        return { removed: LML.labels.removeTagged(scene, args.mapId, "label") };
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
            else if (item.type === "shape") result = LML.overlays.addShape(item);
            else if (item.type === "traveller") result = LML.overlays.addTraveller(item);
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
    if (args.theme !== undefined) tag.theme = args.theme;
    if (args.relief !== undefined) tag.relief = !!args.relief;
    if (args.sky !== undefined) tag.sky = !!args.sky;
    if (args.terrain !== undefined) {
        tag.terrain = args.terrain;
        // The sliders linked layers read; a map without terrain gets a height of 0, so its layers stay flat.
        var height = args.terrain && typeof args.terrain.height === "number" ? args.terrain.height : 0;
        var ground = args.terrain && typeof args.terrain.ground === "number" ? args.terrain.ground : 0;
        LML.map.setControlValue(layer, "Terrain Height", height);
        LML.map.setControlValue(layer, "Ground Level", ground);
    }
    if (args.highlights !== undefined) tag.highlights = args.highlights;
    if (args.layerStyle !== undefined) tag.layerStyle = args.layerStyle;
    if (args.labelTemplate !== undefined) tag.labelTemplate = args.labelTemplate;
    if (args.keepOut !== undefined) tag.keepOut = args.keepOut;
    if (args.osmData !== undefined) tag.osmData = args.osmData;
    if (args.dataFill !== undefined) tag.dataFill = args.dataFill;
    if (args.highlightLayers !== undefined) tag.highlightLayers = args.highlightLayers === "one" ? "one" : "each";
    // Polygons of custom areas are large: they sit on their own comment line, like the shot list.
    if (args.areas !== undefined) {
      var hasAreas = false;
      for (var areaId in args.areas) {
        if (args.areas.hasOwnProperty(areaId)) hasAreas = true;
      }
      LML.tag.writeExtra(layer, "AREAS", hasAreas ? args.areas : null);
    }
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

/** The polygons of a map's custom highlight areas ({ id: MultiPolygon coordinates }). */
LML.api.getAreas = function (args) {
    return LML.tag.readExtra(LML.pins.findMapLayer(args.mapId), "AREAS") || {};
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
    var engine = null;
    try {
        engine = app.project.expressionEngine;
    } catch (e) {
        engine = null;
    }
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
            theme: tag.theme || null,
            relief: !!tag.relief,
            sky: tag.sky !== false,
            terrain: (function () {
                if (!tag.terrain) return null;
                // The sliders win over the tag: they may have been edited or keyed in After Effects.
                var t = { pack: tag.terrain.pack, shade: tag.terrain.shade, height: tag.terrain.height, ground: tag.terrain.ground };
                var h = LML.map.controlValue(layer, "Terrain Height");
                var g = LML.map.controlValue(layer, "Ground Level");
                if (h !== null) t.height = h;
                if (g !== null) t.ground = g;
                return t;
            })(),
            highlights: tag.highlights || [],
            highlightLayers: tag.highlightLayers === "one" ? "one" : "each",
            layerStyle: tag.layerStyle || null,
            labelTemplate: tag.labelTemplate || null,
            keepOut: tag.keepOut || null,
            osmData: tag.osmData === true,
            dataFill: tag.dataFill || null,
            projection: LML.map.projectionOf(layer),
            hasCamera: !!LML.camera.findRig(layer).camera,
            isActiveScene: app.project.activeItem === comp,
            time: comp.time,
            duration: comp.duration,
            layerStart: layer.startTime,
            hasShots: String(layer.comment).indexOf(LML.tag.EXTRA_PREFIX + LML.shots.KEY + ":") > 0,
            frameRate: comp.frameRate,
            width: layer.source ? layer.source.width : comp.width,
            height: layer.source ? layer.source.height : comp.height,
            view: LML.map.readViewAtTime(layer, comp.time),
            expressionEngine: engine
        });
    }
    return out;
};

/**
 * Makes the map long enough for its camera: the map comp, its layer and the scene comp grow to
 * args.duration seconds (nothing is ever shortened). Rendered frames cover the new time after the
 * next render.
 */
LML.api.extendDuration = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Extend map duration", function () {
        var scene = layer.containingComp;
        var mapComp = layer.source;
        var needed = args.duration;
        var mapNeeded = needed - layer.startTime;
        if (mapComp && mapComp.duration < mapNeeded) mapComp.duration = mapNeeded;
        if (scene.duration < needed) scene.duration = needed;
        if (layer.outPoint < needed) {
            var wasLocked = layer.locked;
            layer.locked = false;
            layer.outPoint = Math.min(scene.duration, layer.startTime + (mapComp ? mapComp.duration : needed));
            layer.locked = wasLocked;
        }
        return { sceneDuration: scene.duration, mapDuration: mapComp ? mapComp.duration : null };
    });
};

/** Renames the map comp (links are effect based, so nothing breaks). args: { mapId, name } */
LML.api.renameMap = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Rename map", function () {
        var name = String(args.name || "").replace(/^\s+|\s+$/g, "");
        if (!name) throw LML.util.error("BAD_ARGUMENT", "A map needs a name");
        if (layer.source && layer.source.name !== name) layer.source.name = LML.map.uniqueCompName(name);
        return { name: layer.source ? layer.source.name : layer.name };
    });
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
