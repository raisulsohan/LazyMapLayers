/*
 * Attaching the user's own layers to a place on a map: their artwork (an icon, a photo, a precomp)
 * gets the same controls and expressions a pin has, so it stays on its place while the camera moves.
 * A layer can also be copied onto every place of a table, each copy wired the same way.
 *
 * These are the only layers LazyMapLayers touches that it did not make, and it touches them only when
 * the user asks: it adds effects and expressions, keeps every other property (and the layer's own
 * comment text), and "Unlink" puts the layer back as it was.
 */
LML.attach = LML.attach || {};

LML.attach.EFFECTS = ["Map", "Latitude", "Longitude", "Elevation (m)", "Scale with Map", "Rotate with Map", "Reference Zoom"];
LML.attach.PROPERTIES = ["ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];

/** The layers the user has selected in the map's scene, without the ones LazyMapLayers made. */
LML.attach.selectedIn = function (scene) {
    var out = [];
    var selected = scene.selectedLayers;
    for (var i = 0; i < selected.length; i++) {
        var layer = selected[i];
        var tag = LML.tag.read(layer);
        if (tag && tag.kind !== "attached") continue;
        out.push(layer);
    }
    return out;
};

LML.attach.effectByName = function (layer, name) {
    var parade = layer.property("ADBE Effect Parade");
    for (var i = 1; i <= parade.numProperties; i++) {
        if (parade.property(i).name === name) return parade.property(i);
    }
    return null;
};

/**
 * Wires one layer to a place: the controls a pin has, and the expressions on the properties the user
 * does not drive himself. A layer wired already only moves. place: { lat, lng, elevation, name? }.
 */
LML.attach.wire = function (layer, mapLayer, args, place, expressions, errors, first) {
    var tag = LML.tag.read(layer);
    var already = tag && tag.kind === "attached";
    if (!already) {
        var link = LML.pins.addEffect(layer, "ADBE Layer Control", "Map");
        link.property(1).setValue(mapLayer.index);
        LML.pins.addEffect(layer, "ADBE Slider Control", "Latitude", place.lat);
        LML.pins.addEffect(layer, "ADBE Slider Control", "Longitude", place.lng);
        LML.pins.addEffect(layer, "ADBE Slider Control", "Elevation (m)", place.elevation || 0);
        LML.pins.addEffect(layer, "ADBE Checkbox Control", "Scale with Map", args.scaleWithMap ? 1 : 0);
        LML.pins.addEffect(layer, "ADBE Checkbox Control", "Rotate with Map", args.rotateWithMap ? 1 : 0);
        LML.pins.addEffect(layer, "ADBE Slider Control", "Reference Zoom", LML.map.readViewAtTime(mapLayer, mapLayer.containingComp.time).zoom);
    }
    // Effects are added first: adding one invalidates references to the effects before it.
    LML.attach.effectByName(layer, "Latitude").property(1).setValue(place.lat);
    LML.attach.effectByName(layer, "Longitude").property(1).setValue(place.lng);
    LML.attach.effectByName(layer, "Elevation (m)").property(1).setValue(place.elevation || 0);
    if (!already) {
        var transform = layer.property("ADBE Transform Group");
        var kept = [];
        var code = [expressions.position, expressions.scale, expressions.rotation, expressions.opacity];
        for (var p = 0; p < LML.attach.PROPERTIES.length; p++) {
            var prop = transform.property(LML.attach.PROPERTIES[p]);
            // A property the user already drives with an expression is left alone.
            if (!prop || (prop.expressionEnabled && prop.expression !== "")) continue;
            LML.pins.setExpression(prop, code[p], errors, layer.name + " " + LML.attach.PROPERTIES[p], first);
            kept.push(LML.attach.PROPERTIES[p]);
        }
        var written = { kind: "attached", v: 1, mapId: args.mapId, properties: kept };
        if (place.name) written.place = place.name;
        LML.tag.write(layer, written);
    }
};

/**
 * args: { mapId, lat, lng, elevation, scaleWithMap, rotateWithMap, expressions: { position, scale, rotation, opacity } }
 * Attaches every selected layer of the map's scene. A layer that is attached already is moved to the
 * new place instead of being wired up again.
 */
LML.attach.attach = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var layers = LML.attach.selectedIn(scene);
    if (!layers.length) {
        throw LML.util.error("NO_SELECTION", "Select the layers you want to attach in After Effects first (in " + scene.name + ")");
    }
    var errors = [];
    var names = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer === mapLayer) continue;
        LML.attach.wire(layer, mapLayer, args, { lat: args.lat, lng: args.lng, elevation: args.elevation }, args.expressions, errors, i === 0);
        names.push(layer.name);
    }
    return { layers: names, expressionErrors: errors };
};

/**
 * args: { mapId, scaleWithMap, rotateWithMap, places: [{ name, lat, lng, elevation, factor, expressions }] }
 * Copies the first selected layer of the map's scene onto every place: each copy is named after its
 * place, sized by its factor and wired to the place like an attached layer. The original is left as
 * it is, and the copies are left unselected.
 */
LML.attach.copyToPlaces = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var layers = LML.attach.selectedIn(scene);
    var template = null;
    for (var i = 0; i < layers.length; i++) {
        if (layers[i] !== mapLayer) {
            template = layers[i];
            break;
        }
    }
    if (!template) {
        throw LML.util.error("NO_SELECTION", "Select the layer to copy in After Effects first (in " + scene.name + ")");
    }
    var errors = [];
    var names = [];
    for (var p = 0; p < args.places.length; p++) {
        var place = args.places[p];
        var copy = template.duplicate();
        copy.name = template.name + ": " + place.name;
        copy.selected = false;
        var factor = typeof place.factor === "number" ? place.factor : 1;
        if (factor !== 1) {
            var scale = copy.property("ADBE Transform Group").property("ADBE Scale");
            var was = scale.value;
            var next = [];
            for (var d = 0; d < was.length; d++) next.push(was[d] * factor);
            scale.setValue(next);
        }
        LML.attach.wire(copy, mapLayer, args, place, place.expressions, errors, p === 0);
        names.push(copy.name);
    }
    return { template: template.name, layers: names, expressionErrors: errors };
};

/** Puts the selected attached layers back: the expressions, the effects and the tag go. */
LML.attach.detach = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var selected = scene.selectedLayers;
    var names = [];
    for (var i = 0; i < selected.length; i++) {
        var layer = selected[i];
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "attached" || tag.mapId !== args.mapId) continue;
        var transform = layer.property("ADBE Transform Group");
        var properties = tag.properties || LML.attach.PROPERTIES;
        for (var p = 0; p < properties.length; p++) {
            var prop = transform.property(properties[p]);
            if (prop && prop.expressionEnabled) {
                prop.expression = "";
                prop.expressionEnabled = false;
            }
        }
        for (var e = 0; e < LML.attach.EFFECTS.length; e++) {
            var effect = LML.attach.effectByName(layer, LML.attach.EFFECTS[e]);
            if (effect) effect.remove();
        }
        LML.tag.remove(layer);
        names.push(layer.name);
    }
    return { layers: names };
};

LML.api.attachLayers = function (args) {
    return LML.withUndo("Attach layers to the map", function () {
        return LML.attach.attach(args);
    });
};

LML.api.detachLayers = function (args) {
    return LML.withUndo("Unlink layers from the map", function () {
        return LML.attach.detach(args);
    });
};

LML.api.copyToPlaces = function (args) {
    return LML.withUndo("Copy a layer onto places", function () {
        return LML.attach.copyToPlaces(args);
    });
};

/** How many layers are selected in the map's scene, and how many of them are attached already. */
LML.api.selectionInfo = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var selected = scene.selectedLayers;
    var usable = 0;
    var attached = 0;
    var first = "";
    for (var i = 0; i < selected.length; i++) {
        var tag = LML.tag.read(selected[i]);
        if (tag && tag.kind === "attached" && tag.mapId === args.mapId) {
            attached++;
            usable++;
        } else if (!tag) {
            usable++;
        }
        if (usable === 1 && !first) first = selected[i].name;
    }
    return { scene: scene.name, selected: selected.length, usable: usable, attached: attached, first: first };
};

/**
 * Everything on a map that can go back out as GeoJSON: pins and attached layers with their place,
 * routes and outlines with the expressions that hold their points, callouts with their title.
 * args: { mapId }
 */
LML.api.exportLayers = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var kinds = { pin: true, attached: true, route: true, feature: true, callout: true };
    var out = [];
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.mapId !== args.mapId || kinds[tag.kind] !== true) continue;
        var item = { kind: tag.kind, name: layer.name, lat: null, lng: null, paths: [] };
        var lat = LML.attach.effectByName(layer, "Latitude");
        var lng = LML.attach.effectByName(layer, "Longitude");
        if (lat && lng) {
            item.lat = lat.property(1).value;
            item.lng = lng.property(1).value;
        }
        var vectors = layer.property("ADBE Root Vectors Group");
        if (vectors) {
            for (var g = 1; g <= vectors.numProperties; g++) {
                var group = vectors.property(g);
                if (group.matchName !== "ADBE Vector Group") continue;
                var contents = group.property("ADBE Vectors Group");
                for (var c = 1; c <= contents.numProperties; c++) {
                    var shape = contents.property(c);
                    if (shape.matchName !== "ADBE Vector Shape - Group") continue;
                    var path = shape.property("ADBE Vector Shape");
                    if (path.expressionEnabled && path.expression) item.paths.push(path.expression);
                }
            }
        }
        // A callout keeps its place on the text and box layers; the leader has it too.
        if (item.lat === null && tag.kind === "callout" && item.paths.length === 0) continue;
        out.push(item);
    }
    return out;
};

/** Writes text where the user chooses. args: { text, suggestedName } - returns the path, or null. */
LML.api.saveTextFile = function (args) {
    var file = File.saveDialog("Save as", args.suggestedName || "map.geojson");
    if (!file) return null;
    file.encoding = "UTF-8";
    if (!file.open("w")) throw LML.util.error("WRITE_FAILED", "Could not write " + file.fsName);
    file.write(args.text);
    file.close();
    return file.fsName;
};
