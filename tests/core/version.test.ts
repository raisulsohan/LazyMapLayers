import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewer, parseVersion } from "../../src/core/version.ts";

test("version tags are read in the forms releases use", () => {
  assert.deepEqual(parseVersion("v0.3.1"), [0, 3, 1]);
  assert.deepEqual(parseVersion("0.10"), [0, 10]);
  assert.deepEqual(parseVersion(" 1.0.0-beta.2"), [1, 0, 0]);
  assert.equal(parseVersion("latest"), null);
  assert.equal(parseVersion(""), null);
});

test("newer is newer, whatever the number of parts", () => {
  assert.ok(compareVersions("0.3.2", "0.3.1") > 0);
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0, "ten is more than nine");
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.ok(compareVersions("0.3.1", "v0.3.1-beta") === 0);
  assert.ok(isNewer("v0.4.0", "0.3.1"));
  assert.ok(!isNewer("0.3.1", "0.3.1"));
  assert.ok(!isNewer("0.3.0", "0.3.1"));
  assert.ok(!isNewer("latest", "0.3.1"), "a word is not a newer version");
});
