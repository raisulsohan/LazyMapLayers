import { strict as assert } from "node:assert";
import test from "node:test";
import { chooseWithShares } from "../../src/core/labels/budget.ts";

test("a city map gets some of each kind, not only the kind that ranks first", () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `street${i}`, priority: 60 + i * 0.1, share: "street" })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `landmark${i}`, priority: 70 + i * 0.1, share: "landmark" })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `district${i}`, priority: 55 + i, share: "district" }))
  ];
  const kept = chooseWithShares(items, 20);
  assert.equal(kept.length, 20);
  const count = (prefix: string) => kept.filter((id) => id.startsWith(prefix)).length;
  // Every kind within its share first (6, 6 and 5), then the three places left go to the best of the rest.
  assert.ok(count("district") >= 6 && count("street") >= 6 && count("landmark") === 5, kept.join(","));
  assert.equal(count("district") + count("street"), 15);
});

test("the names of the world take what they need, and go first", () => {
  const items = [
    { id: "paris", priority: 5, share: null },
    { id: "seine", priority: 58, share: "cityWater" },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `street${i}`, priority: 62 + i, share: "street" }))
  ];
  const kept = chooseWithShares(items, 5);
  assert.deepEqual(kept, ["paris", "seine", "street0", "street1", "street2"]);
});
