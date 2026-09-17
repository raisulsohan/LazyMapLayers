/*
 * Every comp and layer LazyMapLayers generates carries a tag in its comment:
 *   LML:{"kind":"mapComp","v":1,...}
 * Regeneration only touches tagged items; the user's own items are never modified.
 * Text the user adds to the comment after the tag line is kept.
 */
LML.tag = LML.tag || {};
LML.tag.PREFIX = "LML:";

LML.tag.read = function (item) {
    if (!item || typeof item.comment !== "string") return null;
    var comment = item.comment;
    if (comment.indexOf(LML.tag.PREFIX) !== 0) return null;
    var end = comment.indexOf("\n");
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
        var end = comment.indexOf("\n");
        rest = end < 0 ? "" : comment.substring(end);
    } else if (comment.length) {
        rest = "\n" + comment;
    }
    item.comment = LML.tag.PREFIX + LML.json.stringify(data) + rest;
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
