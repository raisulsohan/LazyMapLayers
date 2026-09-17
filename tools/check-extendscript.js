/*
 * LazyMapLayers \u2014 ExtendScript syntax and smoke check (no After Effects, no Node).
 *
 *   cscript //Nologo tools\check-extendscript.js
 *
 * Windows Script Host runs JScript, an ES3 engine like ExtendScript, so it rejects what AE would
 * reject: trailing commas, reserved words as property names, let/const and so on. After parsing,
 * the script runs the host file with a tiny fake `app`, `Folder` and `File`, and checks the JSON
 * helpers and LML.call error handling.
 */
var fso = new ActiveXObject("Scripting.FileSystemObject");
var repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));
var hostPath = fso.BuildPath(repoRoot, "dist\\host\\lazymaplayers.jsx");

function read(path) {
    var st = new ActiveXObject("ADODB.Stream");
    st.Type = 2;
    st.Charset = "utf-8";
    st.Open();
    st.LoadFromFile(path);
    var s = st.ReadText(-1);
    st.Close();
    return s;
}

var failures = 0;
function check(name, ok, detail) {
    if (!ok) failures++;
    WScript.Echo((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  [" + detail + "]" : ""));
}

if (!fso.FileExists(hostPath)) {
    WScript.Echo("dist\\host\\lazymaplayers.jsx not found. Run: node tools/build.mjs");
    WScript.Quit(2);
}

var source = read(hostPath);

// ExtendScript mis-evaluates unparenthesised chained conditionals (a ? b : c ? d : e).
(function () {
    var lines = source.split(String.fromCharCode(10));
    var bad = [];
    var strings = new RegExp("\"(?:[^\"\\\\]|\\\\.)*\"", "g");
    var comment = new RegExp("//.*$");
    var chained = new RegExp("\\?[^:;()?]*:[^;()?]*\\?[^:;()]*:");
    for (var i = 0; i < lines.length; i++) {
        var code = lines[i].replace(strings, "\"\"").replace(comment, "");
        if (chained.test(code)) bad.push((i + 1) + ": " + lines[i].replace(new RegExp("^\\s+"), ""));
    }
    check("no chained conditional operators", bad.length === 0, bad.join(" | "));
})();

// Minimal fakes so the host file can load outside After Effects.
var Folder = function (p) { this.fsName = p; this.exists = true; };
Folder.prototype.create = function () { return true; };
Folder.temp = { fsName: "C:\\Temp" };
var File = function (p) { this.fsName = p; this.exists = false; };
File.prototype.open = function () { return false; };
File.prototype.close = function () {};
File.prototype.writeln = function () {};
var app = { version: "26.0", project: { numItems: 0 }, beginUndoGroup: function () {}, endUndoGroup: function () {} };

try {
    eval(source);
    check("host parses and loads as ES3", typeof LML === "object" && LML.loaded === true);
} catch (e) {
    check("host parses and loads as ES3", false, e.message);
    WScript.Quit(1);
}

var roundTrip = LML.json.parse(LML.json.stringify({ a: [1, 2.5, -3e-7, true, null], s: "quote \" slash \\ tab \t bangla \u0995\u09CD\u09B7 emoji \uD83C\uDF0D" }));
check("json round trip keeps values", roundTrip.a[1] === 2.5 && roundTrip.a[2] === -3e-7 && roundTrip.a[3] === true && roundTrip.a[4] === null);
check("json round trip keeps unicode text", roundTrip.s === "quote \" slash \\ tab \t bangla \u0995\u09CD\u09B7 emoji \uD83C\uDF0D");
check("json output is pure ASCII", /^[\x20-\x7e]*$/.test(LML.json.stringify({ s: "\u0995 \u4e2d \u0645" })));

var rejected = false;
try {
    LML.json.parse("{\"a\": alert(1)}");
} catch (e) {
    rejected = e.lmlCode === "BAD_JSON";
}
check("json.parse rejects code", rejected);

var unknown = LML.json.parse(LML.call("doesNotExist", "{}"));
check("LML.call reports unknown functions", unknown.ok === false && unknown.error.code === "NOT_FOUND");

var ping = LML.json.parse(LML.call("ping", "{}"));
check("LML.call ping", ping.ok === true && ping.value.appVersion === "26.0", ping.ok ? "" : ping.error.message);

var tagged = { comment: "user note" };
LML.tag.write(tagged, { kind: "mapComp", v: 1 });
check("tag keeps the user's comment", tagged.comment === "LML:{\"kind\":\"mapComp\",\"v\":1}\nuser note");
check("tag reads back", LML.tag.is(tagged, "mapComp") && !LML.tag.is(tagged, "scene"));
LML.tag.write(tagged, { kind: "mapComp", v: 2 });
check("tag rewrite replaces only the tag line", tagged.comment === "LML:{\"kind\":\"mapComp\",\"v\":2}\nuser note");

// Extra data lines (the shot list) live after the tag line and leave everything else alone.
LML.tag.writeExtra(tagged, "SHOTS", { list: { shots: [{ name: "One\nTwo" }] } });
check("extra data sits on its own line", tagged.comment.split("\n").length === 3 && tagged.comment.indexOf("LML-SHOTS:") > 0);
check("extra data reads back", LML.tag.readExtra(tagged, "SHOTS").list.shots[0].name === "One\nTwo");
check("the tag still reads with extra data", LML.tag.read(tagged).v === 2);
LML.tag.write(tagged, { kind: "mapComp", v: 3 });
check("a tag rewrite keeps extra data and the user's note", LML.tag.readExtra(tagged, "SHOTS") !== null && tagged.comment.indexOf("user note") > 0 && LML.tag.read(tagged).v === 3);
LML.tag.writeExtra(tagged, "SHOTS", { list: null });
check("extra data is replaced, not repeated", tagged.comment.split("LML-SHOTS:").length === 2 && LML.tag.readExtra(tagged, "SHOTS").list === null);
tagged.comment = tagged.comment.split("\n").join("\r");
check("carriage returns are line ends too", LML.tag.read(tagged) !== null && LML.tag.read(tagged).v === 3 && LML.tag.readExtra(tagged, "SHOTS") !== null);
LML.tag.writeExtra(tagged, "SHOTS", null);
check("extra data can be removed", LML.tag.readExtra(tagged, "SHOTS") === null && tagged.comment === "LML:{\"kind\":\"mapComp\",\"v\":3}\nuser note");
var untagged = { comment: "just a note" };
var refused = false;
try {
    LML.tag.writeExtra(untagged, "SHOTS", {});
} catch (e) {
    refused = e.lmlCode === "NOT_TAGGED";
}
check("extra data is refused on the user's own items", refused && untagged.comment === "just a note");

// Key ranges on a fake property with keys at 0, 1, 2, 3 and 4 seconds.
var fakeProp = {
    numKeys: 5,
    keyTime: function (k) { return k - 1; },
    nearestKeyIndex: function (t) { return Math.max(1, Math.min(5, Math.round(t) + 1)); }
};
var inside = LML.shots.keyRange(fakeProp, 0.9, 3.2, 0.01);
check("key range picks the keys inside a time range", inside && inside.first === 2 && inside.last === 4, inside ? inside.first + ".." + inside.last : "null");
var whole = LML.shots.keyRange(fakeProp, -5, 50, 0.01);
check("key range covers every key of a wide range", whole && whole.first === 1 && whole.last === 5);
check("key range is empty between keys", LML.shots.keyRange(fakeProp, 1.2, 1.4, 0.01) === null);

WScript.Echo("");
WScript.Echo(failures ? failures + " check(s) failed" : "All ExtendScript checks passed");
WScript.Quit(failures ? 1 : 0);
