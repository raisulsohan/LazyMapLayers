/*
 * Basemap sequences: the panel renders images for the map comp's frames; the host samples the camera
 * for every frame (and motion blur sub-frame) and imports or swaps the rendered sequences in the map
 * comp, one footage item per pass. Previews become After Effects proxies of final renders.
 */
LML.basemap = LML.basemap || {};

/** Pass order from the bottom of the map comp upwards. */
LML.basemap.PASS_ORDER = ["base", "land", "water", "boundaries", "roads", "buildings", "landMatte", "waterMatte"];

LML.basemap.passOrder = function (pass) {
    for (var i = 0; i < LML.basemap.PASS_ORDER.length; i++) {
        if (LML.basemap.PASS_ORDER[i] === pass) return i;
    }
    return LML.basemap.PASS_ORDER.length;
};

/** Whether any camera control is keyframed or driven by an expression. */
LML.map.isViewAnimated = function (layer) {
    for (var i = 0; i < LML.map.CONTROLS.length; i++) {
        var prop = LML.map.controlValueProperty(layer, LML.map.CONTROLS[i].name);
        if (!prop) continue;
        if (prop.numKeys > 0) return true;
        if (prop.expressionEnabled && prop.expression !== "") return true;
    }
    return false;
};

/** Everything the panel needs before rendering a map comp. */
LML.basemap.renderInfo = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var mapComp = mapLayer.source;
    var scene = mapLayer.containingComp;
    var fps = mapComp.frameRate;
    return {
        mapCompName: mapComp.name,
        width: mapComp.width,
        height: mapComp.height,
        frameRate: fps,
        frames: Math.max(1, Math.round(mapComp.duration * fps)),
        // Motion blur of the scene's own layers uses the scene comp's shutter.
        shutterAngle: scene.shutterAngle,
        shutterPhase: scene.shutterPhase,
        animated: LML.map.isViewAnimated(mapLayer),
        projectFolder: app.project.file ? app.project.file.parent.fsName : null
    };
};

/**
 * Camera values for frames of the map comp, read from the map layer's controls.
 * args: { mapId, firstFrame?, lastFrame?, offsets?: number[] (sub-frame offsets in frames), compact? }
 * compact: views[frame][offset] = [lat, lng, zoom, bearing, pitch]; otherwise one view object per frame.
 */
LML.basemap.sampleViews = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var mapComp = mapLayer.source;
    var fps = mapComp.frameRate;
    var frames = Math.max(1, Math.round(mapComp.duration * fps));
    var first = args.firstFrame || 0;
    var last = Math.min(frames - 1, args.lastFrame === undefined ? frames - 1 : args.lastFrame);
    var offsets = args.offsets || [0];
    var views = [];
    for (var f = first; f <= last; f++) {
        if (!args.compact) {
            // The controls sit on the layer in the scene comp: map comp time t is scene time t + startTime.
            views.push(LML.map.readViewAtTime(mapLayer, mapLayer.startTime + f / fps));
            continue;
        }
        var samples = [];
        for (var s = 0; s < offsets.length; s++) {
            var v = LML.map.readViewAtTime(mapLayer, mapLayer.startTime + (f + offsets[s]) / fps);
            samples.push([v.center.lat, v.center.lng, v.zoom, v.bearing, v.pitch]);
        }
        views.push(samples);
    }
    return {
        mapCompName: mapComp.name,
        width: mapComp.width,
        height: mapComp.height,
        frameRate: fps,
        frames: frames,
        firstFrame: first,
        views: views,
        projectFolder: app.project.file ? app.project.file.parent.fsName : null
    };
};

/** The tagged basemap layer of a pass in a map comp (layers from before passes count as "base"). */
LML.basemap.findPassLayer = function (mapComp, pass) {
    for (var i = 1; i <= mapComp.numLayers; i++) {
        var tag = LML.tag.read(mapComp.layer(i));
        if (tag && tag.kind === "basemap" && (tag.pass || "base") === pass) return mapComp.layer(i);
    }
    return null;
};

LML.basemap.findBasemapLayer = function (mapComp) {
    return LML.basemap.findPassLayer(mapComp, "base");
};

/** AVItem has no hasProxy attribute; proxySource is null without a proxy. */
LML.basemap.hasProxy = function (footage) {
    return !!footage && footage.proxySource !== null && footage.proxySource !== undefined;
};

LML.basemap.withUnlocked = function (layer, fn) {
    var locked = layer.locked;
    if (locked) layer.locked = false;
    try {
        return fn();
    } finally {
        if (locked) layer.locked = true;
    }
};

/**
 * Imports or swaps one pass sequence.
 * Final renders become the footage's main source. A preview becomes the main source while no final
 * render exists, and an After Effects proxy (switched on) once one does. A final render drops a
 * proxy that shows a different camera animation (stamps differ) and switches proxies off.
 */
LML.basemap.importPass = function (mapComp, mapId, sequence, quality, stamp) {
    var first = new File(sequence.firstFramePath);
    if (!first.exists) throw LML.util.error("FILE_NOT_FOUND", "Rendered frame not found: " + sequence.firstFramePath);
    var pass = sequence.pass;
    var layer = LML.basemap.findPassLayer(mapComp, pass);
    var footage = layer && layer.source instanceof FootageItem ? layer.source : null;
    var tag;

    if (!footage) {
        var options = new ImportOptions(first);
        options.sequence = true;
        options.forceAlphabetical = true;
        footage = app.project.importFile(options);
        footage.parentFolder = LML.map.projectFolder();
        tag = { kind: "basemapFootage", v: 2, mapId: mapId, pass: pass, main: quality, finalStamp: quality === "final" ? stamp : null, proxyStamp: null };
    } else {
        tag = LML.tag.read(footage) || { kind: "basemapFootage", v: 2, mapId: mapId, pass: pass };
        if (!tag.main) tag.main = "final";
        if (quality === "final") {
            footage.replaceWithSequence(first, true);
            tag.main = "final";
            tag.finalStamp = stamp;
            if (LML.basemap.hasProxy(footage)) {
                if (tag.proxyStamp !== stamp) {
                    footage.setProxyToNone();
                    tag.proxyStamp = null;
                } else {
                    footage.useProxy = false;
                }
            }
        } else if (tag.main === "final") {
            footage.setProxyWithSequence(first, true);
            footage.proxySource.conformFrameRate = mapComp.frameRate;
            footage.useProxy = true;
            tag.proxyStamp = stamp;
        } else {
            footage.replaceWithSequence(first, true);
            tag.main = "preview";
        }
    }
    footage.mainSource.conformFrameRate = mapComp.frameRate;
    footage.name = mapComp.name + " " + sequence.label;
    LML.tag.write(footage, tag);

    var created = false;
    if (!layer) {
        created = true;
        layer = mapComp.layers.add(footage);
        layer.name = pass === "base" ? "Basemap" : sequence.label + (sequence.kind === "matte" ? "" : " pass");
        LML.tag.write(layer, { kind: "basemap", v: 2, mapId: mapId, pass: pass });
        if (pass === "base") {
            layer.moveToEnd();
        } else {
            // Directly above the nearest pass below it in PASS_ORDER; switched off until the user needs it.
            var below = null;
            var belowOrder = -1;
            for (var i = 1; i <= mapComp.numLayers; i++) {
                var other = mapComp.layer(i);
                var t = LML.tag.read(other);
                if (!t || t.kind !== "basemap" || other === layer) continue;
                var order = LML.basemap.passOrder(t.pass || "base");
                if (order < LML.basemap.passOrder(pass) && order > belowOrder) {
                    below = other;
                    belowOrder = order;
                }
            }
            if (below) layer.moveBefore(below);
            else layer.moveToEnd();
            layer.enabled = false;
        }
    }
    LML.basemap.withUnlocked(layer, function () {
        layer.startTime = 0;
        // Previews below comp resolution are scaled up to fill the comp; proxies scale themselves.
        var scale = 100 * mapComp.width / footage.width;
        layer.property("ADBE Transform Group").property("ADBE Scale").setValue([scale, scale]);
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([mapComp.width / 2, mapComp.height / 2]);
    });
    if (created && pass === "base") layer.locked = true;
    return {
        pass: pass,
        layerIndex: layer.index,
        layerName: layer.name,
        footageId: footage.id,
        width: footage.width,
        height: footage.height,
        duration: footage.duration,
        main: tag.main,
        hasProxy: LML.basemap.hasProxy(footage),
        useProxy: footage.useProxy,
        created: created
    };
};

/**
 * Adds a data credit text layer to the scene comp once. It is never re-added after the user deletes
 * it (they may credit the data elsewhere, such as in end credits); its text follows the basemap.
 */
LML.basemap.ensureAttribution = function (mapLayer, text) {
    if (!text) return { state: "none" };
    var scene = mapLayer.containingComp;
    var mapTag = LML.tag.read(mapLayer);
    for (var i = 1; i <= scene.numLayers; i++) {
        var candidate = scene.layer(i);
        var t = LML.tag.read(candidate);
        if (!t || t.kind !== "attribution" || t.mapId !== mapTag.mapId) continue;
        var sourceText = candidate.property("ADBE Text Properties").property("ADBE Text Document");
        var current = sourceText.value;
        if (current.text !== text) {
            current.text = text;
            LML.basemap.withUnlocked(candidate, function () {
                sourceText.setValue(current);
            });
            return { state: "updated", layerName: candidate.name };
        }
        return { state: "present", layerName: candidate.name };
    }
    if (mapTag.attributionAdded) return { state: "removedByUser" };

    var layer = scene.layers.addText(text);
    layer.name = "Map data credit";
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.fontSize = Math.max(10, Math.round(scene.height / 60));
    doc.applyFill = true;
    doc.fillColor = [1, 1, 1];
    doc.applyStroke = false;
    doc.justification = ParagraphJustification.RIGHT_JUSTIFY;
    try {
        doc.font = "ArialMT";
    } catch (e) {
        // Keep the default font.
    }
    prop.setValue(doc);
    var margin = Math.round(scene.height / 36);
    var transform = layer.property("ADBE Transform Group");
    transform.property("ADBE Position").setValue([scene.width - margin, scene.height - margin]);
    transform.property("ADBE Opacity").setValue(75);
    layer.moveToBeginning();
    LML.tag.write(layer, { kind: "attribution", v: 1, mapId: mapTag.mapId });
    mapTag.attributionAdded = true;
    LML.tag.write(mapLayer, mapTag);
    return { state: "added", layerName: layer.name };
};

/**
 * args: { mapId, quality: "preview" | "final", stamp, sequences: [{ pass, label, kind, firstFramePath }],
 *         attribution: string | null }
 */
LML.basemap.importPasses = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var mapComp = mapLayer.source;
    var imported = [];
    // Base first, so new pass layers find it when they position themselves.
    var sequences = args.sequences.slice(0);
    sequences.sort(function (a, b) {
        return LML.basemap.passOrder(a.pass) - LML.basemap.passOrder(b.pass);
    });
    for (var i = 0; i < sequences.length; i++) {
        imported.push(LML.basemap.importPass(mapComp, args.mapId, sequences[i], args.quality, args.stamp));
    }
    var attribution = LML.basemap.ensureAttribution(mapLayer, args.attribution);
    return { passes: imported, attribution: attribution };
};

/** Legacy single-sequence import (base pass, final quality). */
LML.basemap.importSequence = function (args) {
    var result = LML.basemap.importPasses({
        mapId: args.mapId,
        quality: "final",
        stamp: args.stamp || null,
        sequences: [{ pass: args.pass || "base", label: "basemap", kind: "color", firstFramePath: args.firstFramePath }],
        attribution: null
    });
    return result.passes[0];
};
