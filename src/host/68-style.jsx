/*
 * Picking a style up from a layer the user styled themselves: the panel asks for the colour and
 * stroke width of the selected layer, and gives the layers it generates the same look.
 */
LML.style = LML.style || {};

/** An After Effects colour ([r, g, b] from 0 to 1) as "#rrggbb". */
LML.style.hex = function (color) {
    var out = "#";
    for (var i = 0; i < 3; i++) {
        var v = Math.round(Math.max(0, Math.min(1, color[i])) * 255).toString(16);
        out += v.length < 2 ? "0" + v : v;
    }
    return out;
};

/** The first fill colour and stroke width inside a shape group (groups may hold groups). */
LML.style.fromContents = function (contents, found) {
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        if (item.matchName === "ADBE Vector Graphic - Fill" && !found.accent) {
            found.accent = LML.style.hex(item.property("ADBE Vector Fill Color").value);
        } else if (item.matchName === "ADBE Vector Graphic - Stroke") {
            if (found.stroke === null) found.stroke = item.property("ADBE Vector Stroke Width").value;
            if (!found.accent) found.accent = LML.style.hex(item.property("ADBE Vector Stroke Color").value);
        } else if (item.matchName === "ADBE Vector Group") {
            LML.style.fromContents(item.property("ADBE Vectors Group"), found);
        }
        if (found.accent && found.stroke !== null) return found;
    }
    return found;
};

/** The colour and stroke of one layer, or null when it has neither. */
LML.style.readFrom = function (layer) {
    var found = { accent: "", stroke: null, from: layer.name };
    var vectors = layer.property("ADBE Root Vectors Group");
    if (vectors) LML.style.fromContents(vectors, found);
    if (!found.accent && layer.property("ADBE Text Properties")) {
        var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
        if (doc.applyFill && doc.fillColor) found.accent = LML.style.hex(doc.fillColor);
    }
    if (!found.accent) return null;
    // A comp's own size decides what a stroke width means: the panel stores 1080-line pixels.
    if (found.stroke !== null) found.stroke = Math.round(found.stroke * (1080 / layer.containingComp.height) * 10) / 10;
    return found;
};

/** args: { mapId } — reads the style of the first selected layer that has one. */
LML.api.readLayerStyle = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var selected = scene.selectedLayers;
    for (var i = 0; i < selected.length; i++) {
        var found = LML.style.readFrom(selected[i]);
        if (found) return found;
    }
    throw LML.util.error("NO_STYLE", "Select a shape or text layer with a colour in " + scene.name + " first");
};
