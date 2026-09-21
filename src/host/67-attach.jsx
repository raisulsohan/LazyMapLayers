/*
 * Attaching the user's own layers to a place on a map: their artwork (an icon, a photo, a precomp)
 * gets the same controls and expressions a pin has, so it stays on its place while the camera moves.
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
        var tag = LML.tag.read(layer);
        var already = tag && tag.kind === "attached";
        if (!already) {
            var link = LML.pins.addEffect(layer, "ADBE Layer Control", "Map");
            link.property(1).setValue(mapLayer.index);
            LML.pins.addEffect(layer, "ADBE Slider Control", "Latitude", args.lat);
            LML.pins.addEffect(layer, "ADBE Slider Control", "Longitude", args.lng);
            LML.pins.addEffect(layer, "ADBE Slider Control", "Elevation (m)", args.elevation || 0);
            LML.pins.addEffect(layer, "ADBE Checkbox Control", "Scale with Map", args.scaleWithMap ? 1 : 0);
            LML.pins.addEffect(layer, "ADBE Checkbox Control", "Rotate with Map", args.rotateWithMap ? 1 : 0);
            LML.pins.addEffect(layer, "ADBE Slider Control", "Reference Zoom", LML.map.readViewAtTime(mapLayer, scene.time).zoom);
        }
        // Effects are added first: adding one invalidates references to the effects before it.
        LML.attach.effectByName(layer, "Latitude").property(1).setValue(args.lat);
        LML.attach.effectByName(layer, "Longitude").property(1).setValue(args.lng);
        LML.attach.effectByName(layer, "Elevation (m)").property(1).setValue(args.elevation || 0);
        if (!already) {
            var transform = layer.property("ADBE Transform Group");
            var kept = [];
            var code = [args.expressions.position, args.expressions.scale, args.expressions.rotation, args.expressions.opacity];
            for (var p = 0; p < LML.attach.PROPERTIES.length; p++) {
                var prop = transform.property(LML.attach.PROPERTIES[p]);
                // A property the user already drives with an expression is left alone.
                if (!prop || (prop.expressionEnabled && prop.expression !== "")) continue;
                LML.pins.setExpression(prop, code[p], errors, layer.name + " " + LML.attach.PROPERTIES[p], i === 0);
                kept.push(LML.attach.PROPERTIES[p]);
            }
            LML.tag.write(layer, { kind: "attached", v: 1, mapId: args.mapId, properties: kept });
        }
        names.push(layer.name);
    }
    return { layers: names, expressionErrors: errors };
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
