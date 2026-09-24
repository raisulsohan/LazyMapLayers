/*
 * A small fake of the After Effects expression API that runs a LazyMapLayers expression the way
 * After Effects does: the value of the last statement is the result.
 *
 * ES3 on purpose. Node (tools/expression-fixtures.ts) and Windows Script Host's JScript
 * (tools/check-expressions.js) both load this same file, so an expression gets exactly the same
 * inputs in a modern engine and in an ES3 engine like the Legacy ExtendScript expression engine.
 *
 * env: {
 *   own:       effects on the layer itself: { name: number, or "MAP" for the Layer Control "Map" }
 *   parentOwn: effects on the parent layer (camera rig), same shape
 *   map:       { width, height, scale, controls: { name: number }, toComp: [a, b, c, d, e, f] }
 *   comp:      { width, height }   (thisComp)
 *   value:     the property's own value
 * }
 */
function lmlEffects(own, env) {
    return function (name) {
        return function (index) {
            if (index !== 1) throw new Error("effect " + name + " read with index " + index);
            if (!own || !own.hasOwnProperty(name)) throw new Error("no effect named " + name);
            if (own[name] === "MAP") return lmlMapLayer(env);
            return { value: own[name] };
        };
    };
}

function lmlMapLayer(env) {
    var m = env.map;
    var a = m.toComp;
    return {
        source: { width: m.width, height: m.height },
        transform: { scale: [m.scale * 100, m.scale * 100] },
        effect: lmlEffects(m.controls, env),
        toComp: function (p) {
            return [a[0] * p[0] + a[1] * p[1] + a[2], a[3] * p[0] + a[4] * p[1] + a[5], 0];
        }
    };
}

function lmlRunExpression(code, env) {
    var effect = lmlEffects(env.own, env);
    var parent = { effect: lmlEffects(env.parentOwn, env) };
    var thisComp = { width: env.comp.width, height: env.comp.height };
    var value = env.value;
    var fromComp = function (p) {
        return [p[0] - 7, p[1] + 3];
    };
    var createPath = function (points, inTangents, outTangents, closed) {
        return { points: points, closed: closed };
    };
    return eval(code);
}

/** Numbers, strings, booleans, arrays and paths as one flat list, for comparing results across engines. */
function lmlFlatten(result, out) {
    out = out || [];
    if (result === null || result === undefined) {
        out.push("null");
    } else if (typeof result === "number") {
        out.push(result);
    } else if (typeof result === "string") {
        // A source text expression: kept apart from the list markers.
        out.push("text:" + result);
    } else if (typeof result === "boolean") {
        out.push(result ? 1 : 0);
    } else if (result instanceof Array) {
        out.push("[");
        for (var i = 0; i < result.length; i++) lmlFlatten(result[i], out);
        out.push("]");
    } else if (typeof result === "object" && result.points) {
        out.push("path");
        lmlFlatten(result.points, out);
        out.push(result.closed ? 1 : 0);
    } else {
        throw new Error("unexpected result type " + typeof result);
    }
    return out;
}
