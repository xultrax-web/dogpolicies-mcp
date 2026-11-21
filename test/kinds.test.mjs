// A place of one kind that is also another (alsoTypes: a campground that also
// rents cabins) is found by a search for either kind, sits in one group only,
// and says so in the structured output.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isAnyKind, isKind } from "../src/dogpolicies/stay.mjs";
import { call, withClient } from "./helpers.mjs";

const ids = (xs) => xs.map((p) => p.id);

test("isKind reads the place's own type and the kinds it also is", () => {
  const p = { type: "campground", alsoTypes: ["cabins"] };
  assert.equal(isKind(p, "campground"), true);
  assert.equal(isKind(p, "cabins"), true);
  assert.equal(isKind(p, "lodging"), false);
  assert.equal(isKind({ type: "cabins" }, "campground"), false);
  assert.equal(isAnyKind(p, ["lodging", "cabins"]), true);
  assert.equal(isAnyKind(p, ["lodging"]), false);
});

test("search_places type=cabins finds campgrounds that also rent cabins, and says so", async () => {
  await withClient(async (c) => {
    const r = await call(c, "dogpolicies_search_places", {
      type: "cabins",
      county: "Alpine",
    });
    const places = r.structuredContent.places;
    for (const id of [
      "carson-river-resort",
      "caples-lake-resort",
      "desolation-hotel-hope-valley",
    ])
      assert.ok(ids(places).includes(id), id);
    const crr = places.find((p) => p.id === "carson-river-resort");
    assert.equal(crr.type, "campground");
    assert.deepEqual(crr.also_types, ["cabins"]);
    assert.equal(
      places.find((p) => p.id === "caples-lake-resort").also_types,
      undefined,
    );
  });
});

test("near puts a place in one group: its own kind's, or the kind asked for", async () => {
  await withClient(async (c) => {
    const all = await call(c, "dogpolicies_near", {
      place: "Markleeville",
      radius_miles: 15,
    });
    const groupsWith = all.structuredContent.groups.filter((g) =>
      ids(g.places ?? g.items ?? []).includes("carson-river-resort"),
    );
    assert.deepEqual(
      groupsWith.map((g) => g.type),
      ["campground"],
    );
    const cabins = await call(c, "dogpolicies_near", {
      place: "Markleeville",
      types: ["cabins"],
      radius_miles: 30,
    });
    const [g] = cabins.structuredContent.groups;
    assert.equal(g.type, "cabins");
    assert.ok(ids(g.places ?? g.items ?? []).includes("carson-river-resort"));
  });
});
