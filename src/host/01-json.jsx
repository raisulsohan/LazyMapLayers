/*
 * JSON for ExtendScript, which has no built-in JSON object.
 * stringify escapes every non-ASCII character, so results survive any code page on the way back
 * to the panel. parse validates the text before evaluating it (the classic safe-eval approach).
 */
LML.json = LML.json || {};

LML.json.quote = function (text) {
    var s = String(text);
    var out = "\"";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var code = s.charCodeAt(i);
        if (c === "\"") out += "\\\"";
        else if (c === "\\") out += "\\\\";
        else if (c === "\n") out += "\\n";
        else if (c === "\r") out += "\\r";
        else if (c === "\t") out += "\\t";
        else if (code < 32 || code > 126) {
            var hex = code.toString(16);
            while (hex.length < 4) hex = "0" + hex;
            out += "\\u" + hex;
        } else out += c;
    }
    return out + "\"";
};

LML.json.stringify = function (value) {
    if (value === null || value === undefined) return "null";
    var type = typeof value;
    if (type === "number") return isFinite(value) ? String(value) : "null";
    if (type === "boolean") return value ? "true" : "false";
    if (type === "string") return LML.json.quote(value);
    if (type === "function") return "null";
    if (LML.util.isArray(value)) {
        var items = [];
        for (var i = 0; i < value.length; i++) items.push(LML.json.stringify(value[i]));
        return "[" + items.join(",") + "]";
    }
    var parts = [];
    for (var key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        var v = value[key];
        if (v === undefined || typeof v === "function") continue;
        parts.push(LML.json.quote(key) + ":" + LML.json.stringify(v));
    }
    return "{" + parts.join(",") + "}";
};

LML.json.parse = function (text) {
    var s = String(text);
    // Replace escapes, then strings, numbers and literals, then drop brackets; only valid JSON
    // leaves nothing but ":,{}[]" and whitespace behind.
    var check = s
        .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
        .replace(/(?:^|:|,)(?:\s*\[)+/g, "");
    if (!/^[\],:{}\s]*$/.test(check)) {
        throw LML.util.error("BAD_JSON", "Invalid JSON: " + s.substring(0, 80));
    }
    return eval("(" + s + ")");
};
