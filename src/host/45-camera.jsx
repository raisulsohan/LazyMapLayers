/*
 * 3D camera rig matched to the rendered map, and 3D pins on its ground plane.
 * The panel sends the expressions (generated in src/core/ae/cameraRig.ts) and the ground origin;
 * the host only builds layers, effects and links. Everything reads the map layer's controls through
 * a Layer Control effect named "Map", so the rig follows every keyframe of the map view.
 */
LML.camera = LML.camera || {};

LML.camera.ORIGIN_LAT = "3D Origin Latitude";
LML.camera.ORIGIN_LNG = "3D Origin Longitude";
LML.camera.REFERENCE_ZOOM = "3D Reference Zoom";

/** Tagged rig layers of a map in its scene comp: { camera, target } (either may be null). */
LML.camera.findRig = function (mapLayer) {
    var scene = mapLayer.containingComp;
    var mapId = LML.tag.read(mapLayer).mapId;
    var rig = { camera: null, target: null };
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.mapId !== mapId) continue;
        if (tag.kind === "camera") rig.camera = layer;
        if (tag.kind === "cameraTarget") rig.target = layer;
    }
    return rig;
};

LML.camera.hasGroundFrame = function (mapLayer) {
    return !!mapLayer.property("ADBE Effect Parade").property(LML.camera.REFERENCE_ZOOM);
};

/** Why the camera may not match: the map layer must stay centred, unrotated and uniformly scaled. */
LML.camera.mapLayerWarnings = function (mapLayer) {
    var warnings = [];
    var scene = mapLayer.containingComp;
    var t = mapLayer.property("ADBE Transform Group");
    var position = t.property("ADBE Position").value;
    var anchor = t.property("ADBE Anchor Point").value;
    var scale = t.property("ADBE Scale").value;
    var source = mapLayer.source;
    var near = function (a, b) {
        return Math.abs(a - b) < 0.01;
    };
    if (LML.map.projectionOf(mapLayer) === "globe") warnings.push("The map uses the globe projection; the 3D camera matches it only from zoom 12, where the globe becomes a flat map.");
    if (mapLayer.threeDLayer) warnings.push("The map layer is a 3D layer; keep it 2D so the camera does not move it.");
    if (!near(position[0], scene.width / 2) || !near(position[1], scene.height / 2) || !near(anchor[0], source.width / 2) || !near(anchor[1], source.height / 2)) {
        warnings.push("The map layer is not centred in the scene; the 3D camera only matches a centred map.");
    }
    if (!near(scale[0], scale[1])) warnings.push("The map layer is not scaled uniformly; the 3D camera only matches a uniform scale.");
    if (!near(t.property("ADBE Rotate Z").value, 0)) warnings.push("The map layer is rotated; use the Bearing control instead.");
    return warnings;
};

LML.camera.describe = function (mapLayer, rig, created, errors) {
    var effects = mapLayer.property("ADBE Effect Parade");
    return {
        created: created,
        cameraName: rig.camera.name,
        targetName: rig.target.name,
        referenceZoom: effects.property(LML.camera.REFERENCE_ZOOM).property(1).value,
        expressionErrors: errors || [],
        warnings: LML.camera.mapLayerWarnings(mapLayer)
    };
};

/** args: { mapId, originLat, originLng, referenceZoom, expressions: CameraRigExpressions } */
LML.camera.addCameraRig = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var scene = mapLayer.containingComp;
    var rig = LML.camera.findRig(mapLayer);
    if (rig.camera && rig.target) return LML.camera.describe(mapLayer, rig, false);
    // A half-deleted rig is rebuilt from scratch (only our tagged layers are touched).
    if (rig.camera) rig.camera.remove();
    if (rig.target) rig.target.remove();

    if (!LML.camera.hasGroundFrame(mapLayer)) {
        LML.pins.addEffect(mapLayer, "ADBE Slider Control", LML.camera.ORIGIN_LAT, args.originLat);
        LML.pins.addEffect(mapLayer, "ADBE Slider Control", LML.camera.ORIGIN_LNG, args.originLng);
        LML.pins.addEffect(mapLayer, "ADBE Slider Control", LML.camera.REFERENCE_ZOOM, args.referenceZoom);
    }

    var errors = [];
    var target = scene.layers.addNull();
    target.name = "Map Camera Target";
    target.threeDLayer = true;
    var tt = target.property("ADBE Transform Group");
    tt.property("ADBE Anchor Point").setValue([0, 0, 0]);
    var link = LML.pins.addEffect(target, "ADBE Layer Control", "Map");
    link.property(1).setValue(mapLayer.index);
    LML.pins.setExpression(tt.property("ADBE Position"), args.expressions.targetPosition, errors, "target position");
    LML.pins.setExpression(tt.property("ADBE Rotate Z"), args.expressions.targetRotationZ, errors, "target rotation");
    LML.tag.write(target, { kind: "cameraTarget", v: 1, mapId: args.mapId });

    var camera = scene.layers.addCamera("Map Camera", [scene.width / 2, scene.height / 2]);
    camera.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
    // No jump: the camera keeps plain local values, which the expressions then drive.
    camera.setParentWithJump(target);
    var ct = camera.property("ADBE Transform Group");
    ct.property("ADBE Orientation").setValue([0, 0, 0]);
    ct.property("ADBE Rotate Y").setValue(0);
    ct.property("ADBE Rotate Z").setValue(0);
    LML.pins.setExpression(ct.property("ADBE Position"), args.expressions.cameraPosition, errors, "camera position");
    LML.pins.setExpression(ct.property("ADBE Rotate X"), args.expressions.cameraRotationX, errors, "camera tilt");
    LML.pins.setExpression(camera.property("ADBE Camera Options Group").property("ADBE Camera Zoom"), args.expressions.cameraZoom, errors, "camera zoom");
    LML.tag.write(camera, { kind: "camera", v: 1, mapId: args.mapId });

    target.moveToBeginning();
    camera.moveToBeginning();
    return LML.camera.describe(mapLayer, { camera: camera, target: target }, true, errors);
};
