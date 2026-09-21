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
 * args: { mapId, kind, name, pathExpression, stroke: { color, width, opacity? }, trimKeys?, linearKeys?, opacityKeys?, glow?, data? }
 * data (small, such as a route's two ends) is kept in the layer's tag. linearKeys leaves the trim keys
 * linear (a recorded pace arrives as many keys that must not ease in and out one by one).
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
        if (!args.linearKeys) LML.overlays.ease(end);
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
    var pathTag = { kind: args.kind, v: 1, mapId: args.mapId, name: args.name };
    if (args.data) pathTag.data = args.data;
    LML.tag.write(layer, pathTag);
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

/**
 * A layer that travels along a route: an arrow that the panel's expressions move and turn, driven by
 * a "Progress" slider. People who want their own artwork parent it to this layer and switch its
 * Contents off; their layers are never touched.
 * args: { mapId, kind, name, expressions: { position, rotation, opacity }, progressKeys: [[frame, value]],
 *         linearKeys?, size, color, strokeColor }
 */
LML.overlays.addTraveller = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    var layer = scene.layers.addShape();
    layer.name = args.name;
    LML.overlays.linkToMap(layer, mapLayer);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Progress", 0);
    LML.pins.addEffect(layer, "ADBE Checkbox Control", "Rotate along Route", 1);
    // Adding an effect invalidates references to the effects before it: fetch the slider by name now.
    var progress = layer.property("ADBE Effect Parade").property("Progress").property(1);
    if (args.progressKeys && args.progressKeys.length) {
        LML.overlays.keyFrames(progress, mapLayer, args.progressKeys);
        if (!args.linearKeys) LML.overlays.ease(progress);
    }

    // An arrow that points to the right, which is "forward" for the rotation expression.
    var size = args.size || 16;
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    group.name = "Arrow";
    var contents = group.property("ADBE Vectors Group");
    var shape = new Shape();
    shape.vertices = [[size, 0], [-size * 0.75, -size * 0.65], [-size * 0.35, 0], [-size * 0.75, size * 0.65]];
    shape.closed = true;
    contents.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(shape);
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue(args.strokeColor || [0.03, 0.07, 0.11]);
    stroke.property("ADBE Vector Stroke Width").setValue(Math.max(1.5, size / 7));
    stroke.property("ADBE Vector Stroke Line Join").setValue(2);
    contents.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(args.color || [1, 1, 1]);

    var transform = layer.property("ADBE Transform Group");
    LML.pins.setExpression(transform.property("ADBE Position"), args.expressions.position, errors, args.name + " position");
    LML.pins.setExpression(transform.property("ADBE Rotate Z"), args.expressions.rotation, errors, args.name + " rotation");
    LML.pins.setExpression(transform.property("ADBE Opacity"), args.expressions.opacity, errors, args.name + " opacity");
    layer.moveBefore(mapLayer);
    LML.tag.write(layer, { kind: args.kind, v: 1, mapId: args.mapId, name: args.name });
    return { name: layer.name, index: layer.index, expressionErrors: errors };
};

/**
 * A map feature as an editable shape layer: one closed path per ring of the outline, all in one group,
 * with an even-odd fill (so holes stay holes) and a stroke. Everything is an ordinary shape layer
 * property, so the layer can be restyled and animated in After Effects by hand afterwards.
 * args: { mapId, kind, name, paths: [expression], fill: { color, opacity } | null,
 *         stroke: { color, width, dash } | null, trimKeys?, opacityKeys?, glow?, data? }
 */
LML.overlays.addShape = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    var layer = scene.layers.addShape();
    layer.name = args.name;
    LML.overlays.linkToMap(layer, mapLayer);
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    group.name = "Outline";
    var contents = group.property("ADBE Vectors Group");
    for (var i = 0; i < args.paths.length; i++) {
        var shape = contents.addProperty("ADBE Vector Shape - Group");
        shape.name = args.paths.length > 1 ? "Ring " + (i + 1) : "Path";
        LML.pins.setExpression(shape.property("ADBE Vector Shape"), args.paths[i], errors, args.name + " ring " + (i + 1));
    }
    if (args.fill) {
        var fill = contents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(args.fill.color);
        fill.property("ADBE Vector Fill Opacity").setValue(args.fill.opacity);
        try {
            // Even-odd: a ring inside another ring is a hole, whichever way its points run.
            fill.property("ADBE Vector Fill Rule").setValue(2);
        } catch (e) {
            // Older versions keep the non-zero rule; islands still fill.
        }
    }
    if (args.stroke && args.stroke.width > 0) {
        var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(args.stroke.color);
        stroke.property("ADBE Vector Stroke Width").setValue(args.stroke.width);
        stroke.property("ADBE Vector Stroke Line Cap").setValue(2);
        stroke.property("ADBE Vector Stroke Line Join").setValue(2);
        if (args.stroke.dash > 0) {
            try {
                var dashes = stroke.property("ADBE Vector Stroke Dashes");
                dashes.addProperty("ADBE Vector Stroke Dash 1").setValue(args.stroke.dash);
                dashes.addProperty("ADBE Vector Stroke Gap 1").setValue(args.stroke.dash);
            } catch (e2) {
                // A solid stroke is a fine fallback.
            }
        }
    }
    if (args.trimKeys && args.trimKeys.length) {
        // On the group, so every ring draws on together.
        var trim = group.property("ADBE Vectors Group").addProperty("ADBE Vector Filter - Trim");
        var end = trim.property("ADBE Vector Trim End");
        LML.overlays.keyFrames(end, mapLayer, args.trimKeys);
        if (!args.linearKeys) LML.overlays.ease(end);
    }
    if (args.opacityKeys && args.opacityKeys.length) {
        LML.overlays.keyFrames(layer.property("ADBE Transform Group").property("ADBE Opacity"), mapLayer, args.opacityKeys);
    }
    if (args.glow) {
        try {
            var glow = layer.property("ADBE Effect Parade").addProperty("ADBE Glo2");
            glow.property("ADBE Glo2-0003").setValue(args.glow.radius);
            glow.property("ADBE Glo2-0004").setValue(args.glow.intensity);
        } catch (e3) {
            // Glow is decoration only.
        }
    }
    layer.moveBefore(mapLayer);
    var shapeTag = { kind: args.kind, v: 1, mapId: args.mapId, name: args.name };
    if (args.data) shapeTag.data = args.data;
    LML.tag.write(layer, shapeTag);
    return { name: layer.name, index: layer.index, expressionErrors: errors };
};

/** Removes the tagged overlays of a kind for a map (for regeneration). */
LML.overlays.removeKind = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    return { removed: LML.labels.removeTagged(mapLayer.containingComp, args.mapId, args.kind) };
};

/** The tagged layers of a kind for a map, with the small data kept in their tags (top layer first). */
LML.api.listOverlays = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var out = [];
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.mapId !== args.mapId || tag.kind !== args.kind) continue;
        out.push({ name: layer.name, index: layer.index, data: tag.data || null });
    }
    return out;
};
