/*
 * Map overlays built from simple linked layers: routes (a path through geographic points, drawn on
 * with Trim Paths) and callouts (a leader line, a box and text next to a place). The panel sends the
 * expressions and the animation keys; every layer is tagged with its kind and linked to the map
 * through a Layer Control effect.
 */
LML.overlays = LML.overlays || {};

/** Keys on a property from [[map comp frame, value], ...]. */
LML.overlays.keyFrames = function (prop, mapLayer, keys) {
    var fps = mapLayer.source.frameRate;
    var times = [];
    var values = [];
    for (var i = 0; i < keys.length; i++) {
        times.push(mapLayer.startTime + keys[i][0] / fps);
        values.push(keys[i][1]);
    }
    if (times.length > 1) prop.setValuesAtTimes(times, values);
    else if (times.length === 1) prop.setValue(values[0]);
};

LML.overlays.ease = function (prop) {
    for (var k = 1; k <= prop.numKeys; k++) {
        var dimensions = prop.propertyValueType === PropertyValueType.OneD ? 1 : prop.value.length;
        var ease = [];
        for (var d = 0; d < dimensions; d++) ease.push(new KeyframeEase(0, 60));
        try {
            prop.setTemporalEaseAtKey(k, ease, ease);
        } catch (e) {
            // Spatial properties keep linear keys.
        }
    }
};

LML.overlays.linkToMap = function (layer, mapLayer) {
    var link = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
    link.name = "Map";
    link.property(1).setValue(mapLayer.index);
};

/**
 * args: { mapId, kind, name, pathExpression, stroke: { color, width, opacity? }, trimKeys?, opacityKeys?, glow? }
 */
LML.overlays.addPath = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    var layer = scene.layers.addShape();
    layer.name = args.name;
    LML.overlays.linkToMap(layer, mapLayer);
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    group.name = "Path";
    var contents = group.property("ADBE Vectors Group");
    var shape = contents.addProperty("ADBE Vector Shape - Group");
    LML.pins.setExpression(shape.property("ADBE Vector Shape"), args.pathExpression, errors, args.name + " path");
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue(args.stroke.color);
    stroke.property("ADBE Vector Stroke Width").setValue(args.stroke.width);
    stroke.property("ADBE Vector Stroke Line Cap").setValue(2);
    stroke.property("ADBE Vector Stroke Line Join").setValue(2);
    if (args.trimKeys && args.trimKeys.length) {
        var trim = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
        var end = trim.property("ADBE Vector Trim End");
        LML.overlays.keyFrames(end, mapLayer, args.trimKeys);
        LML.overlays.ease(end);
    }
    if (args.opacityKeys && args.opacityKeys.length) {
        LML.overlays.keyFrames(layer.property("ADBE Transform Group").property("ADBE Opacity"), mapLayer, args.opacityKeys);
    }
    if (args.glow) {
        try {
            var glow = layer.property("ADBE Effect Parade").addProperty("ADBE Glo2");
            glow.property("ADBE Glo2-0003").setValue(args.glow.radius);
            glow.property("ADBE Glo2-0004").setValue(args.glow.intensity);
        } catch (e) {
            // Glow is decoration only.
        }
    }
    layer.moveBefore(mapLayer);
    LML.tag.write(layer, { kind: args.kind, v: 1, mapId: args.mapId, name: args.name });
    return { name: layer.name, index: layer.index, expressionErrors: errors };
};

/**
 * args: { mapId, kind, name, positionExpression, size: [w, h], radius, color, opacity, opacityKeys, scaleKeys }
 */
LML.overlays.addBox = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    var layer = scene.layers.addShape();
    layer.name = args.name;
    LML.overlays.linkToMap(layer, mapLayer);
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    if (!args.size || typeof args.size[0] !== "number" || typeof args.size[1] !== "number") {
        throw LML.util.error("BAD_ARGUMENT", "Box " + args.name + " needs a numeric size, got " + LML.json.stringify(args.size));
    }
    var rect = contents.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue(args.size);
    rect.property("ADBE Vector Rect Roundness").setValue(args.radius);
    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(args.color);
    fill.property("ADBE Vector Fill Opacity").setValue(args.opacity);
    var transform = layer.property("ADBE Transform Group");
    LML.pins.setExpression(transform.property("ADBE Position"), args.positionExpression, errors, args.name);
    if (args.opacityKeys) LML.overlays.keyFrames(transform.property("ADBE Opacity"), mapLayer, args.opacityKeys);
    if (args.scaleKeys) {
        LML.overlays.keyFrames(transform.property("ADBE Scale"), mapLayer, args.scaleKeys);
        LML.overlays.ease(transform.property("ADBE Scale"));
    }
    layer.moveBefore(mapLayer);
    LML.tag.write(layer, { kind: args.kind, v: 1, mapId: args.mapId, name: args.name });
    return { name: layer.name, index: layer.index, expressionErrors: errors };
};

/**
 * args: { mapId, kind, name, text, style (see LML.labels.styleText, with fonts), positionExpression, opacityKeys, scaleKeys }
 */
LML.overlays.addText = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    var layer = scene.layers.addText(args.text);
    layer.name = args.name;
    args.style.font = LML.labels.pickFont(args.style.fonts);
    LML.labels.styleText(layer, args.style);
    LML.overlays.linkToMap(layer, mapLayer);
    var transform = layer.property("ADBE Transform Group");
    LML.pins.setExpression(transform.property("ADBE Position"), args.positionExpression, errors, args.name);
    if (args.opacityKeys) LML.overlays.keyFrames(transform.property("ADBE Opacity"), mapLayer, args.opacityKeys);
    if (args.scaleKeys) {
        LML.overlays.keyFrames(transform.property("ADBE Scale"), mapLayer, args.scaleKeys);
        LML.overlays.ease(transform.property("ADBE Scale"));
    }
    layer.moveBefore(mapLayer);
    LML.tag.write(layer, { kind: args.kind, v: 1, mapId: args.mapId, name: args.name });
    return { name: layer.name, index: layer.index, expressionErrors: errors };
};

/** Removes the tagged overlays of a kind for a map (for regeneration). */
LML.overlays.removeKind = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    return { removed: LML.labels.removeTagged(mapLayer.containingComp, args.mapId, args.kind) };
};
