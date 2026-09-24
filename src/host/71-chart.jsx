/*
 * A chart of the numbers on a map: one bar per place in a precomp of its own, each growing from
 * nothing in its turn. It is an ordinary precomp in the scene, like the legend: move it, restyle it,
 * animate it.
 */
LML.chart = LML.chart || {};

LML.chart.removeTagged = function (scene, mapId) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "chart" || tag.mapId !== mapId) continue;
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

/**
 * A chart of a map's numbers, as a precomp in the scene: one bar per place, each growing from
 * nothing in its turn, with its name and its number beside it. args: {
 *   mapId, name, width, height, position, background{color,opacity,radius}, border{color,width},
 *   title{text,x,y,size}|null, textColor, fonts, rowSize,
 *   bars: [{ label, valueText, color, bar:{x,y,width,height}, labelAt, valueAt, from, to }], frameRate }
 */
LML.api.addChart = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    app.beginUndoGroup("LazyMapLayers: Chart");
    try {
        var removed = LML.chart.removeTagged(scene, args.mapId);
        var comp = app.project.items.addComp(LML.map.uniqueCompName(args.name), Math.max(4, Math.round(args.width)), Math.max(4, Math.round(args.height)), 1, scene.duration, scene.frameRate);
        comp.parentFolder = LML.map.projectFolder();
        LML.tag.write(comp, { kind: "chartComp", v: 1, mapId: args.mapId });

        var back = comp.layers.addShape();
        back.name = "Background";
        back.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        back.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
        var backContents = back.property("ADBE Root Vectors Group");
        LML.legend.rectGroup(backContents, { label: "Panel", color: args.background.color, swatch: { x: 0, y: 0, width: comp.width, height: comp.height }, radius: args.background.radius || 0 });
        backContents.property(1).property("ADBE Vectors Group").property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(args.background.opacity);
        if (args.border && args.border.width > 0) {
            var edge = backContents.property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            edge.property("ADBE Vector Stroke Color").setValue(args.border.color);
            edge.property("ADBE Vector Stroke Width").setValue(args.border.width);
        }

        // One shape layer holds every bar, each in its own group, so the whole chart restyles at once
        // while a single bar can still be animated.
        var bars = comp.layers.addShape();
        bars.name = "Bars";
        bars.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        bars.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
        var barContents = bars.property("ADBE Root Vectors Group");
        var fps = comp.frameRate;
        var i;
        for (i = 0; i < args.bars.length; i++) {
            var spec = args.bars[i];
            var group = barContents.addProperty("ADBE Vector Group");
            group.name = spec.label;
            var inside = group.property("ADBE Vectors Group");
            var rect = inside.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Roundness").setValue(Math.min(spec.bar.height / 2, 3 * (args.scale || 1)));
            // The bar grows from its left edge: the rectangle's width and its middle move together.
            // Every rectangle value is set before the fill is added, because adding another property
            // to the group leaves the rectangle's own handle stale.
            var size = rect.property("ADBE Vector Rect Size");
            var middle = rect.property("ADBE Vector Rect Position");
            var times = [spec.from / fps, spec.to / fps];
            size.setValuesAtTimes(times, [[0, spec.bar.height], [spec.bar.width, spec.bar.height]]);
            middle.setValuesAtTimes(times, [[spec.bar.x, spec.bar.y + spec.bar.height / 2], [spec.bar.x + spec.bar.width / 2, spec.bar.y + spec.bar.height / 2]]);
            LML.overlays.ease(size);
            LML.overlays.ease(middle);
            inside.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(spec.color);
        }

        var font = LML.labels.pickFont(args.fonts || []);
        var style = { color: args.textColor, haloColor: args.textColor, haloWidth: 0, tracking: 0, rtl: false, font: font, justify: "left", size: args.rowSize };
        for (i = args.bars.length - 1; i >= 0; i--) {
            var bar = args.bars[i];
            var name = comp.layers.addText(bar.label);
            name.name = "Name: " + bar.label;
            LML.labels.styleText(name, style);
            name.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            name.property("ADBE Transform Group").property("ADBE Position").setValue([bar.labelAt.x, bar.labelAt.y]);
            var value = comp.layers.addText(bar.valueText);
            value.name = "Value: " + bar.label;
            LML.labels.styleText(value, style);
            value.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            value.property("ADBE Transform Group").property("ADBE Position").setValue([bar.valueAt.x, bar.valueAt.y]);
            // The number arrives with its bar.
            var opacity = value.property("ADBE Transform Group").property("ADBE Opacity");
            opacity.setValuesAtTimes([Math.max(0, bar.from - 1) / fps, bar.to / fps], [0, 100]);
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
        LML.tag.write(layer, { kind: "chart", v: 1, mapId: args.mapId });
        return { name: layer.name, comp: comp.name, index: layer.index, removed: removed, bars: args.bars.length };
    } finally {
        app.endUndoGroup();
    }
};

/** Takes a map's chart off the scene (its comp stays in the project until the user removes it). */
LML.api.removeChart = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Remove the chart", function () {
        return { removed: LML.chart.removeTagged(mapLayer.containingComp, args.mapId) };
    });
};
