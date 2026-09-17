/*
 * Basemap sequences: the panel renders one image per map comp frame; the host samples the camera
 * for every frame and imports or replaces the rendered sequence inside the map comp.
 */
LML.basemap = LML.basemap || {};

/** Camera values for every frame of the map comp, read from the map layer's controls. */
LML.basemap.sampleViews = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var mapComp = mapLayer.source;
    var fps = mapComp.frameRate;
    var frames = Math.max(1, Math.round(mapComp.duration * fps));
    var first = args.firstFrame || 0;
    var last = Math.min(frames - 1, args.lastFrame === undefined ? frames - 1 : args.lastFrame);
    var views = [];
    for (var f = first; f <= last; f++) {
        // The controls sit on the layer in the scene comp: map comp time t is scene time t + startTime.
        var sceneTime = mapLayer.startTime + f / fps;
        views.push(LML.map.readViewAtTime(mapLayer, sceneTime));
    }
    return {
        mapCompName: mapComp.name,
        width: mapComp.width,
        height: mapComp.height,
        frameRate: fps,
        frames: frames,
        firstFrame: first,
        views: views,
        projectFolder: app.project.file ? app.project.file.parent.fsName : null
    };
};

LML.basemap.findBasemapLayer = function (mapComp) {
    for (var i = 1; i <= mapComp.numLayers; i++) {
        if (LML.tag.is(mapComp.layer(i), "basemap")) return mapComp.layer(i);
    }
    return null;
};

/** Imports (or swaps in) a rendered PNG sequence as the bottom layer of the map comp. */
LML.basemap.importSequence = function (args) {
    var mapLayer = LML.pins.findMapLayer(args.mapId);
    var mapComp = mapLayer.source;
    var first = new File(args.firstFramePath);
    if (!first.exists) throw LML.util.error("FILE_NOT_FOUND", "Rendered frame not found: " + args.firstFramePath);

    var existing = LML.basemap.findBasemapLayer(mapComp);
    var footage;
    if (existing && existing.source instanceof FootageItem) {
        footage = existing.source;
        footage.replaceWithSequence(first, true);
    } else {
        var options = new ImportOptions(first);
        options.sequence = true;
        options.forceAlphabetical = true;
        footage = app.project.importFile(options);
        footage.parentFolder = LML.map.projectFolder();
        LML.tag.write(footage, { kind: "basemapFootage", v: 1, mapId: args.mapId });
    }
    footage.mainSource.conformFrameRate = mapComp.frameRate;
    footage.name = mapComp.name + " basemap";

    var layer = existing;
    if (!layer) {
        layer = mapComp.layers.add(footage);
        layer.moveToEnd();
        LML.tag.write(layer, { kind: "basemap", v: 1, mapId: args.mapId, pass: args.pass || "base" });
    }
    layer.startTime = 0;
    // Frames rendered below comp resolution (proxies) are scaled up to fill the comp.
    var scale = 100 * mapComp.width / footage.width;
    layer.property("ADBE Transform Group").property("ADBE Scale").setValue([scale, scale]);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([mapComp.width / 2, mapComp.height / 2]);
    layer.locked = true;
    return { layerIndex: layer.index, footageId: footage.id, width: footage.width, height: footage.height, duration: footage.duration };
};
