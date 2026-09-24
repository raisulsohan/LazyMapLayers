/*
 * An inset map in the corner - a locator - with a box on it that says where the big map is looking.
 *
 * The inset is a full map of its own: it has the same controls, the panel lists it, and it renders
 * like any other map. The box is a shape layer with two links, one to the inset and one to the map it
 * follows, so it moves and turns with every camera keyframe without a re-render.
 */
LML.minimap = LML.minimap || {};

/** Takes a map's inset, its frame and its box off the scene (and the inset's comp with them). */
LML.minimap.removeTagged = function (scene, mapId) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag) continue;
        var mine = (tag.kind === "minimapFrame" || tag.kind === "minimapBox") && tag.mapId === mapId;
        var inset = tag.kind === "mapLayer" && tag.inset === mapId;
        if (!mine && !inset) continue;
        var source = inset ? layer.source : null;
        layer.remove();
        removed++;
        if (source) {
            try {
                if (source.usedIn && source.usedIn.length === 0) source.remove();
            } catch (e) {
                // A comp that cannot be removed is left where it is.
            }
        }
    }
    return removed;
};

/** A closed rectangle as a path, in layer pixels. */
LML.minimap.rectPath = function (width, height) {
    var shape = new Shape();
    shape.vertices = [[0, 0], [width, 0], [width, height], [0, height]];
    shape.closed = true;
    return shape;
};

/**
 * An inset map with a frame and a view box. args: {
 *   mapId, name, width, height, position, zoomOut, projection,
 *   frame{color,width}, box{color,width}, expressions{box} }
 */
LML.api.addMinimap = function (args) {
    var mainLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mainLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Inset map");
    try {
        var removed = LML.minimap.removeTagged(scene, args.mapId);
        var width = Math.max(16, Math.round(args.width));
        var height = Math.max(16, Math.round(args.height));
        var at = [args.position[0], args.position[1]];
        var main = LML.map.readViewAtTime(mainLayer, scene.time);
        var view = {
            center: { lat: main.center.lat, lng: main.center.lng },
            zoom: Math.max(0, main.zoom - (args.zoomOut || 4)),
            bearing: 0,
            pitch: 0
        };

        var made = LML.map.addMapTo(scene, { name: args.name || "Inset map", width: width, height: height, view: view, projection: args.projection });
        made.layer.moveBefore(mainLayer);
        var insetTransform = made.layer.property("ADBE Transform Group");
        insetTransform.property("ADBE Anchor Point").setValue([0, 0]);
        insetTransform.property("ADBE Position").setValue(at);
        var insetTag = LML.tag.read(made.layer);
        insetTag.inset = args.mapId;
        LML.tag.write(made.layer, insetTag);

        var frame = scene.layers.addShape();
        frame.name = "Inset frame";
        frame.moveBefore(made.layer);
        var frameContents = frame.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        frameContents.name = "Frame";
        var frameInside = frameContents.property("ADBE Vectors Group");
        frameInside.addProperty("ADBE Vector Shape - Group");
        var edge = frameInside.addProperty("ADBE Vector Graphic - Stroke");
        edge.property("ADBE Vector Stroke Color").setValue(args.frame.color);
        edge.property("ADBE Vector Stroke Width").setValue(args.frame.width);
        frameInside.property(1).property("ADBE Vector Shape").setValue(LML.minimap.rectPath(width, height));
        var frameTransform = frame.property("ADBE Transform Group");
        frameTransform.property("ADBE Anchor Point").setValue([0, 0]);
        frameTransform.property("ADBE Position").setValue(at);
        LML.tag.write(frame, { kind: "minimapFrame", v: 1, mapId: args.mapId });

        var box = scene.layers.addShape();
        box.name = "Inset view box";
        box.moveBefore(frame);
        var boxContents = box.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        boxContents.name = "Box";
        var boxInside = boxContents.property("ADBE Vectors Group");
        boxInside.addProperty("ADBE Vector Shape - Group");
        var boxStroke = boxInside.addProperty("ADBE Vector Graphic - Stroke");
        boxStroke.property("ADBE Vector Stroke Color").setValue(args.box.color);
        boxStroke.property("ADBE Vector Stroke Width").setValue(args.box.width);
        var boxTransform = box.property("ADBE Transform Group");
        boxTransform.property("ADBE Anchor Point").setValue([0, 0]);
        boxTransform.property("ADBE Position").setValue(at);
        // The box is clipped to the inset, so a map that flies away does not draw over the scene.
        var mask = box.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        mask.property("ADBE Mask Shape").setValue(LML.minimap.rectPath(width, height));
        var toInset = LML.pins.addEffect(box, "ADBE Layer Control", "Map");
        toInset.property(1).setValue(made.layer.index);
        var toMain = LML.pins.addEffect(box, "ADBE Layer Control", "Main map");
        toMain.property(1).setValue(mainLayer.index);
        var errors = [];
        // The path is read again here: adding the stroke leaves the first handle to it stale.
        LML.pins.setExpression(boxInside.property(1).property("ADBE Vector Shape"), args.expressions.box, errors, "view box");
        LML.tag.write(box, { kind: "minimapBox", v: 1, mapId: args.mapId });

        return {
            insetId: made.id,
            insetComp: made.comp.name,
            name: made.layer.name,
            zoom: view.zoom,
            removed: removed,
            expressionErrors: errors
        };
    } finally {
        app.endUndoGroup();
    }
};

/** Takes a map's inset off the scene. args: { mapId } */
LML.api.removeMinimap = function (args) {
    var mainLayer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Remove the inset map", function () {
        return { removed: LML.minimap.removeTagged(mainLayer.containingComp, args.mapId) };
    });
};
