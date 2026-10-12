/*
 * The Self-test's part in After Effects (DECISIONS D104). One call, inside one undo group: a map comp
 * made by the code New map uses, the panel's rendered frame imported into it and sampled by After
 * Effects, the matched 3D camera, a pin and a 3D pin read where they stand; then every item the call
 * made is removed and the comp that was open is opened again. The panel judges the numbers (core
 * support/selfTest.ts); this file only builds, reads and cleans up.
 */
LML.selfTest = LML.selfTest || {};

LML.selfTest.UNDO = "Self-test";

/** The ids of every item in the project, as a set (object keys). */
LML.selfTest.itemIds = function () {
    var ids = {};
    for (var i = 1; i <= app.project.numItems; i++) ids[String(app.project.item(i).id)] = true;
    return ids;
};

/** Removes every item whose id is not in `before`: comps and footage first, then the folders they were in. */
LML.selfTest.removeNew = function (before) {
    var items = [];
    var folders = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (before[String(item.id)]) continue;
        if (item instanceof FolderItem) folders.push(item);
        else items.push(item);
    }
    for (var a = 0; a < items.length; a++) {
        try {
            items[a].remove();
        } catch (e) {
            // Left over; the caller lists what is still there.
        }
    }
    for (var f = folders.length - 1; f >= 0; f--) {
        try {
            if (folders[f].numItems === 0) folders[f].remove();
        } catch (e2) {
            // Left over; the caller lists what is still there.
        }
    }
};

/** The names of items made since `before`. */
LML.selfTest.newNames = function (before) {
    var names = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!before[String(item.id)]) names.push(item.name);
    }
    return names;
};

LML.selfTest.effectNames = function (layer) {
    var fx = layer.property("ADBE Effect Parade");
    var names = [];
    for (var i = 1; i <= fx.numProperties; i++) names.push(fx.property(i).name);
    return names;
};

LML.selfTest.read = function (prop, time) {
    var value = prop.valueAtTime(time, false);
    var out = [];
    for (var i = 0; i < value.length; i++) out.push(value[i]);
    return out;
};

/** Builds, reads and removes; args come from the panel's selfTest.ts (view, size, frame, spot, rig, pin). */
LML.selfTest.build = function (args, out) {
    var made = LML.map.createMapComp({
        name: "LazyMapLayers Self-test",
        width: args.width,
        height: args.height,
        duration: 1,
        frameRate: 25,
        view: args.view,
        newScene: true
    });
    var mapLayer = LML.pins.findMapLayer(made.id);
    var scene = mapLayer.containingComp;
    var mapComp = mapLayer.source;
    scene.time = 0;
    out.made = { mapCompName: made.mapCompName, controls: LML.selfTest.effectNames(mapLayer), footage: null };

    // The rendered frame, imported and placed in the map comp as a render's pass would be.
    var file = new File(args.framePath);
    if (!file.exists) throw LML.util.error("FILE_NOT_FOUND", "The rendered frame is missing: " + args.framePath);
    var options = new ImportOptions(file);
    options.sequence = false;
    var footage = app.project.importFile(options);
    LML.tag.write(footage, { kind: "selfTest", v: 1 });
    footage.parentFolder = mapComp.parentFolder;
    var frameLayer = mapComp.layers.add(footage);
    LML.tag.write(frameLayer, { kind: "selfTest", v: 1 });
    out.made.footage = { width: footage.width, height: footage.height };

    // The 3D camera and two pins, by the code the panel's buttons use.
    LML.camera.addCameraRig({ mapId: made.id, originLat: args.rig.originLat, originLng: args.rig.originLng, referenceZoom: args.rig.referenceZoom, expressions: args.rig.expressions });
    var pin = LML.pins.addPin({ mapId: made.id, lat: args.pin.lat, lng: args.pin.lng, name: "Self-test", expressions: args.pin.expressions });
    var pin3d = LML.pins.addPin({ mapId: made.id, lat: args.pin.lat, lng: args.pin.lng, name: "Self-test", threeD: true, altitude: 0, expressions: { position: args.pin.position3d } });
    var errors = pin.expressionErrors.concat(pin3d.expressionErrors);
    var pinLayer = scene.layer(pin.name);
    var pin3dLayer = scene.layer(pin3d.name);

    // Where After Effects' camera shows the 3D pin, and what it draws at the flat spot of the frame.
    // Both probes are written for either expression engine (ES3, no const).
    var probe = pin3dLayer.property("ADBE Effect Parade").addProperty("ADBE Point Control");
    probe.name = "Self-test Probe";
    LML.pins.setExpression(probe.property(1), "var p = toComp([0, 0, 0]); [p[0], p[1]];", errors, "3D pin probe");
    var sample = pinLayer.property("ADBE Effect Parade").addProperty("ADBE Color Control");
    sample.name = "Self-test Sample";
    LML.pins.setExpression(sample.property(1), "effect(\"Map\")(1).sampleImage([" + args.spot.x + " + 0.5, " + args.spot.y + " + 0.5], [0.5, 0.5], true, 0);", errors, "frame sample");

    out.pin = LML.selfTest.read(pinLayer.property("ADBE Transform Group").property("ADBE Position"), 0);
    out.pin3d = LML.selfTest.read(probe.property(1), 0);
    out.sample = LML.selfTest.read(sample.property(1), 0);
    out.errors = errors;
};

LML.selfTest.run = function (args) {
    var before = LML.selfTest.itemIds();
    var active = app.project.activeItem;
    var out = { undoGroup: "LazyMapLayers: " + LML.selfTest.UNDO, error: null, made: null, pin: null, pin3d: null, sample: null, errors: [], leftover: [] };
    try {
        out.workingSpace = app.project.workingSpace || "";
    } catch (e) {
        out.workingSpace = "";
    }
    app.beginUndoGroup(out.undoGroup);
    try {
        try {
            LML.selfTest.build(args, out);
        } catch (e2) {
            out.error = (e2 && e2.message ? e2.message : String(e2)) + (e2 && e2.line ? " (line " + e2.line + ")" : "");
        } finally {
            LML.selfTest.removeNew(before);
        }
    } finally {
        app.endUndoGroup();
    }
    out.leftover = LML.selfTest.newNames(before);
    try {
        if (active instanceof CompItem) active.openInViewer();
    } catch (e3) {
        // No viewer in -noui mode.
    }
    return out;
};
