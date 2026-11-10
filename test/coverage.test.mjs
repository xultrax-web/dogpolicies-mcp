// Places outside California and Nevada and off-topic questions are answers
// (proposed decision 124): outcome no_match with code out_of_coverage or
// off_topic, never isError, never unrelated California towns; covered names win.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, withClient } from "./helpers.mjs";

const ask = (c, tool, args) =>
  call(c, `dogpolicies_${tool}`, args).then((r) => {
    assert.ok(!r.isError, `${tool} ${JSON.stringify(args)} isError`);
    return r.structuredContent;
  });

test("a place outside California and Nevada is out_of_coverage in every place tool", () =>
  withClient(async (c) => {
    for (const [tool, args, named] of [
      ["search_places", { query: "hotels in lisbon" }, "Lisbon, Portugal"],
      ["find_hotels", { query: "hotels in lisbon" }, "Lisbon, Portugal"],
      ["near", { place: "Portland, OR" }, "Portland, Oregon"],
      ["near", { place: "Phoenix" }, "Phoenix, Arizona"],
      ["near", { place: "Hawaii" }, "Hawaii"],
      ["near", { place: "New Mexico" }, "New Mexico"],
      ["near", { place: "Mexico" }, "Mexico"],
      ["near", { place: "Paris" }, "Paris, France"],
      ["near", { place: "Berlin" }, "Berlin, Germany"],
      ["near", { place: "Lebanon" }, "Lebanon"],
      ["plan_trip", { place: "Tokyo" }, "Tokyo, Japan"],
      ["changes_near", { place: "Phoenix", since: "2026-01-01" }, "Phoenix"],
      ["get_place", { id: "tokyo" }, "Tokyo, Japan"],
      ["search_places", { query: "dog parks in Mexican Hat" }, "Mexican Hat, Utah"],
    ]) {
      const s = await ask(c, tool, args);
      assert.equal(s.outcome, "no_match", `${tool} ${JSON.stringify(args)}`);
      assert.equal(s.code, "out_of_coverage", `${tool} ${JSON.stringify(args)}`);
      assert.ok(s.message.startsWith(named), s.message);
      assert.match(s.message, /California and Nevada/);
      assert.ok(!s.did_you_mean?.length || tool === "near", "no unrelated towns offered");
      assert.ok(s.next.length >= 1);
    }
  }));

test("near the state line, the closest covered towns come with the answer", () =>
  withClient(async (c) => {
    for (const [place, town] of [
      ["Medford, OR", "Yreka"],
      ["Yuma", "Winterhaven"],
      ["Lake Havasu", "Needles"],
      ["St. George, UT", "Mesquite"],
    ]) {
      const s = await ask(c, "plan_trip", { place });
      assert.equal(s.code, "out_of_coverage", place);
      assert.ok(s.nearest.some((t) => t.name === town), `${place}: ${JSON.stringify(s.nearest)}`);
      // near keeps place records in nearest: the towns are in did_you_mean
      const n = await ask(c, "near", { place });
      assert.ok(n.did_you_mean.some((t) => t.name === town), place);
      assert.ok(!n.nearest, "near's nearest holds place records only");
    }
  }));

test("off-topic questions say what DogPolicies answers, with two example questions", () =>
  withClient(async (c) => {
    for (const query of ["cheap flights to tokyo", "car rental", "weather", "cheap"]) {
      const s = await ask(c, "search_places", { query });
      assert.equal(s.outcome, "no_match", query);
      assert.equal(s.code, "off_topic", query);
      assert.match(s.message, /where dogs are allowed in California and Nevada/);
      assert.equal(s.next.length, 2);
      assert.equal(s.places.length, 0);
    }
    const s = await ask(c, "search_places", { query: "cheap flights to tokyo" });
    assert.match(s.message, /Tokyo, Japan is also outside its coverage/);
  }));

test("covered names never trip the gazetteer", () =>
  withClient(async (c) => {
    for (const place of ["Dublin", "Washington", "Reno, NV", "Ontario", "Richmond", "Columbia", "Manchester"]) {
      const s = await ask(c, "near", { place });
      assert.notEqual(s.code, "out_of_coverage", place);
      assert.ok(s.total > 0, place);
    }
    for (const place of ["Oregon House", "Georgetown", "Portola", "Ashland"]) {
      const s = await ask(c, "near", { place });
      assert.notEqual(s.code, "out_of_coverage", place);
    }
    for (const query of ["Washington Street", "Oregon House", "Dublin"]) {
      const s = await ask(c, "search_places", { query });
      assert.notEqual(s.code, "out_of_coverage", query);
    }
    const dublin = await ask(c, "search_places", { query: "Dublin" });
    assert.ok(dublin.total > 0);
    const ireland = await ask(c, "near", { place: "Dublin, Ireland" });
    assert.equal(ireland.code, "out_of_coverage");
  }));
