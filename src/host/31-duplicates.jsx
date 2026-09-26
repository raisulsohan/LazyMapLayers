/*
 * Maps that After Effects copied.
 *
 * Duplicating a scene comp (Ctrl+D) copies its layers with their comments, so the copy's map layer
 * carries the same map id as the original and still shows the original's map comp. The panel would
 * then find only the first of the two, and a render would draw the first scene's camera into the map
 * comp both scenes show. Each copy is given its own id, its own map comp and its own footage items
 * (showing the same frames until it is rendered), and the panel's layers in its scene move to the new
 * id with it. Duplicating a map layer inside one scene is handled the same way, except that the
 * scene's other layers stay with the original: they were made for it.
 */
LML.dupes = LML.dupes || {};

/** A layer's identity across calls: its persistent id where After Effects has one. */
LML.dupes.keyOf = function (layer) {
    return typeof layer.id === "number" ? "L" + layer.id : "C" + layer.containingComp.id + ":" + layer.index;
};

/**
 * The layer the others were copied from. A map layer writes its own layer id into its tag when it is
 * made, and a copy keeps that tag on a layer with a new id; maps made before that fall back to the
 * oldest layer, which has the lowest id.
 */
LML.dupes.originalOf = function (group) {
    var i;
    for (i = 0; i < group.length; i++) {
        var tag = LML.tag.read(group[i]);
        if (typeof group[i].id === "number" && tag.layerId === group[i].id) return group[i];
    }
    var best = group[0];
    for (i = 1; i < group.length; i++) {
        var a = group[i];
        if (typeof a.id === "number" && typeof best.id === "number") {
            if (a.id < best.id) best = a;
        } else if (a.containingComp.id < best.containingComp.id) {
            best = a;
        }
    }
    return best;
};

/** Gives every pass layer of a map comp its own footage item, pointing at the same frames. */
LML.dupes.ownFootage = function (mapComp, newId, fromName) {
    var count = 0;
    for (var i = 1; i <= mapComp.numLayers; i++) {
        var layer = mapComp.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag || tag.kind !== "basemap") continue;
        tag.mapId = newId;
        var footage = layer.source instanceof FootageItem ? layer.source : null;
        var main = footage && footage.mainSource && footage.mainSource.file ? footage.mainSource.file : null;
        if (!main || !main.exists) {
            // The base layer is locked, and a locked layer's comment cannot be written.
            LML.basemap.withUnlocked(layer, function () {
                LML.tag.write(layer, tag);
            });
            continue;
        }
        var options = new ImportOptions(main);
        options.sequence = true;
        options.forceAlphabetical = true;
        var fresh = app.project.importFile(options);
        fresh.parentFolder = footage.parentFolder;
        fresh.mainSource.conformFrameRate = footage.mainSource.conformFrameRate || mapComp.frameRate;
        if (LML.basemap.hasProxy(footage) && footage.proxySource.file && footage.proxySource.file.exists) {
            fresh.setProxyWithSequence(footage.proxySource.file, true);
            fresh.proxySource.conformFrameRate = footage.proxySource.conformFrameRate || mapComp.frameRate;
            fresh.useProxy = footage.useProxy;
        }
        var footageTag = LML.tag.read(footage) || { kind: "basemapFootage", v: 2, pass: tag.pass };
        footageTag.mapId = newId;
        LML.tag.write(fresh, footageTag);
        // Named like importPass names it: the map comp, then the pass.
        var label = footage.name.indexOf(fromName) === 0 ? footage.name.substring(fromName.length) : " " + footage.name;
        fresh.name = mapComp.name + label;
        LML.basemap.withUnlocked(layer, function () {
            layer.replaceSource(fresh, false);
            LML.tag.write(layer, tag);
        });
        count++;
    }
    return count;
};

/** Moves the panel's layers in a scene from one map id to another, the inset links with them. */
LML.dupes.retagScene = function (scene, fromId, toId) {
    var moved = 0;
    for (var i = 1; i <= scene.numLayers; i++) {
        var layer = scene.layer(i);
        var tag = LML.tag.read(layer);
        if (!tag) continue;
        var changed = false;
        if (tag.kind !== "mapLayer" && tag.mapId === fromId) {
            tag.mapId = toId;
            changed = true;
        }
        if (tag.inset === fromId) {
            tag.inset = toId;
            changed = true;
        }
        if (changed) {
            LML.tag.write(layer, tag);
            moved++;
        }
    }
    return moved;
};

LML.dupes.separate = function (original, copy) {
    var oldId = LML.tag.read(copy).mapId;
    var newId = LML.map.uid();
    var scene = copy.containingComp;
    var sameScene = scene.id === original.containingComp.id;
    var mapComp = copy.source;
    var madeComp = false;
    if (mapComp && original.source && mapComp.id === original.source.id) {
        mapComp = original.source.duplicate();
        mapComp.name = LML.map.uniqueCompName(original.source.name);
        mapComp.parentFolder = original.source.parentFolder;
        copy.replaceSource(mapComp, false);
        madeComp = true;
    }
    var compTag = LML.tag.read(mapComp) || { kind: "mapComp", v: 1 };
    compTag.id = newId;
    LML.tag.write(mapComp, compTag);
    var footage = LML.dupes.ownFootage(mapComp, newId, original.source ? original.source.name : "");
    var tag = LML.tag.read(copy);
    tag.mapId = newId;
    if (typeof copy.id === "number") tag.layerId = copy.id;
    LML.tag.write(copy, tag);
    var moved = sameScene ? 0 : LML.dupes.retagScene(scene, oldId, newId);
    return {
        from: oldId,
        to: newId,
        sceneCompName: scene.name,
        originalSceneName: original.containingComp.name,
        mapCompName: mapComp.name,
        madeComp: madeComp,
        footage: footage,
        layers: moved,
        sameScene: sameScene,
        key: LML.dupes.keyOf(copy)
    };
};

/**
 * Separates every map that shares its id with another.
 * args: { skip: [key] } - copies separated before that Undo brought back; they are left as they are.
 * -> { separated: [...], kept: [{ key, sceneCompName }] }
 */
LML.dupes.separateAll = function (args) {
    var skip = {};
    var list = (args && args.skip) || [];
    for (var s = 0; s < list.length; s++) skip[list[s]] = true;
    var layers = LML.map.findMapLayers();
    var groups = {};
    var order = [];
    for (var i = 0; i < layers.length; i++) {
        var id = LML.tag.read(layers[i]).mapId;
        if (!groups[id]) {
            groups[id] = [];
            order.push(id);
        }
        groups[id].push(layers[i]);
    }
    var separated = [];
    var kept = [];
    for (var g = 0; g < order.length; g++) {
        var group = groups[order[g]];
        if (group.length < 2) continue;
        var original = LML.dupes.originalOf(group);
        var originalKey = LML.dupes.keyOf(original);
        // The original remembers that it is the original, so the next copy is told apart for certain.
        var originalTag = LML.tag.read(original);
        if (typeof original.id === "number" && originalTag.layerId !== original.id) {
            originalTag.layerId = original.id;
            LML.tag.write(original, originalTag);
        }
        for (var k = 0; k < group.length; k++) {
            var copy = group[k];
            var key = LML.dupes.keyOf(copy);
            if (key === originalKey) continue;
            if (skip[key]) {
                kept.push({ key: key, sceneCompName: copy.containingComp.name });
                continue;
            }
            separated.push(LML.dupes.separate(original, copy));
        }
    }
    return { separated: separated, kept: kept };
};

LML.api.separateDuplicateMaps = function (args) {
    return LML.withUndo("Separate copied maps", function () {
        return LML.dupes.separateAll(args);
    });
};

/**
 * Every file the project's basemap footage shows, main and proxy, whichever map it belongs to. A
 * copied map shows its original's frames until it is rendered itself, so the original's clean-up
 * must not take them away.
 */
LML.api.footageInUse = function () {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof FootageItem)) continue;
        var tag = LML.tag.read(item);
        if (!tag || tag.kind !== "basemapFootage") continue;
        if (item.mainSource && item.mainSource.file) out.push(item.mainSource.file.fsName);
        if (LML.basemap.hasProxy(item) && item.proxySource.file) out.push(item.proxySource.file.fsName);
    }
    return out;
};
