import { strict as assert } from "node:assert";
import test from "node:test";
import { canRemoveRender } from "../../src/core/render/renderDiskRules.ts";

test("only the frames nothing can reach again may be removed", () => {
  // A map of the project that is open: its comp holds the footage right now.
  assert.equal(canRemoveRender({ ofThisProject: true, claimedProject: null, claimedProjectExists: false }), false);
  assert.equal(canRemoveRender({ ofThisProject: true, claimedProject: "C:/work/city.aep", claimedProjectExists: true }), false);
  // Rendered before the project was saved, so the frames stayed in the data folder: the project is
  // on disk and its comp still points at them.
  assert.equal(canRemoveRender({ ofThisProject: false, claimedProject: "C:/work/city.aep", claimedProjectExists: true }), false);
  // The project was thrown away: nothing points at these any more.
  assert.equal(canRemoveRender({ ofThisProject: false, claimedProject: "C:/work/gone.aep", claimedProjectExists: false }), true);
  // Never saved and no longer open: an unsaved project cannot be opened again.
  assert.equal(canRemoveRender({ ofThisProject: false, claimedProject: null, claimedProjectExists: false }), true);
});
