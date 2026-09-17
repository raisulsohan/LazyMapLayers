/*
 * Logging, undo, job files and the single entry point the panel calls: LML.call(name, argsJson).
 */
LML.logFile = function () {
    var folder = new Folder(Folder.temp.fsName + "/LazyMapLayers");
    if (!folder.exists) folder.create();
    return new File(folder.fsName + "/host.log");
};

LML.log = function (level, message) {
    try {
        var file = LML.logFile();
        file.encoding = "UTF-8";
        file.open("a");
        file.writeln(new Date().toUTCString() + " [" + level + "] " + message);
        file.close();
    } catch (e) {
        // Logging must never break an action.
    }
};

/** Runs fn inside one undo group, so Ctrl+Z reverts the whole action. Never purges undo. */
LML.withUndo = function (label, fn) {
    app.beginUndoGroup("LazyMapLayers: " + label);
    try {
        return fn();
    } finally {
        app.endUndoGroup();
    }
};

LML.readTextFile = function (path) {
    var file = new File(path);
    if (!file.exists) throw LML.util.error("FILE_NOT_FOUND", "File not found: " + path);
    file.encoding = "UTF-8";
    if (!file.open("r")) throw LML.util.error("FILE_OPEN_FAILED", "Cannot open: " + path);
    var text = file.read();
    file.close();
    return text;
};

LML.call = function (name, argsJson) {
    var result;
    try {
        var fn = LML.api[name];
        if (typeof fn !== "function") {
            throw LML.util.error("NOT_FOUND", "Unknown host function: " + name);
        }
        var args = argsJson ? LML.json.parse(argsJson) : {};
        if (args && args.jobFile) {
            args = LML.json.parse(LML.readTextFile(args.jobFile));
        }
        result = { ok: true, value: fn(args) };
    } catch (e) {
        var message = (e && e.message) ? e.message : String(e);
        if (e && e.line) message += " (line " + e.line + ")";
        LML.log("error", name + ": " + message);
        result = { ok: false, error: { code: (e && e.lmlCode) ? e.lmlCode : "HOST_ERROR", message: message } };
    }
    return LML.json.stringify(result);
};
