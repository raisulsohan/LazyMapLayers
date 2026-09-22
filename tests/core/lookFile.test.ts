import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_LOOK } from "../../src/core/style/customLook.ts";
import { lookFileName, readLookFile, writeLookFile } from "../../src/core/style/lookFile.ts";

test("a look written to a file comes back the same", () => {
  const colours = { ...NO_LOOK, ocean: "#0b1020", land: "#1d2636", accent: "#ff9d2e" };
  const text = writeLookFile("Studio blue", "midnight", colours);
  const read = readLookFile(text)!;
  assert.equal(read.name, "Studio blue");
  assert.equal(read.base, "midnight");
  assert.deepEqual(read.colours, colours);
  // It is plain JSON a person can read and edit.
  assert.ok(text.includes(`"lml": "look"`), text);
  assert.ok(text.endsWith("\n"));
});

test("anything else is not a look file", () => {
  assert.equal(readLookFile("not json"), null);
  assert.equal(readLookFile(`{"hello":"world"}`), null);
  assert.equal(readLookFile(`{"lml":"look"}`)!.base, "midnight", "what is missing takes a sensible value");
  assert.deepEqual(readLookFile(`{"lml":"look","colours":{"ocean":"blue"}}`)!.colours, NO_LOOK, "a colour that is not one is dropped");
  assert.equal(readLookFile(`{"lml":"look","base":"../../etc"}`)!.base, "midnight");
});

test("the file name is safe to write anywhere", () => {
  assert.equal(lookFileName("Studio blue"), "Studio blue.lmllook.json");
  assert.equal(lookFileName("../../secrets"), "secrets.lmllook.json");
  assert.equal(lookFileName(""), "Look.lmllook.json");
});
