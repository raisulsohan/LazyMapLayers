import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "../../src/core/camera/camera.ts";
import {
  aeMajor, checkHost, checkMapComp, checkOffline, checkPins, checkRender, chromiumOf, countColours, engineName, expectedPin, flatSpot,
  installKindOf, isPmtilesHead, promisedFiles, SELF_TEST_PIN, SELF_TEST_SIZE, SELF_TEST_VIEW, selfTestReport, systemName, verdictLine, withoutHome,
  type SelfTestCheck
} from "../../src/core/support/selfTest.ts";
import { issueFormUrl } from "../../src/core/support/issueForm.ts";

test("the host must answer with the panel's own version, in After Effects 2024 or newer", () => {
  assert.equal(aeMajor("26.5x89"), 26);
  assert.equal(aeMajor("24.0.0"), 24);
  assert.ok(Number.isNaN(aeMajor("")));
  const ok = checkHost({ lml: "1.1.2", appVersion: "26.5x89", expressionEngine: "javascript-1.0" }, "1.1.2");
  assert.equal(ok.status, "pass");
  assert.match(ok.detail, /1\.1\.2 in After Effects 26\.5x89, JavaScript expressions/);
  assert.equal(checkHost({ lml: "1.1.1", appVersion: "26.5", expressionEngine: null }, "1.1.2").status, "fail", "an old host script left behind");
  assert.match(checkHost({ lml: "1.1.2", appVersion: "23.6x5" }, "1.1.2").detail, /needs 2024/);
  assert.equal(checkHost(null, "1.1.2", "EvalScript error.").status, "fail");
  assert.equal(engineName("extendscript"), "Legacy ExtendScript");
});

test("a render passes when the frame has its size and more than one colour", () => {
  const base = { ok: true, width: SELF_TEST_SIZE.width, height: SELF_TEST_SIZE.height, ms: 84.4, webgl2: true, gpu: "Apple M2", colours: 9 };
  const passed = checkRender(base);
  assert.equal(passed.status, "pass");
  assert.equal(passed.detail, "640x360 in 84 ms on Apple M2");
  assert.equal(checkRender({ ...base, colours: 1 }).status, "fail", "a flat frame drew nothing");
  assert.equal(checkRender({ ...base, width: 320 }).status, "fail");
  assert.match(checkRender({ ok: false, webgl2: false }).detail, /WebGL 2/);
  assert.match(checkRender({ ok: false, error: "context lost" }).detail, /context lost/);
});

test("colours are counted, and a flat spot is found nearest the middle", () => {
  const width = 40;
  const height = 20;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      // Land on the left, sea on the right, a one-pixel coast between.
      const colour = x < 19 ? [200, 180, 140] : x === 19 ? [0, 0, 0] : [20, 60, 120];
      rgba.set([...colour, 255], p);
    }
  }
  assert.equal(countColours(rgba), 3);
  assert.equal(countColours(rgba, 2), 2, "counting stops at the limit");
  const spot = flatSpot(rgba, width, height);
  assert.ok(spot);
  assert.ok(Math.abs(spot.x - 19) >= 4, `the spot ${spot.x} keeps away from the coast`);
  assert.deepEqual(spot.rgb, spot.x < 19 ? [200, 180, 140] : [20, 60, 120]);
  const noisy = new Uint8Array(8 * 8 * 4).map((_, i) => (i * 37) % 251);
  assert.equal(flatSpot(noisy, 8, 8), null);
});

test("the map comp check wants its controls, the frame imported, its pixels drawn and nothing left behind", () => {
  const made = { mapCompName: "LazyMapLayers Self-test", controls: ["Latitude", "Longitude", "Zoom", "Bearing", "Pitch", "Globe"], footage: { width: 640, height: 360 } };
  const spot = { rgb: [20, 60, 120] as [number, number, number] };
  const sample = [20 / 255, 61 / 255, 118 / 255, 1];
  const passed = checkMapComp({ made, leftover: [], sample, undoGroup: "LazyMapLayers: Self-test" }, spot);
  assert.equal(passed.status, "pass");
  assert.match(passed.detail, /one undo step \("LazyMapLayers: Self-test"\); After Effects drew the frame within 2\/255/);
  assert.equal(checkMapComp({ made, leftover: ["Map Scene 3"], sample }, spot).status, "fail");
  assert.equal(checkMapComp({ made: { ...made, controls: ["Latitude"] }, sample }, spot).status, "fail");
  assert.equal(checkMapComp({ made: { ...made, footage: null }, sample }, spot).status, "fail");
  assert.equal(checkMapComp({ made, sample: [1, 0, 0, 1] }, spot).status, "fail", "the wrong colour without colour management");
  assert.equal(checkMapComp({ made, sample: [1, 0, 0, 1], workingSpace: "Rec.709 Gamma 2.4" }, spot).status, "warn", "a working colour space may shift it");
  assert.equal(checkMapComp({ made, sample: null }, spot).status, "warn");
  assert.equal(checkMapComp({ error: "MAP_NOT_FOUND: no map" }, spot).status, "fail");
});

test("the test's pin is inside its frame, in front of the camera, and judged against the camera maths", () => {
  const p = project(SELF_TEST_VIEW, SELF_TEST_SIZE, SELF_TEST_PIN);
  assert.ok(p.visible);
  assert.ok(p.x > 40 && p.x < SELF_TEST_SIZE.width - 40 && p.y > 40 && p.y < SELF_TEST_SIZE.height - 40, `${p.x}, ${p.y}`);
  const want = expectedPin();
  assert.equal(checkPins({ pin: [want.x + 0.003, want.y], pin3d: [want.x, want.y - 0.004], errors: [] }).status, "pass");
  const off = checkPins({ pin: [want.x, want.y], pin3d: [want.x + 3, want.y], errors: [] });
  assert.equal(off.status, "fail");
  assert.match(off.detail, /3D pin through the camera 3\.000 px/);
  assert.equal(checkPins({ pin: null, pin3d: null }).status, "fail");
  assert.equal(checkPins({ error: "MAP_NOT_FOUND: gone" }).detail, "the pins could not be read: MAP_NOT_FOUND: gone");
  assert.match(checkPins({ pin: [0, 0], pin3d: [0, 0], errors: ["position: Error at line 1"] }).detail, /expression errors/);
});

test("an install is Full, Light or Online, and promises its files", () => {
  assert.equal(installKindOf(null), "online");
  assert.equal(installKindOf({ v: 1, kind: "light", world: { maxZoom: 6 } }), "light");
  assert.equal(installKindOf({ v: 1, world: { maxZoom: 9 }, terrain: {} }), "full", "the full pack names no kind");
  assert.equal(installKindOf({ v: 1 }), null);
  assert.equal(installKindOf("not json"), null);
  assert.deepEqual(promisedFiles("online"), []);
  assert.equal(promisedFiles("light").length, 4);
  assert.ok(promisedFiles("full").includes("boundaries/manifest.json"));
  assert.ok(isPmtilesHead(new Uint8Array([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3, 0])));
  assert.ok(!isPmtilesHead(new Uint8Array([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 2])));
  assert.ok(!isPmtilesHead(new Uint8Array(4)));
});

test("the offline check holds an install to what it promised", () => {
  const light = Object.fromEntries(promisedFiles("light").map((file) => [file, "ok" as const]));
  const passed = checkOffline({ pack: { kind: "light", world: {} }, files: light, naturalEarth: "ok", writable: true, worldMaxZoom: 6 });
  assert.equal(passed.status, "pass");
  assert.equal(passed.detail, "Light install, the world to zoom 6: 4 files found and readable");
  const broken = checkOffline({ pack: { world: {} }, files: { ...light }, naturalEarth: "ok", writable: true });
  assert.equal(broken.status, "fail", "a Full pack.json with only the light files");
  assert.match(broken.detail, /imagery\/blue-marble\.pmtiles is missing/);
  assert.equal(checkOffline({ pack: null, files: {}, naturalEarth: "ok", writable: true }).status, "pass");
  assert.equal(checkOffline({ pack: null, files: {}, naturalEarth: "missing", writable: true }).status, "fail");
  assert.equal(checkOffline({ pack: null, files: {}, naturalEarth: "ok", writable: false }).status, "fail");
  assert.equal(checkOffline({ pack: { v: 1 }, files: {}, naturalEarth: "ok", writable: true }).status, "fail");
});

test("systems are named as people name them", () => {
  assert.equal(systemName("darwin", "24.1.0", "arm64"), "macOS 15 (Darwin 24.1.0, arm64)");
  assert.equal(systemName("darwin", "20.6.0"), "macOS 11 (Darwin 20.6.0)");
  assert.equal(systemName("darwin", "25.0.0"), "macOS 26 (Darwin 25.0.0)");
  assert.equal(systemName("darwin", "19.6.0"), "macOS 10.15 (Darwin 19.6.0)");
  assert.equal(systemName("win32", "10.0.26300", "x64"), "Windows 11 (10.0.26300, x64)");
  assert.equal(systemName("win32", "10.0.19045"), "Windows 10 (10.0.19045)");
  assert.equal(systemName("linux", "6.1"), "linux 6.1");
  assert.equal(chromiumOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36"), "Chromium 99.0.4844.84");
  assert.equal(chromiumOf("curl"), null);
});

test("one line says how the run went", () => {
  const c = (status: SelfTestCheck["status"], name = "x"): SelfTestCheck => ({ id: "host", name, status, detail: "" });
  assert.equal(verdictLine([c("pass"), c("pass"), c("info")]), "PASS, 3 of 3");
  assert.equal(verdictLine([c("pass"), c("warn", "Map comp")]), "PASS with warnings: Map comp (1 of 2 passed)");
  assert.equal(verdictLine([c("fail", "Pins"), c("warn"), c("pass")]), "FAIL: Pins (1 of 3 passed)");
});

test("the home folder becomes ~, and only the home folder", () => {
  assert.equal(withoutHome("C:\\Users\\Ann\\AppData\\Roaming\\LazyMapLayers and c:/users/ann/x", "C:\\Users\\Ann"), "~\\AppData\\Roaming\\LazyMapLayers and ~/x");
  assert.equal(withoutHome("/Users/ann/Library and /Users/anna/Library", "/Users/ann"), "~/Library and /Users/anna/Library");
  assert.equal(withoutHome("nothing here", "/"), "nothing here");
});

test("the report names the versions, the system and every check", () => {
  const checks: SelfTestCheck[] = [
    { id: "host", name: "Host script", status: "pass", detail: "LazyMapLayers 1.1.2 in After Effects 26.5x89" },
    { id: "pin", name: "Pins match the camera", status: "fail", detail: "3D pin 3 px" }
  ];
  const text = selfTestReport({ checks, written: "2026-10-12T10:00:00.000Z", panelVersion: "1.1.2", ae: "26.5x89", system: "macOS 15 (Darwin 24.1.0, arm64)", cep: "Chromium 99.0.4844.84", gpu: "Apple M2", install: "Light", seconds: 3.24 });
  const lines = text.split("\n");
  assert.equal(lines[0], "LazyMapLayers Self-test");
  assert.equal(lines[1], "Result: FAIL: Pins match the camera (1 of 2 passed)");
  assert.equal(lines[2], "Written: 2026-10-12T10:00:00.000Z (took 3.2 s)");
  assert.ok(lines.includes("System: macOS 15 (Darwin 24.1.0, arm64)"));
  assert.ok(lines.includes("  PASS  Host script            LazyMapLayers 1.1.2 in After Effects 26.5x89"));
  assert.ok(lines.includes("  FAIL  Pins match the camera  3D pin 3 px"));
});

test("the issue address carries the form and three short fields, nothing else", () => {
  const url = issueFormUrl("https://github.com/raisulsohan/LazyMapLayers/issues/new", { versions: "After Effects 26.5 · LazyMapLayers 1.1.2", system: "macOS 15 (Darwin 24.1.0, arm64)", selfTest: "PASS, 5 of 5" });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("template"), "bug.yml");
  assert.equal(parsed.searchParams.get("title"), "Problem: ");
  assert.equal(parsed.searchParams.get("versions"), "After Effects 26.5 · LazyMapLayers 1.1.2");
  assert.equal(parsed.searchParams.get("self-test"), "PASS, 5 of 5");
  assert.deepEqual([...parsed.searchParams.keys()], ["template", "title", "versions", "system", "self-test"]);
  const long = issueFormUrl("https://x/new", { versions: "v".repeat(500), system: "s" });
  assert.equal(new URL(long).searchParams.get("versions")?.length, 200);
  assert.equal(new URL(long).searchParams.get("self-test"), null);
});
