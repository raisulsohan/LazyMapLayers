/*
 * A chart of numbers over the years: a line per place (or an area under it) that stands at the year
 * the map shows. The lines, their dots and their numbers are expressions of the precomp's own time;
 * the chart's layer in the scene is time-remapped by the map's Data Time slider through a Layer
 * Control, so the chart follows the map however that slider is keyed.
 * args: { mapId, name, width, height, position, background{color,opacity,radius}, border{color,width},
 *   title{text,x,y,size}|null, textColor, mutedColor, fonts, textSize, padding, plot{x,y,width,height},
 *   baseline, xTicks: [{ x, text }], yTicks: [{ y, text }], area,
 *   lines: [{ label, color, expressions: { path, head, value } }], remap }
 */
LML.api.addLineChart = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    if (!LML.map.controlValueProperty(mapLayer, "Data Time")) throw LML.util.error("NO_SERIES", "This map has no Data Time slider: colour it by a table with years first");
    app.beginUndoGroup("LazyMapLayers: Chart");
    try {
        var removed = LML.chart.removeTagged(scene, args.mapId);
        var comp = app.project.items.addComp(LML.map.uniqueCompName(args.name), Math.max(4, Math.round(args.width)), Math.max(4, Math.round(args.height)), 1, scene.duration, scene.frameRate);
        comp.parentFolder = LML.map.projectFolder();
        LML.tag.write(comp, { kind: "chartComp", v: 1, mapId: args.mapId });
        var errors = [];
        var i;

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

        // The grid: a thin line at every value tick, the baseline a little stronger.
        var grid = comp.layers.addShape();
        grid.name = "Grid";
        grid.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        grid.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
        var gridContents = grid.property("ADBE Root Vectors Group");
        for (i = 0; i < args.yTicks.length; i++) {
            var tickGroup = gridContents.addProperty("ADBE Vector Group");
            tickGroup.name = "Line at " + args.yTicks[i].text;
            var tickInside = tickGroup.property("ADBE Vectors Group");
            var tickShape = new Shape();
            tickShape.vertices = [[args.plot.x, args.yTicks[i].y], [args.plot.x + args.plot.width, args.yTicks[i].y]];
            tickShape.closed = false;
            tickInside.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(tickShape);
            var tickStroke = tickInside.addProperty("ADBE Vector Graphic - Stroke");
            tickStroke.property("ADBE Vector Stroke Color").setValue(args.mutedColor);
            tickStroke.property("ADBE Vector Stroke Width").setValue(i === 0 ? Math.max(1, args.textSize / 10) : Math.max(1, args.textSize / 20));
            tickStroke.property("ADBE Vector Stroke Opacity").setValue(i === 0 ? 70 : 30);
        }

        var font = LML.labels.pickFont(args.fonts || []);
        var muted = { color: args.mutedColor, haloColor: args.mutedColor, haloWidth: 0, tracking: 0, rtl: false, font: font, justify: "left", size: args.textSize };
        var addStatic = function (text, x, y, name) {
            var layer = comp.layers.addText(text);
            layer.name = name;
            LML.labels.styleText(layer, muted);
            layer.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            layer.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
            return layer;
        };
        for (i = 0; i < args.xTicks.length; i++) addStatic(args.xTicks[i].text, args.xTicks[i].x - args.textSize * 1.2, args.baseline + args.textSize * 1.4, "Year " + args.xTicks[i].text);
        for (i = 0; i < args.yTicks.length; i++) addStatic(args.yTicks[i].text, args.padding, args.yTicks[i].y + args.textSize * 0.35, "Value " + args.yTicks[i].text);

        // Lines: the smallest made first, so the largest ends on top. Areas the other way round: the
        // largest at the bottom, so the smaller areas stay in sight on top of it.
        for (var n = 0; n < args.lines.length; n++) {
            i = args.area ? n : args.lines.length - 1 - n;
            var spec = args.lines[i];
            var line = comp.layers.addShape();
            line.name = "Line: " + spec.label;
            line.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            line.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
            var contents = line.property("ADBE Root Vectors Group");
            var body = contents.addProperty("ADBE Vector Group");
            body.name = args.area ? "Area" : "Line";
            var bodyInside = body.property("ADBE Vectors Group");
            var path = bodyInside.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape");
            LML.pins.setExpression(path, spec.expressions.path, errors, spec.label + " line", i === 0);
            if (args.area) {
                var areaFill = bodyInside.addProperty("ADBE Vector Graphic - Fill");
                areaFill.property("ADBE Vector Fill Color").setValue(spec.color);
                areaFill.property("ADBE Vector Fill Opacity").setValue(28);
            }
            var stroke = bodyInside.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue(spec.color);
            stroke.property("ADBE Vector Stroke Width").setValue(Math.max(1, args.textSize / 6));
            stroke.property("ADBE Vector Stroke Line Join").setValue(2);
            stroke.property("ADBE Vector Stroke Line Cap").setValue(2);
            // The dot that rides the head of the line.
            var dot = contents.addProperty("ADBE Vector Group");
            dot.name = "Head";
            var dotInside = dot.property("ADBE Vectors Group");
            var ellipse = dotInside.addProperty("ADBE Vector Shape - Ellipse");
            var radius = Math.max(2, args.textSize / 3.2);
            ellipse.property("ADBE Vector Ellipse Size").setValue([radius * 2, radius * 2]);
            LML.pins.setExpression(ellipse.property("ADBE Vector Ellipse Position"), spec.expressions.head, errors, spec.label + " head", false);
            dotInside.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(spec.color);
            // The name and the number, beside the dot.
            var label = comp.layers.addText(spec.label);
            label.name = "Value: " + spec.label;
            LML.labels.styleText(label, { color: args.textColor, haloColor: args.textColor, haloWidth: 0, tracking: 0, rtl: false, font: font, justify: "left", size: args.textSize });
            label.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            LML.pins.setExpression(label.property("ADBE Text Properties").property("ADBE Text Document"), spec.expressions.value, errors, spec.label + " number", false);
            LML.pins.setExpression(label.property("ADBE Transform Group").property("ADBE Position"), spec.expressions.label, errors, spec.label + " number position", false);
        }
        if (args.title && args.title.text) {
            var title = comp.layers.addText(args.title.text);
            title.name = "Title";
            LML.labels.styleText(title, { color: args.textColor, haloColor: args.textColor, haloWidth: 0, tracking: 0, rtl: false, font: font, justify: "left", size: args.title.size });
            title.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
            title.property("ADBE Transform Group").property("ADBE Position").setValue([args.title.x, args.title.y]);
            title.moveToBeginning();
        }

        var chart = scene.layers.add(comp);
        chart.name = args.name;
        chart.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        chart.property("ADBE Transform Group").property("ADBE Position").setValue([args.position[0], args.position[1]]);
        var link = chart.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
        link.name = "Map";
        link.property(1).setValue(mapLayer.index);
        chart.timeRemapEnabled = true;
        LML.pins.setExpression(chart.property("ADBE Time Remapping"), args.remap, errors, "chart time", true);
        LML.tag.write(chart, { kind: "chart", v: 1, mapId: args.mapId, lines: true });
        return { name: chart.name, comp: comp.name, index: chart.index, removed: removed, lines: args.lines.length, expressionErrors: errors };
    } finally {
        app.endUndoGroup();
    }
};
