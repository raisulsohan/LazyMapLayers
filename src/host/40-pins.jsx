/*
 * Pinned layers: shape layers that stay on a geographic position of a map.
 * The panel sends the expressions (generated in src/core/ae/pinExpressions.ts); the host only
 * builds layers, effects and links. The link to the map is a Layer Control effect, so renaming the
 * map layer or its comp does not break it.
 */
LML.pins = LML.pins || {};

LML.pins.findMapLayer = function (mapId) {
    var layers = LML.map.findMapLayers();
    for (var i = 0; i < layers.length; i++) {
        if (LML.tag.read(layers[i]).mapId === mapId) return layers[i];
    }
    throw LML.util.error("MAP_NOT_FOUND", "No map layer with id " + mapId);
};

LML.pins.addEffect = function (layer, matchName, name, value) {
    var effect = layer.property("ADBE Effect Parade").addProperty(matchName);
    effect.name = name;
    if (value !== undefined) effect.property(1).setValue(value);
    return effect;
};

/**
 * Sets an expression and reports its error. Reading the error makes After Effects evaluate the
 * expression, which costs several milliseconds: callers that set the same generated expression on
 * many layers pass check = false after the first one.
 */
LML.pins.setExpression = function (prop, code, errors, label, check) {
    prop.expression = code;
    if (check === false) return;
    var problem = "";
    try {
        problem = prop.expressionError;
    } catch (e) {
        problem = "";
    }
    if (problem) errors.push(label + ": " + problem);
};

LML.pins.addPin = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    if (args.threeD && !LML.camera.hasGroundFrame(mapLayer)) {
        throw LML.util.error("NO_3D_CAMERA", "Add the 3D camera to this map before adding 3D pins");
    }
    var style = args.style || {};
    var radius = style.radius || 14;
    var color = style.color || [0.21, 0.7, 1];

    var layer = scene.layers.addShape();
    layer.name = (args.threeD ? "3D Pin" : "Pin") + (args.name ? ": " + args.name : "");
    layer.moveBefore(mapLayer);
    if (args.threeD) layer.threeDLayer = true;

    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    group.name = "Marker";
    var contents = group.property("ADBE Vectors Group");
    var ellipse = contents.addProperty("ADBE Vector Shape - Ellipse");
    ellipse.property("ADBE Vector Ellipse Size").setValue([radius * 2, radius * 2]);
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue(style.strokeColor || [1, 1, 1]);
    stroke.property("ADBE Vector Stroke Width").setValue(style.strokeWidth || Math.max(2, radius / 4));
    if (style.fill !== false) {
        var fill = contents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(color);
    }

    var mapLink = LML.pins.addEffect(layer, "ADBE Layer Control", "Map");
    mapLink.property(1).setValue(mapLayer.index);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Latitude", args.lat);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Longitude", args.lng);
    var transform = layer.property("ADBE Transform Group");
    var errors = [];
    if (args.threeD) {
        // On the ground plane the camera already scales and rotates the pin with the map.
        LML.pins.addEffect(layer, "ADBE Slider Control", "Altitude (m)", args.altitude || 0);
        LML.pins.setExpression(transform.property("ADBE Position"), args.expressions.position, errors, "position");
        LML.tag.write(layer, { kind: "pin", v: 1, mapId: args.mapId, threeD: true });
        return { layerIndex: layer.index, name: layer.name, sceneCompId: scene.id, expressionErrors: errors };
    }
    LML.pins.addEffect(layer, "ADBE Checkbox Control", "Scale with Map", args.scaleWithMap ? 1 : 0);
    LML.pins.addEffect(layer, "ADBE Checkbox Control", "Rotate with Map", args.rotateWithMap ? 1 : 0);
    var view = LML.map.readViewAtTime(mapLayer, scene.time);
    LML.pins.addEffect(layer, "ADBE Slider Control", "Reference Zoom", view.zoom);

    LML.pins.setExpression(transform.property("ADBE Position"), args.expressions.position, errors, "position");
    LML.pins.setExpression(transform.property("ADBE Scale"), args.expressions.scale, errors, "scale");
    LML.pins.setExpression(transform.property("ADBE Rotate Z"), args.expressions.rotation, errors, "rotation");
    LML.pins.setExpression(transform.property("ADBE Opacity"), args.expressions.opacity, errors, "opacity");

    LML.tag.write(layer, { kind: "pin", v: 1, mapId: args.mapId });
    return { layerIndex: layer.index, name: layer.name, sceneCompId: scene.id, expressionErrors: errors };
};
