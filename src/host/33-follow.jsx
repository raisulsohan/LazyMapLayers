// One map's camera following another's. In the same comp the follower's camera controls read the
// leader's through a Layer Control ("Follows"), live: key the leader and both move. A leader in
// another comp cannot be linked that way, so its camera is copied instead: its keys with their
// easing, or a key per frame where its camera is itself an expression. The expressions come from
// the panel (core/ae/followExpressions.ts).

LML.follow = {};

LML.follow.FOLLOWS = "Follows";
LML.follow.ZOOM = "Follow Zoom Offset";

/** Takes the follower's camera off its leader: the expressions and the two effects go, its own keys come back. */
LML.follow.clear = function (layer) {
    for (var i = 0; i < LML.map.CONTROLS.length; i++) {
        var prop = LML.map.controlValueProperty(layer, LML.map.CONTROLS[i].name);
        if (prop && prop.expression && prop.expression.indexOf("// LazyMapLayers follow") === 0) prop.expression = "";
    }
    var effects = layer.property("ADBE Effect Parade");
    var names = [LML.follow.FOLLOWS, LML.follow.ZOOM];
    for (var n = 0; n < names.length; n++) {
        var effect = effects.property(names[n]);
        if (effect) effect.remove();
    }
    var tag = LML.tag.read(layer);
    if (tag && tag.follows) {
        delete tag.follows;
        LML.tag.write(layer, tag);
    }
};

/**
 * Makes one map's camera follow another's. args: { mapId, leaderId, zoomOffset, bearing, pitch,
 * expressions: { Latitude, Longitude, Zoom, Bearing, Pitch } (null keeps the follower's own) }.
 * leaderId null stops following.
 */
LML.api.followMap = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    return LML.withUndo(args.leaderId ? "Follow another map's camera" : "Stop following", function () {
        LML.follow.clear(layer);
        if (!args.leaderId) return { following: null };
        var leader = LML.pins.findMapLayer(args.leaderId);
        if (leader === layer) throw LML.util.error("FOLLOW_SELF", "A map cannot follow its own camera");
        if (leader.containingComp !== layer.containingComp) {
            throw LML.util.error("FOLLOW_OTHER_COMP", "The two maps are in different comps: copy the camera instead, or put both maps in one comp");
        }
        // Down the leader's own chain of leaders: this map must not be one of them.
        var step = leader;
        for (var hop = 0; hop < 32 && step; hop++) {
            var stepTag = LML.tag.read(step);
            if (!stepTag || !stepTag.follows) break;
            if (stepTag.follows.mapId === args.mapId) throw LML.util.error("FOLLOW_LOOP", "That map already follows this one");
            try {
                step = LML.pins.findMapLayer(stepTag.follows.mapId);
            } catch (eStep) {
                step = null;
            }
        }
        var effects = layer.property("ADBE Effect Parade");
        var link = effects.addProperty("ADBE Layer Control");
        link.name = LML.follow.FOLLOWS;
        link.property(1).setValue(leader.index);
        var zoom = effects.addProperty("ADBE Slider Control");
        zoom.name = LML.follow.ZOOM;
        zoom.property(1).setValue(args.zoomOffset || 0);
        var errors = [];
        for (var i = 0; i < LML.map.CONTROLS.length; i++) {
            var name = LML.map.CONTROLS[i].name;
            var expression = args.expressions[name];
            if (!expression) continue;
            LML.pins.setExpression(LML.map.controlValueProperty(layer, name), expression, errors, "follow " + name, i === 0);
        }
        var tag = LML.tag.read(layer);
        tag.follows = { mapId: args.leaderId, zoomOffset: args.zoomOffset || 0, bearing: args.bearing !== false, pitch: args.pitch !== false };
        LML.tag.write(layer, tag);
        return { following: args.leaderId, leaderName: leader.source.name, expressionErrors: errors };
    });
};

/** Copies one camera control's animation onto another: keys with their easing, a key per frame for an expression. */
LML.follow.copyControl = function (from, to, comp) {
    while (to.numKeys > 0) to.removeKey(to.numKeys);
    if (to.expression) to.expression = "";
    if (from.expressionEnabled && from.expression) {
        var frames = Math.max(1, Math.round(comp.duration * comp.frameRate));
        var times = [];
        var values = [];
        for (var f = 0; f <= frames; f++) {
            times.push(f / comp.frameRate);
            values.push(from.valueAtTime(f / comp.frameRate, false));
        }
        to.setValuesAtTimes(times, values);
        return times.length;
    }
    if (from.numKeys === 0) {
        to.setValue(from.value);
        return 0;
    }
    for (var k = 1; k <= from.numKeys; k++) to.setValueAtTime(from.keyTime(k), from.keyValue(k));
    for (var e = 1; e <= from.numKeys; e++) {
        var at = to.nearestKeyIndex(from.keyTime(e));
        try {
            to.setInterpolationTypeAtKey(at, from.keyInInterpolationType(e), from.keyOutInterpolationType(e));
            if (from.keyInInterpolationType(e) === KeyframeInterpolationType.BEZIER || from.keyOutInterpolationType(e) === KeyframeInterpolationType.BEZIER) {
                to.setTemporalEaseAtKey(at, from.keyInTemporalEase(e), from.keyOutTemporalEase(e));
                to.setTemporalContinuousAtKey(at, from.keyTemporalContinuous(e));
                to.setTemporalAutoBezierAtKey(at, from.keyTemporalAutoBezier(e));
            }
        } catch (eEase) {
            // The value is copied; only its easing is lost.
        }
    }
    return from.numKeys;
};

/** Copies another map's camera onto this one, in any comp: args { mapId, fromId }. */
LML.api.copyCamera = function (args) {
    var layer = LML.pins.findMapLayer(args.mapId);
    var from = LML.pins.findMapLayer(args.fromId);
    if (from === layer) throw LML.util.error("COPY_SELF", "Pick another map to copy the camera from");
    return LML.withUndo("Copy camera", function () {
        LML.follow.clear(layer);
        var keys = 0;
        for (var i = 0; i < LML.map.CONTROLS.length; i++) {
            var name = LML.map.CONTROLS[i].name;
            var source = LML.map.controlValueProperty(from, name);
            var target = LML.map.controlValueProperty(layer, name);
            if (!source || !target) continue;
            keys += LML.follow.copyControl(source, target, layer.containingComp);
        }
        return { keys: keys, fromName: from.source.name };
    });
};
