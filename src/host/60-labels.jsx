/*
 * Labels: text layers (and place dots) attached to a map, placed over the whole timeline by the
 * panel (src/core/labels/placement.ts). The host builds the layers, picks fonts that exist on this
 * machine, sets the position expressions and the fade keyframes. Regenerating replaces only the
 * tagged label layers of that map.
 */
LML.labels = LML.labels || {};

/** The first PostScript font name After Effects has, or null. */
LML.labels.pickFont = function (names) {
    if (!names) return null;
    for (var i = 0; i < names.length; i++) {
        try {
            var found = app.fonts.getFontsByPostScriptName(names[i]);
            if (found && found.length) return names[i];
        } catch (e) {
            return null;
        }
    }
    return null;
};

LML.labels.removeTagged = function (scene, mapId, kind) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== kind || tag.mapId !== mapId) continue;
        layer.locked = false;
        layer.remove();
        removed++;
    }
    return removed;
};

LML.labels.styleText = function (layer, style) {
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.resetCharStyle();
    doc.resetParagraphStyle();
    doc.fontSize = style.size;
    doc.applyFill = true;
    doc.fillColor = style.color;
    if (style.haloWidth > 0) {
        doc.applyStroke = true;
        doc.strokeColor = style.haloColor;
        doc.strokeWidth = style.haloWidth;
        doc.strokeOverFill = false;
    } else {
        doc.applyStroke = false;
    }
    if (style.font) doc.font = style.font;
    doc.tracking = style.tracking || 0;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    try {
        doc.composerEngine = ComposerEngine.UNIVERSAL_TYPE_ENGINE;
    } catch (e) {
        // Older After Effects: the default composer.
    }
    if (style.rtl) {
        try {
            doc.direction = ParagraphDirection.DIRECTION_RIGHT_TO_LEFT;
        } catch (e2) {
            // Not available before After Effects 24.
        }
    }
    prop.setValue(doc);
};

/** Fade keys: [[frame, opacity], ...] on the map comp's frames, converted to scene time. */
LML.labels.setOpacityKeys = function (layer, mapLayer, keys) {
    var fps = mapLayer.source.frameRate;
    var times = [];
    var values = [];
    for (var i = 0; i < keys.length; i++) {
        times.push(mapLayer.startTime + keys[i][0] / fps);
        values.push(keys[i][1]);
    }
    var opacity = layer.property("ADBE Transform Group").property("ADBE Opacity");
    if (times.length) opacity.setValuesAtTimes(times, values);
    else opacity.setValue(0);
};

LML.labels.link = function (layer, mapLayer, expression, errors, label) {
    var link = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
    link.name = "Map";
    link.property(1).setValue(mapLayer.index);
    LML.pins.setExpression(layer.property("ADBE Transform Group").property("ADBE Position"), expression, errors, label);
};

/**
 * args: { mapId, labels: [{ id, name, text, subtitle, keys, dot, main: style, sub: style, dotStyle,
 *         expressions: { main, sub, dot } }] }
 * style: { size, color, haloColor, haloWidth, fonts: [], tracking, rtl }
 */
LML.labels.addLabels = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var removed = LML.labels.removeTagged(scene, args.mapId, "label");
    // Building many linked layers while the scene is on screen makes After Effects re-evaluate every
    // expression after each change; show the map comp meanwhile and bring the scene back at the end.
    var viewerWasScene = app.project.activeItem === scene;
    try {
        if (viewerWasScene) mapLayer.source.openInViewer();
    } catch (e0) {
        viewerWasScene = false;
    }
    var errors = [];
    var layers = 0;
    var fonts = {};
    var fontFor = function (names) {
        var key = names ? names.join(",") : "";
        if (!(key in fonts)) fonts[key] = LML.labels.pickFont(names);
        return fonts[key];
    };
    for (var i = 0; i < args.labels.length; i++) {
        var spec = args.labels[i];
        var parts = [];
        if (spec.dot) {
            var dot = scene.layers.addShape();
            var group = dot.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            var contents = group.property("ADBE Vectors Group");
            contents.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([spec.dotStyle.radius * 2, spec.dotStyle.radius * 2]);
            var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue(spec.dotStyle.strokeColor);
            stroke.property("ADBE Vector Stroke Width").setValue(spec.dotStyle.strokeWidth);
            contents.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(spec.dotStyle.color);
            dot.name = "Dot: " + spec.name;
            LML.labels.link(dot, mapLayer, spec.expressions.dot, errors, spec.name + " dot");
            parts.push([dot, "dot"]);
        }
        var main = scene.layers.addText(spec.text);
        main.name = "Label: " + spec.name;
        spec.main.font = fontFor(spec.main.fonts);
        LML.labels.styleText(main, spec.main);
        LML.labels.link(main, mapLayer, spec.expressions.main, errors, spec.name);
        parts.push([main, "text"]);
        if (spec.subtitle) {
            var sub = scene.layers.addText(spec.subtitle);
            sub.name = "Label: " + spec.name + " (subtitle)";
            spec.sub.font = fontFor(spec.sub.fonts);
            LML.labels.styleText(sub, spec.sub);
            LML.labels.link(sub, mapLayer, spec.expressions.sub, errors, spec.name + " subtitle");
            parts.push([sub, "subtitle"]);
        }
        for (var p = 0; p < parts.length; p++) {
            var layer = parts[p][0];
            LML.labels.setOpacityKeys(layer, mapLayer, spec.keys);
            layer.moveBefore(mapLayer);
            LML.tag.write(layer, { kind: "label", v: 1, mapId: args.mapId, labelId: spec.id, part: parts[p][1] });
            layers++;
        }
    }
    try {
        if (viewerWasScene) scene.openInViewer();
    } catch (e1) {
        // No viewer.
    }
    return { labels: args.labels.length, layers: layers, removed: removed, expressionErrors: errors, fonts: fonts };
};
