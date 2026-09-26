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

/**
 * The mark beside a name: a circle for a city, a waterfall or a pole, a triangle for a peak (a
 * three-sided polystar: Type 2 is a polygon, and a three-sided one points up). Sets the size on
 * whichever of the two the group holds.
 */
LML.labels.markShape = function (contents, style) {
    var circle = contents.property("ADBE Vector Shape - Ellipse");
    var star = contents.property("ADBE Vector Shape - Star");
    if (!circle && !star) {
        if (style.shape === "triangle") {
            star = contents.addProperty("ADBE Vector Shape - Star");
            star.property("ADBE Vector Star Type").setValue(2);
            star.property("ADBE Vector Star Points").setValue(3);
        } else {
            circle = contents.addProperty("ADBE Vector Shape - Ellipse");
        }
    }
    if (star) star.property("ADBE Vector Star Outer Radius").setValue(style.radius);
    if (circle) circle.property("ADBE Vector Ellipse Size").setValue([style.radius * 2, style.radius * 2]);
};

LML.labels.removeTagged = function (scene, mapId, kind) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== kind || tag.mapId !== mapId) continue;
        // A label built from a design owns its copied comp: it goes with the layer.
        var source = tag.part === "design" && layer.source instanceof CompItem ? layer.source : null;
        layer.locked = false;
        layer.remove();
        if (source) {
            try {
                source.remove();
            } catch (e) {
                // A copy the user reused somewhere else stays.
            }
        }
        removed++;
    }
    return removed;
};

/** Styles a text layer; with `text`, its words change as well (capitals on or off). */
LML.labels.styleText = function (layer, style, text) {
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    if (text !== undefined && text !== null && doc.text !== text) doc.text = text;
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
    // Labels are centred on their place; a legend's rows start at their own left edge.
    doc.justification = style.justify === "left" ? ParagraphJustification.LEFT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY;
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

LML.labels.link = function (layer, mapLayer, expression, errors, label, check) {
    var link = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
    link.name = "Map";
    link.property(1).setValue(mapLayer.index);
    LML.pins.setExpression(layer.property("ADBE Transform Group").property("ADBE Position"), expression, errors, label, check);
};

/** The label layers of a map, for restyling: which label, which part, and what each says. args: { mapId, kind } */
LML.labels.list = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var kind = args.kind || "label";
    var out = [];
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== kind || tag.mapId !== args.mapId || !tag.labelId) continue;
        var text = "";
        var properties = layer.property("ADBE Text Properties");
        if (properties) text = properties.property("ADBE Text Document").value.text;
        out.push({ labelId: tag.labelId, part: tag.part || "text", text: text, raw: tag.raw || null, place: tag.place || null });
    }
    return out;
};

/**
 * Restyles the labels already on a map. args: { mapId, kind, first, last,
 *   texts: [{ labelId, part, text, style }], dots: [{ labelId, style: { radius, color, strokeColor, strokeWidth } }],
 *   remove: [labelId] }
 * Sent in batches like addLabels: the first takes the scene out of the viewer, the last brings it back.
 */
LML.labels.restyle = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var kind = args.kind || "label";
    if (args.first !== false) {
        LML.labels.finish();
        var viewerWasScene = app.project.activeItem === scene;
        try {
            if (viewerWasScene) mapLayer.source.openInViewer();
        } catch (e0) {
            viewerWasScene = false;
        }
        LML.labels.pending = { mapId: args.mapId, viewerWasScene: viewerWasScene };
    }
    var byKey = {};
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== kind || tag.mapId !== args.mapId || !tag.labelId) continue;
        byKey[tag.labelId + "|" + (tag.part || "text")] = layer;
    }
    var fonts = {};
    var fontFor = function (names) {
        var key = names ? names.join(",") : "";
        if (!(key in fonts)) fonts[key] = LML.labels.pickFont(names);
        return fonts[key];
    };
    var texts = 0;
    var dots = 0;
    var removed = 0;
    var items = args.texts || [];
    for (var t = 0; t < items.length; t++) {
        var item = items[t];
        var target = byKey[item.labelId + "|" + item.part];
        if (!target || !target.property("ADBE Text Properties")) continue;
        item.style.font = fontFor(item.style.fonts);
        LML.labels.styleText(target, item.style, item.text);
        texts++;
    }
    var dotItems = args.dots || [];
    for (var d = 0; d < dotItems.length; d++) {
        var dot = byKey[dotItems[d].labelId + "|dot"];
        if (!dot) continue;
        var style = dotItems[d].style;
        var contents = dot.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
        LML.labels.markShape(contents, style);
        var stroke = contents.property("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(style.strokeColor);
        stroke.property("ADBE Vector Stroke Width").setValue(style.strokeWidth);
        contents.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(style.color);
        dots++;
    }
    var gone = args.remove || [];
    for (var r = 0; r < gone.length; r++) {
        var old = byKey[gone[r] + "|dot"];
        if (!old) continue;
        old.locked = false;
        old.remove();
        removed++;
    }
    if (args.last !== false) LML.labels.finish();
    return { texts: texts, dots: dots, removed: removed };
};

/**
 * Moves the labels already on a map: a new position expression and new fade keys per part.
 * args: { mapId, kind, first, last, items: [{ labelId, part, positionExpression, keys }] }
 * Batched like addLabels: the first takes the scene out of the viewer, the last brings it back.
 */
LML.labels.move = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var kind = args.kind || "label";
    if (args.first !== false) {
        LML.labels.finish();
        var viewerWasScene = app.project.activeItem === scene;
        try {
            if (viewerWasScene) mapLayer.source.openInViewer();
        } catch (e0) {
            viewerWasScene = false;
        }
        LML.labels.pending = { mapId: args.mapId, viewerWasScene: viewerWasScene };
    }
    var byKey = {};
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== kind || tag.mapId !== args.mapId || !tag.labelId) continue;
        byKey[tag.labelId + "|" + (tag.part || "text")] = layer;
    }
    var errors = [];
    var moved = 0;
    var items = args.items || [];
    for (var t = 0; t < items.length; t++) {
        var item = items[t];
        var target = byKey[item.labelId + "|" + item.part];
        if (!target) continue;
        LML.pins.setExpression(target.property("ADBE Transform Group").property("ADBE Position"), item.positionExpression, errors, item.labelId, t === 0 && args.first !== false);
        // The old fades go before the new ones, so a name that now hides keeps no stray keys.
        var opacity = target.property("ADBE Transform Group").property("ADBE Opacity");
        while (opacity.numKeys > 0) opacity.removeKey(1);
        LML.labels.setOpacityKeys(target, mapLayer, item.keys || []);
        moved++;
    }
    if (args.last !== false) LML.labels.finish();
    return { moved: moved, expressionErrors: errors };
};

/**
 * Label designs: comps of the user's own with {field} text layers. Every comp in the project that
 * holds a text layer with a field and is not one of ours can be a label's design; the panel lists
 * them and Auto labels puts a copy of the chosen one on every place.
 */
LML.labels.FIELD = /\{[a-zA-Z_]+\}/g;

/** A picture field: a layer of any kind but text whose whole name is {field}. */
LML.labels.IMAGE_FIELD = /^\{([a-zA-Z_]+)\}$/;

LML.labels.imageFieldOf = function (layer) {
    if (layer.property("ADBE Text Properties")) return null;
    var match = layer.name.match(LML.labels.IMAGE_FIELD);
    return match ? match[1] : null;
};

/** The anchor inside a design: the position of a layer called "Anchor", else the comp's centre. */
LML.labels.designAnchor = function (comp) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer.name.toLowerCase() !== "anchor") continue;
        var p = layer.property("ADBE Transform Group").property("ADBE Position").value;
        return [p[0], p[1]];
    }
    return [comp.width / 2, comp.height / 2];
};

/** Every design in the project: its size, its anchor and the fields it asks for. */
LML.api.listLabelDesigns = function () {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof CompItem)) continue;
        // Our own comps (maps, scenes, legends, label copies) are never designs.
        if (LML.tag.read(item)) continue;
        var fields = [];
        var seen = {};
        for (var l = 1; l <= item.numLayers; l++) {
            var prop = item.layer(l).property("ADBE Text Properties");
            if (!prop) continue;
            var found = prop.property("ADBE Text Document").value.text.match(LML.labels.FIELD);
            if (!found) continue;
            for (var f = 0; f < found.length; f++) {
                var name = found[f].substring(1, found[f].length - 1);
                if (seen[name]) continue;
                seen[name] = true;
                fields.push(name);
            }
        }
        var images = [];
        for (var m = 1; m <= item.numLayers; m++) {
            var field = LML.labels.imageFieldOf(item.layer(m));
            if (field && !seen["image:" + field]) {
                seen["image:" + field] = true;
                images.push(field);
            }
        }
        if (!fields.length && !images.length) continue;
        var anchor = LML.labels.designAnchor(item);
        out.push({ compId: item.id, name: item.name, width: item.width, height: item.height, anchorX: anchor[0], anchorY: anchor[1], fields: fields, images: images });
    }
    return out;
};

/** The folder the copies of a design live in, made once. */
LML.labels.designFolder = function () {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FolderItem && item.name === "LazyMapLayers Labels") return item;
    }
    var folder = app.project.items.addFolder("LazyMapLayers Labels");
    return folder;
};

/**
 * A copy of the design with its fields filled in. values: { name: "Dhaka", population: "8.9 M", ... }
 * A text layer's whole source text is kept, so "Pop. {population}" reads "Pop. 8.9 M".
 */
/** A picture as footage, imported once however many labels show it. */
LML.labels.imageFootage = function (path) {
    var wanted = new File(path);
    if (!wanted.exists) return null;
    var name = wanted.fsName.toLowerCase();
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FootageItem && item.mainSource && item.mainSource.file && item.mainSource.file.fsName.toLowerCase() === name) return item;
    }
    var footage = app.project.importFile(new ImportOptions(wanted));
    footage.parentFolder = LML.labels.designFolder();
    return footage;
};

/**
 * Puts each place's picture into the design's {field} layers, fitted into the box the placeholder
 * takes and keeping its shape; a field with no picture for this place is switched off.
 */
LML.labels.fillImages = function (comp, images) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        var field = LML.labels.imageFieldOf(layer);
        if (!field) continue;
        var path = images && images.hasOwnProperty(field) ? images[field] : null;
        var footage = path ? LML.labels.imageFootage(path) : null;
        if (!footage || !layer.source) {
            layer.enabled = false;
            continue;
        }
        var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
        var old = scale.value;
        var boxW = layer.source.width * Math.abs(old[0]) / 100;
        var boxH = layer.source.height * Math.abs(old[1]) / 100;
        // Replacing a source renames a layer that took its name from it; the field keeps its name.
        var fieldName = layer.name;
        layer.replaceSource(footage, false);
        layer.name = fieldName;
        var fit = Math.min(boxW / footage.width, boxH / footage.height) * 100;
        var next = [fit * (old[0] < 0 ? -1 : 1), fit * (old[1] < 0 ? -1 : 1)];
        if (old.length > 2) next.push(old[2]);
        if (scale.numKeys === 0) scale.setValue(next);
        layer.enabled = true;
    }
};

LML.labels.fillDesign = function (design, values, label, images) {
    var copy = design.duplicate();
    copy.name = "Label: " + label;
    copy.parentFolder = LML.labels.designFolder();
    for (var i = 1; i <= copy.numLayers; i++) {
        var layer = copy.layer(i);
        var prop = layer.property("ADBE Text Properties");
        if (!prop) continue;
        var doc = prop.property("ADBE Text Document").value;
        var text = doc.text;
        if (!text.match(LML.labels.FIELD)) continue;
        var filled = "";
        var rest = text;
        while (true) {
            var at = rest.indexOf("{");
            if (at < 0) break;
            var end = rest.indexOf("}", at);
            if (end < 0) break;
            var key = rest.substring(at + 1, end);
            var value = values.hasOwnProperty(key) ? String(values[key]) : "";
            filled += rest.substring(0, at) + value;
            rest = rest.substring(end + 1);
        }
        doc.text = filled + rest;
        prop.property("ADBE Text Document").setValue(doc);
    }
    LML.labels.fillImages(copy, images || {});
    return copy;
};

/** Where a batched label build stands between host calls: { mapId, viewerWasScene }. */
LML.labels.pending = null;

/** Ends a batched build: the scene comes back into the viewer. Safe to call at any time. */
LML.labels.finish = function () {
    var pending = LML.labels.pending;
    LML.labels.pending = null;
    if (!pending || !pending.viewerWasScene) return false;
    try {
        LML.pins.findMapLayer(pending.mapId).containingComp.openInViewer();
    } catch (e) {
        // No viewer, or the map is gone.
    }
    return true;
};

/**
 * args: { mapId, labels: [{ id, name, text, subtitle, keys, dot, main: style, sub: style, dotStyle,
 *         expressions: { main, sub, dot } }], first, last }
 * style: { size, color, haloColor, haloWidth, fonts: [], tracking, rtl }
 *
 * The panel sends labels in small batches, so After Effects never blocks for long: the batch with
 * first (default true) removes the old labels and takes the scene out of the viewer, the batch with
 * last (default true) brings it back. Expressions are checked on the first label of a build only:
 * they all come from one generator.
 */
LML.labels.addLabels = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    // Auto labels are one kind of linked text; the numbers of a data map are another, and each kind
    // replaces only its own layers.
    var kind = args.kind || "label";
    var prefix = args.prefix || "Label";
    var isFirst = args.first !== false;
    var isLast = args.last !== false;
    var removed = 0;
    if (isFirst) {
        LML.labels.finish();
        removed = LML.labels.removeTagged(scene, args.mapId, kind);
        // Building many linked layers while the scene is on screen makes After Effects re-evaluate every
        // expression after each change; show the map comp meanwhile and bring the scene back at the end.
        var viewerWasScene = app.project.activeItem === scene;
        try {
            if (viewerWasScene) mapLayer.source.openInViewer();
        } catch (e0) {
            viewerWasScene = false;
        }
        LML.labels.pending = { mapId: args.mapId, viewerWasScene: viewerWasScene };
    }
    var errors = [];
    var layers = 0;
    var fonts = {};
    // Milliseconds per kind of step, so slow steps show up in test reports.
    var timings = { create: 0, style: 0, link: 0, keys: 0, order: 0, tag: 0 };
    var clock = new Date().getTime();
    var lap = function (name) {
        var now = new Date().getTime();
        timings[name] += now - clock;
        clock = now;
    };
    var fontFor = function (names) {
        var key = names ? names.join(",") : "";
        if (!(key in fonts)) fonts[key] = LML.labels.pickFont(names);
        return fonts[key];
    };
    for (var i = 0; i < args.labels.length; i++) {
        var spec = args.labels[i];
        var parts = [];
        var check = isFirst && i === 0;
        if (spec.dot) {
            var dot = scene.layers.addShape();
            var group = dot.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            var contents = group.property("ADBE Vectors Group");
            LML.labels.markShape(contents, spec.dotStyle);
            var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue(spec.dotStyle.strokeColor);
            stroke.property("ADBE Vector Stroke Width").setValue(spec.dotStyle.strokeWidth);
            contents.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(spec.dotStyle.color);
            dot.name = (spec.dotStyle.shape === "triangle" ? "Peak: " : "Dot: ") + spec.name;
            lap("create");
            LML.labels.link(dot, mapLayer, spec.expressions.dot, errors, spec.name + " dot", check);
            lap("link");
            parts.push([dot, "dot"]);
        }
        var main;
        if (spec.design) {
            // A design of the user's own: a copy of their comp, its fields filled, on the place.
            var design = LML.tag.findItemById(spec.design.compId);
            if (!design) throw LML.util.error("DESIGN_GONE", "The label design comp is not in this project any more");
            main = scene.layers.add(LML.labels.fillDesign(design, spec.design.values, spec.name, spec.design.images || {}));
            main.anchorPoint.setValue([spec.design.anchorX, spec.design.anchorY, 0]);
            if (spec.design.scale && spec.design.scale !== 100) main.property("ADBE Transform Group").property("ADBE Scale").setValue([spec.design.scale, spec.design.scale, 100]);
        } else {
            main = scene.layers.addText(spec.text);
        }
        main.name = prefix + ": " + spec.name;
        lap("create");
        if (!spec.design) {
            spec.main.font = fontFor(spec.main.fonts);
            LML.labels.styleText(main, spec.main);
            lap("style");
        }
        LML.labels.link(main, mapLayer, spec.expressions.main, errors, spec.name, check);
        // A street or a river in town: the name turns with its line (2D layers turn on Rotate Z).
        if (spec.expressions.rotation) {
            LML.pins.setExpression(main.property("ADBE Transform Group").property("ADBE Rotate Z"), spec.expressions.rotation, errors, spec.name + " angle", check);
        }
        lap("link");
        parts.push([main, spec.design ? "design" : "text"]);
        if (spec.subtitle) {
            var sub = scene.layers.addText(spec.subtitle);
            sub.name = prefix + ": " + spec.name + " (subtitle)";
            lap("create");
            spec.sub.font = fontFor(spec.sub.fonts);
            LML.labels.styleText(sub, spec.sub);
            lap("style");
            LML.labels.link(sub, mapLayer, spec.expressions.sub, errors, spec.name + " subtitle", check);
            lap("link");
            parts.push([sub, "subtitle"]);
        }
        for (var p = 0; p < parts.length; p++) {
            var layer = parts[p][0];
            LML.labels.setOpacityKeys(layer, mapLayer, spec.keys);
            lap("keys");
            layer.moveBefore(mapLayer);
            lap("order");
            var written = { kind: kind, v: 1, mapId: args.mapId, labelId: spec.id, part: parts[p][1] };
            // The words the name was placed with, so capitals can come off again when the template changes.
            if (parts[p][1] === "text" && spec.raw) written.raw = spec.raw;
            // A name inside a city keeps where it stands: placing it again later needs no tiles.
            if (parts[p][1] === "text" && spec.place) written.place = spec.place;
            if (parts[p][1] === "design") {
                written.raw = spec.raw;
                written.w = spec.design.width;
                written.h = spec.design.height;
            }
            LML.tag.write(layer, written);
            lap("tag");
            layers++;
        }
    }
    if (isLast) LML.labels.finish();
    return { labels: args.labels.length, layers: layers, removed: removed, expressionErrors: errors, fonts: fonts, timings: timings };
};
