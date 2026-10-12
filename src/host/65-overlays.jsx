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
 * args: { mapId, kind, name, pathExpression, stroke: { color, width, opacity?, dash?, gap? }, trimKeys?,
 *         trimStartKeys?, linearKeys?, opacityKeys?, glow?, data? }
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
    if (args.stroke.dash > 0) {
        try {
            var dashes = stroke.property("ADBE Vector Stroke Dashes");
            dashes.addProperty("ADBE Vector Stroke Dash 1").setValue(args.stroke.dash);
            dashes.addProperty("ADBE Vector Stroke Gap 1").setValue(args.stroke.gap > 0 ? args.stroke.gap : args.stroke.dash);
        } catch (e0) {
            // A solid line is a fine fallback.
        }
    }
    if ((args.trimKeys && args.trimKeys.length) || (args.trimStartKeys && args.trimStartKeys.length)) {
        var trim = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
        if (args.trimKeys && args.trimKeys.length) {
            var end = trim.property("ADBE Vector Trim End");
            LML.overlays.keyFrames(end, mapLayer, args.trimKeys);
            if (!args.linearKeys) LML.overlays.ease(end);
        }
        // A comet is the same path trimmed at both ends: the tail follows the head.
        if (args.trimStartKeys && args.trimStartKeys.length) {
            var begin = trim.property("ADBE Vector Trim Start");
            LML.overlays.keyFrames(begin, mapLayer, args.trimStartKeys);
            if (!args.linearKeys) LML.overlays.ease(begin);
        }
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

/** The child of a property group by match name, or else the first whose match name or name fits `pattern`. */
LML.overlays.childOf = function (group, matchName, pattern) {
    var found = null;
    try {
        found = group.property(matchName);
    } catch (e) {
        found = null;
    }
    if (found) return found;
    for (var i = 1; i <= group.numProperties; i++) {
        var p = group.property(i);
        if (pattern.test(p.matchName) || pattern.test(p.name)) return p;
    }
    return null;
};

/** A Dropdown Menu Control with its items, set to a 1-based value. */
LML.overlays.addMenu = function (layer, name, items, value) {
    var parade = layer.property("ADBE Effect Parade");
    var index = parade.addProperty("ADBE Dropdown Control").propertyIndex;
    try {
        parade.property(index).property(1).setPropertyParameters(items);
    } catch (e) {
        // The menu keeps After Effects' own item names; the value still picks the style.
    }
    // Setting the items replaces the effect: fetch it again by its place.
    var menu = parade.property(index);
    menu.name = name;
    menu.property(1).setValue(value);
    return menu;
};

/**
 * Sets one of an arrow's expressions; a property After Effects refuses is reported by its label
 * instead of stopping the whole arrow.
 */
LML.overlays.arrowExpression = function (prop, code, errors, label, check) {
    try {
        LML.pins.setExpression(prop, code, errors, label, check);
    } catch (e) {
        errors.push(label + ": " + e.message);
    }
};

/**
 * One stroke of an arrow, every value linked to the layer's controls: x holds the expressions,
 * `width` and `opacity` name the ones for this stroke. Line strokes take the taper and the dashes too.
 * Returns false when this After Effects has no stroke taper.
 */
LML.overlays.arrowStroke = function (contents, name, x, parts, errors, label) {
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.name = name;
    LML.overlays.arrowExpression(stroke.property("ADBE Vector Stroke Color"), parts.color, errors, label + " colour", false);
    LML.overlays.arrowExpression(stroke.property("ADBE Vector Stroke Width"), parts.width, errors, label + " width");
    if (parts.opacity) LML.overlays.arrowExpression(stroke.property("ADBE Vector Stroke Opacity"), parts.opacity, errors, label + " opacity");
    // Butt ends on the line, so it stops where the head begins; round corners everywhere.
    stroke.property("ADBE Vector Stroke Line Cap").setValue(parts.line ? 1 : 2);
    stroke.property("ADBE Vector Stroke Line Join").setValue(2);
    if (!parts.line) return true;
    var dashes = stroke.property("ADBE Vector Stroke Dashes");
    LML.overlays.arrowExpression(dashes.addProperty("ADBE Vector Stroke Dash 1"), x.dash, errors, label + " dash");
    LML.overlays.arrowExpression(dashes.addProperty("ADBE Vector Stroke Gap 1"), x.gap, errors, label + " gap");
    // Every dash property is there from the start but hidden; adding it shows it, the offset too.
    var offset = null;
    try {
        offset = stroke.property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Offset");
    } catch (e) {
        errors.push(label + " dash flow: " + e.message);
    }
    if (offset) LML.overlays.arrowExpression(offset, x.dashOffset, errors, label + " dash flow");
    var taper = LML.overlays.childOf(stroke, "ADBE Vector Stroke Taper", /taper/i);
    if (!taper) return false;
    var startWidth = LML.overlays.childOf(taper, "ADBE Vector Taper Start Width", /start ?width/i);
    var startLength = LML.overlays.childOf(taper, "ADBE Vector Taper Start Length", /start ?length/i);
    if (!startWidth || !startLength) return false;
    LML.overlays.arrowExpression(startWidth, x.taperStartWidth, errors, label + " tail width");
    LML.overlays.arrowExpression(startLength, x.taperStartLength, errors, label + " taper length");
    return true;
};

/** A head of an arrow as a group: its shape, fill and strokes, moved and turned by `ends` (position, rotation, opacity). */
LML.overlays.arrowHead = function (root, name, x, ends, errors, label) {
    var group = root.addProperty("ADBE Vector Group");
    group.name = name;
    var contents = group.property("ADBE Vectors Group");
    var shape = contents.addProperty("ADBE Vector Shape - Group");
    LML.overlays.arrowExpression(shape.property("ADBE Vector Shape"), x.headPath, errors, label + " shape");
    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    LML.overlays.arrowExpression(fill.property("ADBE Vector Fill Color"), x.color, errors, label + " fill colour", false);
    LML.overlays.arrowExpression(fill.property("ADBE Vector Fill Opacity"), x.fillOpacity, errors, label + " fill");
    LML.overlays.arrowStroke(contents, "Chevron", x, { color: x.color, width: x.lineWidth, opacity: x.chevronOpacity }, errors, label + " chevron");
    LML.overlays.arrowStroke(contents, "Outline", x, { color: x.outlineColor, width: x.headOutlineWidth, opacity: x.outlineOpacity }, errors, label + " outline");
    var transform = group.property("ADBE Vector Transform Group");
    LML.overlays.arrowExpression(transform.property("ADBE Vector Position"), ends.position, errors, label + " position");
    LML.overlays.arrowExpression(transform.property("ADBE Vector Rotation"), ends.rotation, errors, label + " rotation");
    LML.overlays.arrowExpression(transform.property("ADBE Vector Group Opacity"), ends.opacity, errors, label + " opacity");
};

/**
 * A route drawn as an arrow (the arrow rig): one shape layer with the line and its heads, every look a
 * control on the layer. "Progress" moves the tip, "Tail" the start; the expressions come from the panel
 * (src/core/ae/arrowRig.ts).
 * args: { mapId, kind, name, data?, expressions, headStyles: [names], progressKeys: [[frame, value]],
 *         linearKeys?, glow?, controls: { width, tailWidth, taperLength, headSize, headStyle, bothEnds,
 *         dash, gap, dashSpeed, outline, color, outlineColor } }
 */
LML.overlays.addArrow = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var errors = [];
    var warnings = [];
    var x = args.expressions;
    var c = args.controls;
    var layer = scene.layers.addShape();
    layer.name = args.name;
    LML.overlays.linkToMap(layer, mapLayer);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Progress", 0);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Tail", 0);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Width", c.width);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Tail Width", c.tailWidth);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Taper Length", c.taperLength);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Head Size", c.headSize);
    LML.overlays.addMenu(layer, "Head Style", args.headStyles, c.headStyle);
    LML.pins.addEffect(layer, "ADBE Checkbox Control", "Both Ends", c.bothEnds);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Dash", c.dash);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Gap", c.gap);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Dash Speed", c.dashSpeed);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Outline Width", c.outline);
    LML.pins.addEffect(layer, "ADBE Color Control", "Color", c.color);
    LML.pins.addEffect(layer, "ADBE Color Control", "Outline Color", c.outlineColor);
    // Adding an effect invalidates references to the effects before it: fetch the slider by name now.
    var progress = layer.property("ADBE Effect Parade").property("Progress").property(1);
    if (args.progressKeys && args.progressKeys.length) {
        LML.overlays.keyFrames(progress, mapLayer, args.progressKeys);
        if (!args.linearKeys) LML.overlays.ease(progress);
    }

    // Listed first is drawn on top: the heads, then the line.
    var root = layer.property("ADBE Root Vectors Group");
    LML.overlays.arrowHead(root, "Head", x, { position: x.headPosition, rotation: x.headRotation, opacity: x.headOpacity }, errors, args.name + " head");
    LML.overlays.arrowHead(root, "Tail Head", x, { position: x.tailPosition, rotation: x.tailRotation, opacity: x.tailOpacity }, errors, args.name + " tail head");
    var line = root.addProperty("ADBE Vector Group");
    line.name = "Line";
    var contents = line.property("ADBE Vectors Group");
    var path = contents.addProperty("ADBE Vector Shape - Group");
    LML.overlays.arrowExpression(path.property("ADBE Vector Shape"), x.path, errors, args.name + " path");
    var tapered = LML.overlays.arrowStroke(contents, "Line", x, { color: x.color, width: x.lineWidth, line: true }, errors, args.name + " line");
    LML.overlays.arrowStroke(contents, "Outline", x, { color: x.outlineColor, width: x.outlineWidth, opacity: x.outlineOpacity, line: true }, errors, args.name + " outline");
    if (!tapered) warnings.push(args.name + ": this After Effects has no stroke taper, so the line keeps one width");
    // After the strokes, so it trims both: the line runs from Tail to just behind the head.
    var trim = contents.addProperty("ADBE Vector Filter - Trim");
    LML.overlays.arrowExpression(trim.property("ADBE Vector Trim Start"), x.trimStart, errors, args.name + " trim start");
    LML.overlays.arrowExpression(trim.property("ADBE Vector Trim End"), x.trimEnd, errors, args.name + " trim end");

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
    var arrowTag = { kind: args.kind, v: 1, mapId: args.mapId, name: args.name };
    if (args.data) arrowTag.data = args.data;
    LML.tag.write(layer, arrowTag);
    return { name: layer.name, index: layer.index, expressionErrors: errors, warnings: warnings };
};

/**
 * A map feature as an editable shape layer: one closed path per ring of the outline, all in one group,
 * with an even-odd fill (so holes stay holes) and a stroke. Everything is an ordinary shape layer
 * property, so the layer can be restyled and animated in After Effects by hand afterwards.
 * args: { mapId, kind, name, paths: [expression], fill: { color, opacity } | null,
 *         stroke: { color, width, dash } | null, trimKeys?, opacityKeys?, glow?, data?,
 *         partName? (what each path is called when there are several; "Ring" by default) }
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
        shape.name = args.paths.length > 1 ? (args.partName || "Ring") + " " + (i + 1) : "Path";
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
