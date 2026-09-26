/*
 * The year a map of numbers over time shows: a text layer that counts with the "Data Time" slider on
 * the map layer. It reads the slider through a Layer Control, so renaming the map layer never breaks
 * it, and it is an ordinary text layer to move, restyle or animate.
 */
LML.dataYear = LML.dataYear || {};

LML.dataYear.removeTagged = function (scene, mapId) {
    var removed = 0;
    for (var i = scene.numLayers; i >= 1; i--) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "dataYear" || tag.mapId !== mapId) continue;
        layer.remove();
        removed++;
    }
    return removed;
};

/** The Source Text expression: the slider's whole year, as text. */
LML.dataYear.EXPRESSION = [
    "// LazyMapLayers data year (generated)",
    "var m = effect(\"Map\")(1);",
    "var t = m.effect(\"Data Time\")(1).value;",
    "String(Math.floor(t + 0.0001));"
].join("\n");

/**
 * args: { mapId, corner: "bottomLeft" | "bottomRight" | "topLeft" | "topRight", fonts: [PostScript names],
 *         color: [r, g, b], haloColor: [r, g, b], halo }
 */
LML.api.addDataYear = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    if (!LML.map.controlValueProperty(mapLayer, "Data Time")) throw LML.util.error("NO_SERIES", "This map has no Data Time slider: colour it by a table with years first");
    return LML.withUndo("Data year", function () {
        LML.dataYear.removeTagged(scene, args.mapId);
        var scale = scene.height / 1080;
        var layer = scene.layers.addText("2000");
        layer.name = "Year";
        LML.labels.styleText(layer, {
            size: Math.round(72 * scale),
            color: args.color,
            haloColor: args.haloColor,
            haloWidth: args.halo > 0 ? Math.max(1, Math.round(args.halo * 1.5 * scale)) : 0,
            font: LML.labels.pickFont(args.fonts || []),
            tracking: 20,
            justify: "left"
        });
        var margin = Math.round(60 * scale);
        var right = args.corner === "bottomRight" || args.corner === "topRight";
        var top = args.corner === "topLeft" || args.corner === "topRight";
        var textWidth = Math.round(72 * scale * 2.6);
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([right ? scene.width - margin - textWidth : margin, top ? margin + Math.round(72 * scale) : scene.height - margin]);
        var link = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
        link.name = "Map";
        link.property(1).setValue(mapLayer.index);
        var errors = [];
        LML.pins.setExpression(layer.property("ADBE Text Properties").property("ADBE Text Document"), LML.dataYear.EXPRESSION, errors, "year", true);
        layer.moveToBeginning();
        LML.tag.write(layer, { kind: "dataYear", v: 1, mapId: args.mapId });
        return { name: layer.name, expressionErrors: errors };
    });
};

/** Takes the year off the scene. args: { mapId } */
LML.api.removeDataYear = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Remove data year", function () {
        return { removed: LML.dataYear.removeTagged(mapLayer.containingComp, args.mapId) };
    });
};
