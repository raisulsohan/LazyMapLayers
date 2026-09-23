/*
 * LazyMapLayers host script (ExtendScript, ES3).
 * Files in src/host are concatenated in name order into dist/host/lazymaplayers.jsx.
 * Everything lives under the global LML object. Built-in prototypes are never modified, because
 * other panels share this ExtendScript engine.
 */
var LML = (typeof LML !== "undefined" && LML) ? LML : {};
LML.version = "0.5.0";
LML.api = LML.api || {};
LML.util = LML.util || {};

LML.util.isArray = function (value) {
    return Object.prototype.toString.call(value) === "[object Array]";
};

LML.util.indexOf = function (list, value) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === value) return i;
    }
    return -1;
};

LML.util.trim = function (text) {
    return String(text).replace(/^\s+|\s+$/g, "");
};

LML.util.error = function (code, message) {
    var e = new Error(message);
    e.lmlCode = code;
    return e;
};
