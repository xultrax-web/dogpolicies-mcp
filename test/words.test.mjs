// Text queries match word starts, not substrings (2026-11-09): find_hotels for "Reno" answered
// Motel 6 Moreno Valley first, because "reno" is inside "moreno".

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, withClient } from "./helpers.mjs";
import { matchesText } from "../src/dogpolicies/tools/common.mjs";

const place = (name, city, county = "", brand = "") => ({ name, city, county, brand });

test("matchesText: word starts match, the middle of a word does not", () => {
  assert.equal(matchesText(place("Motel 6 Moreno Valley, CA - Perris", "Moreno Valley"), "Reno"), false);
  assert.equal(matchesText(place("Motel 6, Reno", "Reno"), "Reno"), true);
  assert.equal(matchesText(place("Cypress Inn", "Carmel-by-the-Sea"), "carm"), true);
  assert.equal(matchesText(place("Cypress Inn", "Carmel-by-the-Sea"), "Carmel-by-the-Sea"), true);
  assert.equal(matchesText(place("Motel 6 Fresno", "Fresno", "", "Motel 6"), "motel 6 fresno"), true);
  assert.equal(matchesText(place("Rosie's Dog Beach", "Long Beach"), "rosie's"), true);
  assert.equal(matchesText(place("Sacramento Inn", "Sacramento"), "mento"), false);
  assert.equal(matchesText(place("Anything", "Anywhere"), ""), true);
});

test("find_hotels: a Reno query answers Reno hotels, never Moreno Valley", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_find_hotels", {
      query: "Reno",
      response_format: "json",
    });
    assert.ok(!r.isError);
    const all = r.structuredContent.hotels ?? [];
    assert.ok(all.length > 0, "Reno has hotels in the data");
    assert.ok(
      all.every((h) => !/Moreno/i.test(`${h.name} ${h.city}`)),
      "no Moreno Valley hotel in a Reno answer",
    );
  }));
