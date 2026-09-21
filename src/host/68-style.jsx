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

/** args: { mapId } - reads the style of the first selected layer that has one. */
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

/**
 * The style of the selected text layer, for the label template: its colour, size, halo and font.
 * args: { mapId }
 */
LML.api.readLabelStyle = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var selected = scene.selectedLayers;
    for (var i = 0; i < selected.length; i++) {
        var layer = selected[i];
        var properties = layer.property("ADBE Text Properties");
        if (!properties) continue;
        var doc = properties.property("ADBE Text Document").value;
        var toPanel = 1080 / scene.height;
        var found = {
            from: layer.name,
            color: doc.applyFill && doc.fillColor ? LML.style.hex(doc.fillColor) : null,
            size: Math.round(doc.fontSize * toPanel * 10) / 10,
            haloColor: doc.applyStroke && doc.strokeColor ? LML.style.hex(doc.strokeColor) : null,
            halo: doc.applyStroke ? Math.round(doc.strokeWidth * toPanel * 10) / 10 : 0,
            font: doc.font,
            caps: null
        };
        // All-caps is not in every version of the text document.
        try {
            if (doc.fontCapsOption !== undefined) found.caps = doc.fontCapsOption === FontCapsOption.FONT_ALL_CAPS;
        } catch (e) {
            found.caps = null;
        }
        return found;
    }
    throw LML.util.error("NO_TEXT_LAYER", "Select a text layer in " + scene.name + " first");
};

/** A point in a layer's own space, moved into the comp it sits in (2D transform, parents included). */
LML.style.throughTransform = function (point, layer, time) {
    var transform = layer.property("ADBE Transform Group");
    var anchor = transform.property("ADBE Anchor Point").valueAtTime(time, false);
    var position = transform.property("ADBE Position").valueAtTime(time, false);
    var scale = transform.property("ADBE Scale").valueAtTime(time, false);
    var rotation = 0;
    try {
        rotation = transform.property("ADBE Rotate Z").valueAtTime(time, false);
    } catch (eR) {
        rotation = 0;
    }
    var radians = (rotation * Math.PI) / 180;
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    var x = (point[0] - anchor[0]) * (scale[0] / 100);
    var y = (point[1] - anchor[1]) * (scale[1] / 100);
    return [position[0] + x * cos - y * sin, position[1] + x * sin + y * cos];
};

/** The other way round: a point in a comp, moved into a layer's own space. */
LML.style.intoLayer = function (point, layer, time) {
    var transform = layer.property("ADBE Transform Group");
    var anchor = transform.property("ADBE Anchor Point").valueAtTime(time, false);
    var position = transform.property("ADBE Position").valueAtTime(time, false);
    var scale = transform.property("ADBE Scale").valueAtTime(time, false);
    var rotation = 0;
    try {
        rotation = transform.property("ADBE Rotate Z").valueAtTime(time, false);
    } catch (eR) {
        rotation = 0;
    }
    var radians = (-rotation * Math.PI) / 180;
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    var dx = point[0] - position[0];
    var dy = point[1] - position[1];
    var x = dx * cos - dy * sin;
    var y = dx * sin + dy * cos;
    return [x / (scale[0] / 100 || 1) + anchor[0], y / (scale[1] / 100 || 1) + anchor[1]];
};

/**
 * The bounds of the selected layers as fractions of the map frame, with the seconds they are on
 * screen, for the keep-out zones. args: { mapId }
 */
LML.api.readLayerBounds = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var mapComp = mapLayer.source;
    var selected = scene.selectedLayers;
    var out = [];
    for (var i = 0; i < selected.length; i++) {
        var layer = selected[i];
        if (layer === mapLayer || !layer.sourceRectAtTime) continue;
        var start = Math.max(layer.inPoint, 0);
        var end = Math.min(layer.outPoint, scene.duration);
        if (end <= start) continue;
        // Halfway through, so a layer that animates is measured where it has settled.
        var time = (start + end) / 2;
        var rect = null;
        try {
            rect = layer.sourceRectAtTime(time, false);
        } catch (eRect) {
            rect = null;
        }
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        var corners = [
            [rect.left, rect.top],
            [rect.left + rect.width, rect.top],
            [rect.left, rect.top + rect.height],
            [rect.left + rect.width, rect.top + rect.height]
        ];
        var left = null;
        var top = null;
        var right = null;
        var bottom = null;
        for (var c = 0; c < corners.length; c++) {
            var point = LML.style.throughTransform(corners[c], layer, time);
            var owner = layer.parent;
            while (owner) {
                point = LML.style.throughTransform(point, owner, time);
                owner = owner.parent;
            }
            point = LML.style.intoLayer(point, mapLayer, time);
            if (left === null || point[0] < left) left = point[0];
            if (right === null || point[0] > right) right = point[0];
            if (top === null || point[1] < top) top = point[1];
            if (bottom === null || point[1] > bottom) bottom = point[1];
        }
        var x = left / mapComp.width;
        var y = top / mapComp.height;
        var width = (right - left) / mapComp.width;
        var height = (bottom - top) / mapComp.height;
        // Clip to the frame; a layer entirely outside it holds nothing back.
        if (x + width <= 0 || y + height <= 0 || x >= 1 || y >= 1) continue;
        if (x < 0) {
            width = width + x;
            x = 0;
        }
        if (y < 0) {
            height = height + y;
            y = 0;
        }
        var whole = start <= 0.0001 && end >= scene.duration - 0.0001;
        out.push({
            id: "layer:" + layer.index + ":" + layer.name,
            name: layer.name,
            x: x,
            y: y,
            width: Math.min(width, 1 - x),
            height: Math.min(height, 1 - y),
            from: whole ? null : start,
            to: whole ? null : end
        });
    }
    if (!out.length) throw LML.util.error("NO_LAYER_BOUNDS", "Select the layers the names must keep away from in " + scene.name + " first");
    return out;
};
