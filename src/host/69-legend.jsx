// The legend of the numbers on a map: a precomp with a background, a title and one row per step,
// placed in the scene where the panel asks. It is not linked to the map - a legend stays where the
// designer puts it - and it is tagged, so building it again replaces the old one and nothing else.

LML.legend = LML.legend || {};

/** Removes the legend of a map, and the comp behind it, wherever it sits in the scene. */
LML.legend.removeTagged = function (scene, mapId) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "legend" || tag.mapId !== mapId) continue;
        var source = layer.source;
        layer.remove();
        removed++;
        // The comp goes with it, unless the user put it somewhere else as well.
        try {
            if (source && source.usedIn && source.usedIn.length === 0) source.remove();
        } catch (e) {
            // A comp that cannot be removed is left where it is.
        }
    }
    return removed;
};

LML.legend.rectGroup = function (contents, row) {
    var group = contents.addProperty("ADBE Vector Group");
    group.name = row.label || "Step";
    var inside = group.property("ADBE Vectors Group");
    var rect = inside.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([row.swatch.width, row.swatch.height]);
    rect.property("ADBE Vector Rect Position").setValue([row.swatch.x + row.swatch.width / 2, row.swatch.y + row.swatch.height / 2]);
    rect.property("ADBE Vector Rect Roundness").setValue(row.radius || 0);
    var fill = inside.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(row.color);
    return group;
};

/**
 * Builds the legend. args: {
 *   mapId, name, width, height, position: [x, y],
 *   background: { color, opacity, radius }, border: { color, width } | null,
 *   title: { text, x, y, size } | null, textColor, font, fonts,
 *   rows: [{ color, label, size, swatch: {x,y,width,height}, text: {x,y} }]
 * }
 */
LML.api.addLegend = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Legend");
    try {
        var removed = LML.legend.removeTagged(scene, args.mapId);
        var comp = app.project.items.addComp(LML.map.uniqueCompName(args.name), Math.max(4, Math.round(args.width)), Math.max(4, Math.round(args.height)), 1, scene.duration, scene.frameRate);
        comp.parentFolder = LML.map.projectFolder();
        LML.tag.write(comp, { kind: "legendComp", v: 1, mapId: args.mapId });

        // The background, and the swatches on top of it, both in comp coordinates.
        var back = comp.layers.addShape();
        back.name = "Background";
        back.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        back.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
        var backContents = back.property("ADBE Root Vectors Group");
        LML.legend.rectGroup(backContents, {
            label: "Panel",
            color: args.background.color,
            swatch: { x: 0, y: 0, width: comp.width, height: comp.height },
            radius: args.background.radius || 0
        });
        var backFill = backContents.property(1).property("ADBE Vectors Group").property("ADBE Vector Graphic - Fill");
        backFill.property("ADBE Vector Fill Opacity").setValue(args.background.opacity);
        if (args.border && args.border.width > 0) {
            var stroke = backContents.property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue(args.border.color);
            stroke.property("ADBE Vector Stroke Width").setValue(args.border.width);
        }

        var swatches = comp.layers.addShape();
        swatches.name = "Swatches";
        swatches.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        swatches.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
        var swatchContents = swatches.property("ADBE Root Vectors Group");
        var i;
        for (i = 0; i < args.rows.length; i++) {
            LML.legend.rectGroup(swatchContents, {
                label: args.rows[i].label,
                color: args.rows[i].color,
                swatch: args.rows[i].swatch,
                radius: args.rows[i].radius || 0
            });
        }

        var font = LML.labels.pickFont(args.fonts || []);
        var style = { color: args.textColor, haloColor: args.textColor, haloWidth: 0, tracking: 0, rtl: false, font: font, justify: "left" };
        for (i = args.rows.length - 1; i >= 0; i--) {
            var row = args.rows[i];
            var text = comp.layers.addText(row.label);
            text.name = "Step: " + row.label;
            style.size = row.size;
            LML.labels.styleText(text, style);
            text.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            text.property("ADBE Transform Group").property("ADBE Position").setValue([row.text.x, row.text.y]);
        }
        if (args.title && args.title.text) {
            var title = comp.layers.addText(args.title.text);
            title.name = "Title";
            style.size = args.title.size;
            LML.labels.styleText(title, style);
            title.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            title.property("ADBE Transform Group").property("ADBE Position").setValue([args.title.x, args.title.y]);
            title.moveToBeginning();
        }

        var layer = scene.layers.add(comp);
        layer.name = args.name;
        layer.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([args.position[0], args.position[1]]);
        LML.tag.write(layer, { kind: "legend", v: 1, mapId: args.mapId });
        return { name: layer.name, comp: comp.name, index: layer.index, removed: removed, rows: args.rows.length };
    } finally {
        app.endUndoGroup();
    }
};

/** Takes the legend off the map again. args: { mapId } */
LML.api.removeLegend = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Remove legend");
    try {
        return { removed: LML.legend.removeTagged(scene, args.mapId) };
    } finally {
        app.endUndoGroup();
    }
};
