import { test } from "node:test";
import assert from "node:assert/strict";
import { flagArg, listArg, MAX_REQUEST_BYTES, numberArg, parseApiRequest, textArg } from "../../src/core/data/apiRequest.ts";

const known = ["addPin", "setView", "render"] as const;

test("a request names a call the panel offers, and carries its arguments", () => {
  const read = parseApiRequest(JSON.stringify({ id: "job-1", call: "addPin", args: { lat: 23.8, lng: 90.4 } }), known);
  assert.ok("request" in read);
  assert.deepEqual(read.request, { id: "job-1", call: "addPin", args: { lat: 23.8, lng: 90.4 } });
  // No id, no arguments: both have sensible stand-ins.
  const bare = parseApiRequest('{"call":"render"}', known);
  assert.ok("request" in bare);
  assert.deepEqual(bare.request, { id: "", call: "render", args: {} });
});

test("anything else is refused with a reason, and a made-up call is never run", () => {
  assert.equal("error" in parseApiRequest("", known), true);
  assert.match((parseApiRequest("{oops", known) as { error: string }).error, /not valid JSON/);
  assert.match((parseApiRequest("[1,2]", known) as { error: string }).error, /JSON object/);
  assert.match((parseApiRequest('{"args":{}}', known) as { error: string }).error, /no call/);
  const made = parseApiRequest('{"call":"deleteEverything"}', known) as { error: string };
  assert.match(made.error, /no call named "deleteEverything"/);
  assert.match(made.error, /addPin, render, setView/, "the answer says what can be asked for");
  const huge = parseApiRequest(`{"call":"render","pad":"${"x".repeat(MAX_REQUEST_BYTES)}"}`, known) as { error: string };
  assert.match(huge.error, /bytes/);
  // An id that is not a plain name is dropped rather than used as a file name.
  const odd = parseApiRequest('{"id":"../../etc/passwd","call":"render"}', known);
  assert.ok("request" in odd);
  assert.equal(odd.request.id, "");
});

test("arguments are read within the bounds the call allows", () => {
  const args = { zoom: 22, name: "  Dhaka  ", on: "true", codes: "IND, BGD ,,JPN", count: "7" };
  assert.equal(numberArg(args, "zoom", 3, 0, 20), 20);
  assert.equal(numberArg(args, "count", 0), 7);
  assert.equal(numberArg(args, "missing", 5), 5);
  assert.equal(numberArg({ zoom: "abc" }, "zoom", 5), 5);
  assert.equal(textArg(args, "name"), "Dhaka");
  assert.equal(textArg(args, "missing", "Map"), "Map");
  assert.equal(flagArg(args, "on"), true);
  assert.equal(flagArg(args, "missing", true), true);
  assert.deepEqual(listArg(args, "codes"), ["IND", "BGD", "JPN"]);
  assert.deepEqual(listArg({ codes: ["IND", 7, null] }, "codes"), ["IND", "7"]);
  assert.equal(listArg({ codes: Array.from({ length: 300 }, (_, i) => `C${i}`) }, "codes", 10).length, 10);
});
