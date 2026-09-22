// Numbers as circles on the map: one shape layer with a group per place, each group following its
// place through the same expression a pin uses. One layer keeps the comp tidy and lets the whole set
// be restyled at once, while every bubble still has its own transform to animate.

LML.bubbles = LML.bubbles || {};

/** Removes the bubbles of a map. */
LML.bubbles.removeTagged = function (scene, mapId) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "bubbles" || tag.mapId !== mapId) continue;
        layer.remove();
        removed++;
    }
    return removed;
};

/**
 * Builds the bubbles. args: {
 *   mapId, name, color, strokeColor, strokeWidth, opacity,
 *   bubbles: [{ name, radius, positionExpression }]
 * }
 */
LML.api.addBubbles = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    app.beginUndoGroup("LazyMapLayers: Bubbles");
    try {
        var removed = LML.bubbles.removeTagged(scene, args.mapId);
        var layer = scene.layers.addShape();
        layer.name = args.name;
        var transform = layer.property("ADBE Transform Group");
        // With no transform of its own, a group's position is the comp's own coordinates, which is
        // what the map expression gives.
        transform.property("ADBE Anchor Point").setValue([0, 0]);
        transform.property("ADBE Position").setValue([0, 0]);
        if (args.opacity !== undefined) transform.property("ADBE Opacity").setValue(args.opacity);
        LML.overlays.linkToMap(layer, mapLayer);
        var root = layer.property("ADBE Root Vectors Group");
        for (var i = 0; i < args.bubbles.length; i++) {
            var bubble = args.bubbles[i];
            var group = root.addProperty("ADBE Vector Group");
            group.name = bubble.name || "Bubble";
            var contents = group.property("ADBE Vectors Group");
            var ellipse = contents.addProperty("ADBE Vector Shape - Ellipse");
            ellipse.property("ADBE Vector Ellipse Size").setValue([bubble.radius * 2, bubble.radius * 2]);
            if (args.strokeWidth > 0) {
                var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
                stroke.property("ADBE Vector Stroke Color").setValue(args.strokeColor);
                stroke.property("ADBE Vector Stroke Width").setValue(args.strokeWidth);
            }
            var fill = contents.addProperty("ADBE Vector Graphic - Fill");
            fill.property("ADBE Vector Fill Color").setValue(bubble.color || args.color);
            if (args.fillOpacity !== undefined) fill.property("ADBE Vector Fill Opacity").setValue(args.fillOpacity);
            LML.pins.setExpression(group.property("ADBE Vector Transform Group").property("ADBE Vector Position"), bubble.positionExpression, errors, bubble.name);
        }
        layer.moveBefore(mapLayer);
        LML.tag.write(layer, { kind: "bubbles", v: 1, mapId: args.mapId });
        return { name: layer.name, index: layer.index, bubbles: args.bubbles.length, removed: removed, expressionErrors: errors };
    } finally {
        app.endUndoGroup();
    }
};

/** Takes the bubbles off the map. args: { mapId } */
LML.api.removeBubbles = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Remove bubbles");
    try {
        return { removed: LML.bubbles.removeTagged(scene, args.mapId) };
    } finally {
        app.endUndoGroup();
    }
};

/** Takes the numbers written on the map off again. args: { mapId } */
LML.api.removeValueLabels = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Remove values");
    try {
        return { removed: LML.labels.removeTagged(scene, args.mapId, "value") };
    } finally {
        app.endUndoGroup();
    }
};
