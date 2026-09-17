/*
 * The shot list of a map. The panel owns the list and the camera maths; the host stores the list
 * with the map layer (so it travels with the project), writes the baked keys to the five map controls
 * and marks every shot with a layer marker. Only keys inside the list's time range, and only markers
 * the host made itself, are ever replaced.
 */
LML.shots = LML.shots || {};
LML.shots.KEY = "SHOTS";
LML.shots.MARKER_PARAMETER = "lmlShot";

LML.shots.read = function (layer) {
    return LML.tag.readExtra(layer, LML.shots.KEY) || {};
};

/** Indices of the first and last key inside [from, to], or null when there is none. */
LML.shots.keyRange = function (prop, from, to, eps) {
    if (prop.numKeys === 0) return null;
    var first = prop.nearestKeyIndex(from);
    if (prop.keyTime(first) < from - eps) first++;
    var last = prop.nearestKeyIndex(to);
    if (prop.keyTime(last) > to + eps) last--;
    if (first > last || first < 1 || last > prop.numKeys) return null;
    return { first: first, last: last };
};

/** More keys than this are not removed one by one (about 1.3 ms each): the control is replaced instead. */
LML.shots.SLOW_REMOVAL_LIMIT = 120;

/**
 * Removes a map control's keys inside [from, to] and returns { removed, how }.
 * After Effects removes keys one at a time, at over a millisecond each, so a camera with a key on
 * every frame would block for seconds. When the control has many keys, all of them inside the range,
 * and no expression, the control is replaced by a fresh one with the same name and place instead:
 * expressions find controls by name, so every link keeps working.
 */
LML.shots.clearKeys = function (layer, control, from, to, eps) {
    var prop = LML.map.controlValueProperty(layer, control.name);
    if (!prop) return { removed: 0, how: "missing" };
    var range = LML.shots.keyRange(prop, from, to, eps);
    if (!range) return { removed: 0, how: "none" };
    var count = range.last - range.first + 1;
    var owned = count === prop.numKeys && !prop.expression;
    if (count > LML.shots.SLOW_REMOVAL_LIMIT && owned) {
        var effects = layer.property("ADBE Effect Parade");
        var effect = effects.property(control.name);
        var index = effect.propertyIndex;
        var still = prop.valueAtTime(from, false);
        effect.remove();
        var fresh = effects.addProperty(control.matchName);
        fresh.name = control.name;
        if (fresh.propertyIndex !== index) fresh.moveTo(index);
        // moveTo invalidates the reference: fetch the control again by name.
        LML.map.controlValueProperty(layer, control.name).setValue(still);
        return { removed: count, how: "replaced" };
    }
    for (var k = range.last; k >= range.first; k--) prop.removeKey(k);
    return { removed: count, how: count > LML.shots.SLOW_REMOVAL_LIMIT ? "slow" : "removed" };
};

/**
 * A cheap fingerprint of the camera keys in a time range: key counts and sampled values of the five
 * controls. It changes when keys are added, removed, moved or edited by hand.
 */
LML.shots.signature = function (layer, from, to) {
    var eps = 0.25 / layer.containingComp.frameRate;
    var parts = [];
    for (var c = 0; c < LML.map.CONTROLS.length; c++) {
        var prop = LML.map.controlValueProperty(layer, LML.map.CONTROLS[c].name);
        if (!prop) {
            parts.push("x");
            continue;
        }
        var range = LML.shots.keyRange(prop, from, to, eps);
        parts.push(range ? range.last - range.first + 1 : 0);
        for (var s = 0; s <= 8; s++) {
            var value = prop.valueAtTime(from + (to - from) * s / 8, false);
            parts.push(Math.round(value * 100000) / 100000);
        }
    }
    return parts.join(",");
};

LML.shots.removeMarkers = function (layer) {
    var markers = layer.property("ADBE Marker");
    var removed = 0;
    for (var k = markers.numKeys; k >= 1; k--) {
        var parameters = null;
        try {
            parameters = markers.keyValue(k).getParameters();
        } catch (e) {
            parameters = null;
        }
        if (parameters && parameters[LML.shots.MARKER_PARAMETER]) {
            markers.removeKey(k);
            removed++;
        }
    }
    return removed;
};

LML.shots.addMarkers = function (layer, list) {
    var markers = layer.property("ADBE Marker");
    for (var i = 0; i < list.length; i++) {
        var value = new MarkerValue(list[i].name);
        var parameters = {};
        parameters[LML.shots.MARKER_PARAMETER] = list[i].shotId;
        value.setParameters(parameters);
        try {
            value.label = 9;
        } catch (e) {
            // Marker colours need After Effects 16 or newer.
        }
        markers.setValueAtTime(list[i].time, value);
    }
};

/** args: { mapId } -> { list, state: "none" | "saved" | "applied" | "edited", appliedHash } */
LML.api.getShots = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    var data = LML.shots.read(layer);
    if (!data.list) return { list: null, state: "none", appliedHash: null };
    var state = "saved";
    if (data.applied) {
        state = LML.shots.signature(layer, data.applied.from, data.applied.to) === data.applied.signature ? "applied" : "edited";
    }
    return { list: data.list, state: state, appliedHash: data.applied ? data.applied.hash : null };
};

/** Stores the list without touching the timeline. args: { mapId, list } */
LML.api.saveShots = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Edit shots", function () {
        var data = LML.shots.read(layer);
        data.list = args.list;
        LML.tag.writeExtra(layer, LML.shots.KEY, data);
        return true;
    });
};

/**
 * Writes the baked camera to the timeline in one undo step.
 * args: { mapId, list, hash, baked: { startTime, endTime, controls: [{ key, times, values }], holdTimes, markers }, moveTime }
 */
LML.api.applyShots = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    var started = new Date().getTime();
    return LML.withUndo("Apply shots", function () {
        var baked = args.baked;
        var data = LML.shots.read(layer);
        var eps = 0.25 / layer.containingComp.frameRate;
        // Clear the range of this bake and of the one before it (a shorter list leaves no old keys).
        var from = baked.startTime;
        var to = baked.endTime;
        if (data.applied) {
            from = Math.min(from, data.applied.from);
            to = Math.max(to, data.applied.to);
        }
        var removed = 0;
        var written = 0;
        var slow = 0;
        for (var c = 0; c < LML.map.CONTROLS.length; c++) {
            var control = LML.map.CONTROLS[c];
            if (!LML.map.controlValueProperty(layer, control.name)) continue;
            var cleared = LML.shots.clearKeys(layer, control, from, to, eps);
            removed += cleared.removed;
            if (cleared.how === "slow") slow += cleared.removed;
            // The control may have been replaced: fetch it after clearing.
            var prop = LML.map.controlValueProperty(layer, control.name);
            var track = null;
            for (var t = 0; t < baked.controls.length; t++) {
                if (baked.controls[t].key === control.key) track = baked.controls[t];
            }
            if (!track || !track.times.length) continue;
            prop.setValuesAtTimes(track.times, track.values);
            written += track.times.length;
            for (var h = 0; h < baked.holdTimes.length; h++) {
                var index = prop.nearestKeyIndex(baked.holdTimes[h]);
                if (Math.abs(prop.keyTime(index) - baked.holdTimes[h]) > eps) continue;
                prop.setInterpolationTypeAtKey(index, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
            }
        }
        LML.shots.removeMarkers(layer);
        LML.shots.addMarkers(layer, baked.markers);
        data.list = args.list;
        data.applied = { from: baked.startTime, to: baked.endTime, hash: args.hash, signature: LML.shots.signature(layer, baked.startTime, baked.endTime) };
        LML.tag.writeExtra(layer, LML.shots.KEY, data);
        if (args.moveTime !== undefined && args.moveTime !== null) layer.containingComp.time = args.moveTime;
        return { keys: written, removed: removed, slowRemovals: slow, markers: baked.markers.length, ms: new Date().getTime() - started };
    });
};

/** Removes the list, its markers and (with args.keys) the keys it wrote. */
LML.api.clearShots = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo("Clear shots", function () {
        var data = LML.shots.read(layer);
        var removed = 0;
        if (args.keys && data.applied) {
            var eps = 0.25 / layer.containingComp.frameRate;
            for (var c = 0; c < LML.map.CONTROLS.length; c++) {
                var control = LML.map.CONTROLS[c];
                var prop = LML.map.controlValueProperty(layer, control.name);
                if (!prop) continue;
                // Keep the view at the start of the shots as the still value.
                var value = prop.valueAtTime(data.applied.from, false);
                removed += LML.shots.clearKeys(layer, control, data.applied.from, data.applied.to, eps).removed;
                prop = LML.map.controlValueProperty(layer, control.name);
                if (prop.numKeys === 0) prop.setValue(value);
            }
        }
        LML.shots.removeMarkers(layer);
        LML.tag.writeExtra(layer, LML.shots.KEY, null);
        return { removed: removed };
    });
};

/** Moves the time indicator of the map's scene comp. args: { mapId, time } */
LML.api.setSceneTime = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    var comp = layer.containingComp;
    comp.time = Math.max(0, Math.min(comp.duration - comp.frameDuration, args.time));
    return { time: comp.time };
};
