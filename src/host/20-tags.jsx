/*
 * Every comp and layer LazyMapLayers generates carries a tag in its comment:
 *   LML:{"kind":"mapComp","v":1,...}
 * Regeneration only touches tagged items; the user's own items are never modified.
 * Text the user adds to the comment after the tag line is kept.
 *
 * Larger data (such as a map's shot list) sits on its own line after the tag, so reading the tag
 * stays cheap:
 *   LML-SHOTS:{...}
 */
LML.tag = LML.tag || {};
LML.tag.PREFIX = "LML:";
LML.tag.EXTRA_PREFIX = "LML-";

/** Index of the first line break (\n or \r), or -1. */
LML.tag.lineEnd = function (text) {
    var n = text.indexOf("\n");
    var r = text.indexOf("\r");
    if (n < 0) return r;
    if (r < 0) return n;
    return Math.min(n, r);
};

LML.tag.read = function (item) {
    if (!item || typeof item.comment !== "string") return null;
    var comment = item.comment;
    if (comment.indexOf(LML.tag.PREFIX) !== 0) return null;
    var end = LML.tag.lineEnd(comment);
    var json = comment.substring(LML.tag.PREFIX.length, end < 0 ? comment.length : end);
    try {
        return LML.json.parse(json);
    } catch (e) {
        return null;
    }
};

LML.tag.write = function (item, data) {
    var rest = "";
    var comment = typeof item.comment === "string" ? item.comment : "";
    if (comment.indexOf(LML.tag.PREFIX) === 0) {
        var end = LML.tag.lineEnd(comment);
        rest = end < 0 ? "" : comment.substring(end);
    } else if (comment.length) {
        rest = "\n" + comment;
    }
    item.comment = LML.tag.PREFIX + LML.json.stringify(data) + rest;
};

/** The lines after the tag line (line breaks normalised to \n). */
LML.tag.restLines = function (item) {
    var comment = typeof item.comment === "string" ? item.comment : "";
    var end = LML.tag.lineEnd(comment);
    if (end < 0) return [];
    var rest = comment.substring(end + 1).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return rest.length ? rest.split("\n") : [];
};

/** Data stored on its own line of a tagged item's comment, or null. */
LML.tag.readExtra = function (item, key) {
    if (!LML.tag.read(item)) return null;
    var prefix = LML.tag.EXTRA_PREFIX + key + ":";
    var lines = LML.tag.restLines(item);
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(prefix) !== 0) continue;
        try {
            return LML.json.parse(lines[i].substring(prefix.length));
        } catch (e) {
            return null;
        }
    }
    return null;
};

/** Stores (or with null removes) a data line; the tag line and the user's own lines stay. */
LML.tag.writeExtra = function (item, key, data) {
    var comment = typeof item.comment === "string" ? item.comment : "";
    if (!LML.tag.read(item)) throw LML.util.error("NOT_TAGGED", "Extra data needs a tagged item");
    var prefix = LML.tag.EXTRA_PREFIX + key + ":";
    var end = LML.tag.lineEnd(comment);
    var head = end < 0 ? comment : comment.substring(0, end);
    var lines = LML.tag.restLines(item);
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(prefix) !== 0) kept.push(lines[i]);
    }
    if (data !== null && data !== undefined) kept.unshift(prefix + LML.json.stringify(data));
    item.comment = kept.length ? head + "\n" + kept.join("\n") : head;
};

LML.tag.is = function (item, kind) {
    var tag = LML.tag.read(item);
    return !!tag && (kind === undefined || tag.kind === kind);
};

LML.tag.findItems = function (kind) {
    var found = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (LML.tag.is(item, kind)) found.push(item);
    }
    return found;
};

LML.tag.findItemById = function (id) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item.id === id) return item;
    }
    return null;
};
