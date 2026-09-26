// Paths the user drew over a map: pen-tool shape layers (and their rectangles and ellipses) and
// masks on any layer. Only read here, never changed: the panel turns them into routes and areas
// (core/geo/drawnPaths.ts), and the drawing stays as the user left it.

LML.drawn = {};

LML.drawn.pair = function (value) {
    return [Number(value[0]) || 0, Number(value[1]) || 0];
};

/** A layer's own 2D transform at a time, with separated position dimensions read one by one. */
LML.drawn.layerTransform = function (layer, time) {
    var t = layer.property("ADBE Transform Group");
    var position = t.property("ADBE Position");
    var at;
    if (position.dimensionsSeparated) {
        at = [t.property("ADBE Position_0").valueAtTime(time, false), t.property("ADBE Position_1").valueAtTime(time, false)];
    } else {
        at = LML.drawn.pair(position.valueAtTime(time, false));
    }
    var rotation = 0;
    try {
        rotation = t.property("ADBE Rotate Z").valueAtTime(time, false);
    } catch (eR) {
        rotation = 0;
    }
    return {
        anchor: LML.drawn.pair(t.property("ADBE Anchor Point").valueAtTime(time, false)),
        position: at,
        scale: LML.drawn.pair(t.property("ADBE Scale").valueAtTime(time, false)),
        rotation: rotation
    };
};

/** A shape group's transform at a time. */
LML.drawn.groupTransform = function (group, time) {
    var t = group.property("ADBE Vector Transform Group");
    return {
        anchor: LML.drawn.pair(t.property("ADBE Vector Anchor").valueAtTime(time, false)),
        position: LML.drawn.pair(t.property("ADBE Vector Position").valueAtTime(time, false)),
        scale: LML.drawn.pair(t.property("ADBE Vector Scale").valueAtTime(time, false)),
        rotation: t.property("ADBE Vector Rotation").valueAtTime(time, false)
    };
};

LML.drawn.points = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(LML.drawn.pair(list[i]));
    return out;
};

LML.drawn.fromShape = function (shape, chain, name) {
    return { name: name, closed: !!shape.closed, vertices: LML.drawn.points(shape.vertices), inTangents: LML.drawn.points(shape.inTangents), outTangents: LML.drawn.points(shape.outTangents), chain: chain };
};

/** A rectangle or an ellipse of a shape layer, as the bezier path it draws. */
LML.drawn.fromParametric = function (item, time, chain, name) {
    var ellipse = item.matchName === "ADBE Vector Shape - Ellipse";
    var size = LML.drawn.pair(item.property(ellipse ? "ADBE Vector Ellipse Size" : "ADBE Vector Rect Size").valueAtTime(time, false));
    var at = LML.drawn.pair(item.property(ellipse ? "ADBE Vector Ellipse Position" : "ADBE Vector Rect Position").valueAtTime(time, false));
    var rx = size[0] / 2;
    var ry = size[1] / 2;
    if (!ellipse) {
        return {
            name: name,
            closed: true,
            vertices: [[at[0] - rx, at[1] - ry], [at[0] + rx, at[1] - ry], [at[0] + rx, at[1] + ry], [at[0] - rx, at[1] + ry]],
            inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]],
            outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]],
            chain: chain
        };
    }
    var kx = 0.5523 * rx;
    var ky = 0.5523 * ry;
    return {
        name: name,
        closed: true,
        vertices: [[at[0], at[1] - ry], [at[0] + rx, at[1]], [at[0], at[1] + ry], [at[0] - rx, at[1]]],
        inTangents: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
        outTangents: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
        chain: chain
    };
};

/** Every visible path in a shape layer's contents, with the group transforms above it (innermost first). */
LML.drawn.walk = function (contents, chain, time, name, out, skipped) {
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        if (item.enabled === false) continue;
        var kind = item.matchName;
        if (kind === "ADBE Vector Group") {
            LML.drawn.walk(item.property("ADBE Vectors Group"), [LML.drawn.groupTransform(item, time)].concat(chain), time, name, out, skipped);
        } else if (kind === "ADBE Vector Shape - Group") {
            out.push(LML.drawn.fromShape(item.property("ADBE Vector Shape").valueAtTime(time, false), chain, name));
        } else if (kind === "ADBE Vector Shape - Rect" || kind === "ADBE Vector Shape - Ellipse") {
            out.push(LML.drawn.fromParametric(item, time, chain, name));
        } else if (kind === "ADBE Vector Shape - Star") {
            skipped.push(name + ": a star or polygon (convert it to a Bezier path first)");
        }
    }
};

/**
 * The paths of the selected layers, where they lie at the current time, with the camera of that
 * moment. Works in the scene comp and inside the map comp. args: { mapId }
 */
LML.api.readDrawnPaths = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var mapComp = mapLayer.source;
    var inside = app.project.activeItem === mapComp;
    var comp = inside ? mapComp : scene;
    var sceneTime = inside ? mapComp.time + mapLayer.startTime : scene.time;
    var time = comp.time;
    var selected = comp.selectedLayers;
    var paths = [];
    var skipped = [];
    for (var i = 0; i < selected.length; i++) {
        var layer = selected[i];
        var isMap = layer === mapLayer;
        if (!isMap && LML.tag.read(layer)) {
            skipped.push(layer.name + ": made by LazyMapLayers, it already follows the map");
            continue;
        }
        var flat = !layer.threeDLayer;
        var owner = layer.parent;
        while (owner && flat) {
            if (owner.threeDLayer) flat = false;
            owner = owner.parent;
        }
        if (!flat) {
            skipped.push(layer.name + ": a 3D layer (draw on a 2D one)");
            continue;
        }
        // Through the layer and its parents into the comp.
        var chain = [LML.drawn.layerTransform(layer, time)];
        owner = layer.parent;
        while (owner) {
            chain.push(LML.drawn.layerTransform(owner, time));
            owner = owner.parent;
        }
        var found = [];
        if (!isMap && layer.matchName === "ADBE Vector Layer") {
            LML.drawn.walk(layer.property("ADBE Root Vectors Group"), [], time, layer.name, found, skipped);
            for (var f = 0; f < found.length; f++) found[f].chain = found[f].chain.concat(chain);
        }
        var masks = layer.property("ADBE Mask Parade");
        if (masks) {
            for (var m = 1; m <= masks.numProperties; m++) {
                var mask = masks.property(m);
                found.push(LML.drawn.fromShape(mask.property("ADBE Mask Shape").valueAtTime(time, false), chain, layer.name));
            }
        }
        if (!found.length && !isMap) skipped.push(layer.name + ": no path or mask");
        for (var p = 0; p < found.length; p++) {
            if (found.length > 1) found[p].name = layer.name + " " + (p + 1);
            paths.push(found[p]);
        }
    }
    if (!paths.length) {
        var why = skipped.length ? " (" + skipped.join("; ") + ")" : "";
        throw LML.util.error("NO_DRAWN_PATHS", "Select the shape layer you drew with the Pen tool, or a layer with masks, in " + comp.name + " first" + why);
    }
    return {
        time: sceneTime - mapLayer.startTime,
        view: LML.map.readViewAtTime(mapLayer, sceneTime),
        width: mapComp.width,
        height: mapComp.height,
        // Inside the map comp the paths are already in its pixels.
        mapLayer: inside ? null : LML.drawn.layerTransform(mapLayer, sceneTime),
        paths: paths,
        skipped: skipped
    };
};
