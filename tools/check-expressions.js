/*
 * LazyMapLayers - generated expressions in an ES3 engine (no After Effects, no Node).
 *
 *   node tools/expression-fixtures.ts
 *   cscript //Nologo tools\check-expressions.js
 *
 * Many After Effects projects use the Legacy ExtendScript expression engine (it is the default in
 * older projects and in many project templates). Windows Script Host runs JScript, an ES3 engine like
 * it, so every generated expression is run here with the same fake expression API as in Node
 * (tools/expression-env.js) and must give the same result. Syntax such as const, arrow functions or
 * template literals fails to parse, and newer built-ins such as Array.prototype.map or Math.fround
 * fail at run time.
 */
var fso = new ActiveXObject("Scripting.FileSystemObject");
var repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));

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

var fixturesPath = fso.BuildPath(repoRoot, ".cache\\expression-fixtures.js");
if (!fso.FileExists(fixturesPath)) {
    WScript.Echo(".cache\\expression-fixtures.js not found. Run: node tools/expression-fixtures.ts");
    WScript.Quit(2);
}
eval(read(fso.BuildPath(repoRoot, "tools\\expression-env.js")));
eval(read(fixturesPath));

var failures = [];
var groups = {};
var groupOrder = [];

// ExtendScript mis-evaluates unparenthesised chained conditionals (a ? b : c ? d : e).
var strings = new RegExp("\"(?:[^\"\\\\]|\\\\.)*\"", "g");
var comment = new RegExp("//.*$");
var chained = new RegExp("\\?[^:;()?]*:[^;()?]*\\?[^:;()]*:");

function staticProblem(code) {
    var lines = code.split(String.fromCharCode(10));
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(strings, "\"\"").replace(comment, "");
        if (chained.test(line)) return "chained conditional operators at line " + (i + 1);
    }
    return null;
}

function same(a, b, tolerance) {
    if (typeof a !== typeof b) return false;
    if (typeof a !== "number") return a === b;
    // Exact for float32 rounding; JSON drops the sign of zero, which the Node unit tests check instead.
    if (tolerance === 0) return a === b;
    return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
}

for (var f = 0; f < LML_EXPRESSION_FIXTURES.length; f++) {
    var fixture = LML_EXPRESSION_FIXTURES[f];
    var group = fixture.name.replace(new RegExp(" [0-9-.e+]+$"), "");
    if (!groups[group]) {
        groups[group] = { count: 0, failed: 0 };
        groupOrder.push(group);
    }
    groups[group].count++;
    var problem = staticProblem(fixture.code);
    if (!problem) {
        try {
            var got = lmlFlatten(lmlRunExpression(fixture.code, fixture.env));
            if (got.length !== fixture.expected.length) {
                problem = "result has " + got.length + " parts, Node gave " + fixture.expected.length;
            } else {
                for (var k = 0; k < got.length; k++) {
                    if (!same(got[k], fixture.expected[k], fixture.tolerance)) {
                        problem = "part " + k + " is " + got[k] + ", Node gave " + fixture.expected[k];
                        break;
                    }
                }
            }
        } catch (e) {
            problem = "error: " + (e.message || e.description || e);
        }
    }
    if (problem) {
        groups[group].failed++;
        failures.push(fixture.name + ": " + problem);
    }
}

for (var g = 0; g < groupOrder.length; g++) {
    var info = groups[groupOrder[g]];
    WScript.Echo((info.failed ? "FAIL " : "PASS ") + groupOrder[g] + "  [" + (info.count - info.failed) + "/" + info.count + "]");
}
for (var x = 0; x < failures.length && x < 12; x++) WScript.Echo("  " + failures[x]);
WScript.Echo("");
if (failures.length) {
    WScript.Echo(failures.length + " of " + LML_EXPRESSION_FIXTURES.length + " expressions failed in the ES3 engine.");
    WScript.Quit(1);
}
WScript.Echo("All " + LML_EXPRESSION_FIXTURES.length + " expressions run in the ES3 engine and match Node.");
