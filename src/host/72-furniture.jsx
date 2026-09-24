/*
 * Map furniture: the scale bar and the north arrow. Both are ordinary layers in the scene with a
 * Layer Control effect pointing at the map and expressions that read the map's own controls, so they
 * follow every camera keyframe without a re-render, and the user can restyle or move them freely.
 */
LML.furniture = LML.furniture || {};

/** Takes a map's scale bar or north arrow (and its text) off the scene. */
LML.furniture.removeTagged = function (scene, mapId, kind) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.mapId !== mapId) continue;
        if (tag.kind !== kind && tag.kind !== kind + "Text") continue;
        layer.remove();
        removed++;
    }
    return removed;
};

/** The Layer Control that ties a piece of furniture to its map. */
LML.furniture.linkMap = function (layer, mapLayer) {
    var link = LML.pins.addEffect(layer, "ADBE Layer Control", "Map");
    link.property(1).setValue(mapLayer.index);
    return link;
};

/**
 * A text layer that belongs to a piece of furniture: parented to it, in the map's own font, with its
 * own link to the map so its expression can read the view.
 */
LML.furniture.addText = function (scene, owner, mapLayer, args, name, kind, offset, first) {
    var style = args.style || {};
    var layer = scene.layers.addText(first || "100 km");
    layer.name = name;
    layer.moveBefore(owner);
    LML.labels.styleText(layer, {
        color: style.textColor || style.color || [1, 1, 1],
        haloColor: style.haloColor || [0, 0, 0],
        haloWidth: style.haloWidth || 0,
        tracking: 0,
        rtl: false,
        font: LML.labels.pickFont(args.fonts || []),
        justify: style.justify || "left",
        size: style.textSize || 24
    });
    var transform = layer.property("ADBE Transform Group");
    transform.property("ADBE Anchor Point").setValue([0, 0]);
    layer.parent = owner;
    transform.property("ADBE Position").setValue(offset);
    LML.furniture.linkMap(layer, mapLayer);
    LML.tag.write(layer, { kind: kind, v: 1, mapId: args.mapId });
    return layer;
};

/**
 * A scale bar: a bracket that says how far a screen distance is on the ground, with the distance
 * written above it. args: {
 *   mapId, position, tick, expressions{path,text}, fonts,
 *   style{color,width,textColor,haloColor,haloWidth,textSize} }
 */
LML.api.addScaleBar = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Scale bar");
    try {
        var removed = LML.furniture.removeTagged(scene, args.mapId, "scaleBar");
        var style = args.style || {};
        var layer = scene.layers.addShape();
        layer.name = "Scale bar";
        layer.moveBefore(mapLayer);
        var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        group.name = "Bar";
        var contents = group.property("ADBE Vectors Group");
        contents.addProperty("ADBE Vector Shape - Group");
        var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(style.color || [1, 1, 1]);
        stroke.property("ADBE Vector Stroke Width").setValue(style.width || 3);
        try {
            stroke.property("ADBE Vector Stroke Line Cap").setValue(1);
            stroke.property("ADBE Vector Stroke Line Join").setValue(2);
        } catch (e) {
            // An older After Effects without these choices keeps its defaults.
        }
        var transform = layer.property("ADBE Transform Group");
        transform.property("ADBE Anchor Point").setValue([0, 0]);
        transform.property("ADBE Position").setValue([args.position[0], args.position[1]]);
        LML.furniture.linkMap(layer, mapLayer);
        var errors = [];
        // The path is read again here: adding the stroke leaves the first handle to it stale.
        LML.pins.setExpression(contents.property(1).property("ADBE Vector Shape"), args.expressions.path, errors, "bar");
        LML.tag.write(layer, { kind: "scaleBar", v: 1, mapId: args.mapId });

        var gap = (style.textSize || 24) * 0.4 + (args.tick || 8) + 2;
        var text = LML.furniture.addText(scene, layer, mapLayer, args, "Scale bar text", "scaleBarText", [0, -gap], "100 km");
        LML.pins.setExpression(text.property("ADBE Text Properties").property("ADBE Text Document"), args.expressions.text, errors, "distance");
        return { name: layer.name, index: layer.index, removed: removed, expressionErrors: errors };
    } finally {
        app.endUndoGroup();
    }
};

/**
 * A north arrow that turns with the map. args: {
 *   mapId, position, points, letter, expressions{rotation}, fonts,
 *   style{color,textColor,haloColor,haloWidth,textSize,size} }
 */
LML.api.addNorthArrow = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: North arrow");
    try {
        var removed = LML.furniture.removeTagged(scene, args.mapId, "northArrow");
        var style = args.style || {};
        var layer = scene.layers.addShape();
        layer.name = "North arrow";
        layer.moveBefore(mapLayer);
        var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        group.name = "Arrow";
        var contents = group.property("ADBE Vectors Group");
        contents.addProperty("ADBE Vector Shape - Group");
        var fill = contents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(style.color || [1, 1, 1]);
        var shape = new Shape();
        shape.vertices = args.points;
        shape.closed = true;
        contents.property(1).property("ADBE Vector Shape").setValue(shape);

        var transform = layer.property("ADBE Transform Group");
        transform.property("ADBE Anchor Point").setValue([0, 0]);
        transform.property("ADBE Position").setValue([args.position[0], args.position[1]]);
        LML.furniture.linkMap(layer, mapLayer);
        var errors = [];
        LML.pins.setExpression(transform.property("ADBE Rotate Z"), args.expressions.rotation, errors, "north");
        LML.tag.write(layer, { kind: "northArrow", v: 1, mapId: args.mapId });

        if (args.letter) {
            var below = (style.size || 40) / 2 + (style.textSize || 24) + 4;
            var text = LML.furniture.addText(scene, layer, mapLayer, args, "North letter", "northArrowText", [0, below], args.letter);
            // The arrow turns; the letter under it stays the right way up.
            text.property("ADBE Transform Group").property("ADBE Rotate Z").expression = "-parent.transform.rotation;";
        }
        return { name: layer.name, index: layer.index, removed: removed, expressionErrors: errors };
    } finally {
        app.endUndoGroup();
    }
};

/** Takes one piece of a map's furniture off the scene. args: { mapId, kind } */
LML.api.removeFurniture = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Remove map furniture", function () {
        return { removed: LML.furniture.removeTagged(mapLayer.containingComp, args.mapId, args.kind) };
    });
};
