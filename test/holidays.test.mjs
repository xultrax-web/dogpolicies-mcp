// Meals and dated holiday hours (decision 139): search_places filters restaurants by the meal they state
// and by a day they are open; emergency_vet carries a hospital's upcoming holiday hours. A date that has
// passed (the server's date is pinned to 2026-10-31 in tests) is never shown and never matches. The
// tests clear the real meals and holiday hours from a copy of the bundled snapshot and set their own,
// so the expected lists do not move when the data grows.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { call, testRuntime, text, withClient } from "./helpers.mjs";

const DAY = "2026-11-26";
const snapshot = () =>
  JSON.parse(
    gunzipSync(
      readFileSync(new URL("../data/snapshot.json.gz", import.meta.url)),
    ),
  );

function withHolidays() {
  const s = snapshot();
  for (const p of s.places) {
    delete p.facts.meals;
    delete p.facts.holidays;
  }
  for (const v of s.vets) delete v.holidays;
  const set = (id, meals, holidays) => {
    const p = s.places.find((x) => x.id === id);
    assert.ok(p, id);
    p.facts.meals = { value: meals };
    if (holidays) p.facts.holidays = { value: holidays };
  };
  set("tahoe-tap-haus-tahoe-city", ["breakfast", "lunch", "dinner"], [
    { date: DAY, holiday: "Thanksgiving", open: true, hours: "11 am to 8 pm" },
    { date: "2026-10-01", open: true, hours: "past" },
  ]);
  set("spoon-restaurant-tahoe-city", ["dinner"], [
    { date: DAY, holiday: "Thanksgiving", open: false },
  ]);
  set("fat-cat-bar-and-grill-tahoe-city", ["breakfast", "brunch"], null);
  const vet = s.vets.find((v) => v.id === "animal-emergency-and-specialty-center-reno");
  assert.ok(vet);
  vet.holidays = [
    { date: DAY, holiday: "Thanksgiving", open: true, hours: "24 hours", source_url: vet.source_url },
    { date: "2026-10-02", open: false, source_url: vet.source_url },
  ];
  return s;
}
const rt = () => testRuntime({ snapshot: withHolidays() });

const names = (r) => r.structuredContent.places.map((p) => p.id).sort();

test("search_places filters restaurants by the meal they state", () =>
  withClient(async (c) => {
    const r = await call(c, "dogpolicies_search_places", {
      type: "restaurant",
      meal: "breakfast",
      area: "lake-tahoe",
      response_format: "json",
    });
    assert.deepEqual(names(r), ["fat-cat-bar-and-grill-tahoe-city", "tahoe-tap-haus-tahoe-city"]);
    const tap = r.structuredContent.places.find((p) => p.id === "tahoe-tap-haus-tahoe-city");
    assert.deepEqual(tap.meals, ["breakfast", "lunch", "dinner"]);
    const dinner = await call(c, "dogpolicies_search_places", {
      type: "restaurant",
      meal: "dinner",
      area: "lake-tahoe",
      response_format: "json",
    });
    assert.deepEqual(names(dinner), ["spoon-restaurant-tahoe-city", "tahoe-tap-haus-tahoe-city"]);
  }, rt()));

test("search_places open_on keeps places whose own page says open that day, with the hours", () =>
  withClient(async (c) => {
    const r = await call(c, "dogpolicies_search_places", {
      type: "restaurant",
      open_on: DAY,
      area: "lake-tahoe",
      dogs_allowed: true,
      response_format: "json",
    });
    assert.deepEqual(names(r), ["tahoe-tap-haus-tahoe-city"]);
    const [tap] = r.structuredContent.places;
    // only the day that has not passed is carried
    assert.deepEqual(tap.holiday_hours, [
      { date: DAY, holiday: "Thanksgiving", open: true, hours: "11 am to 8 pm" },
    ]);
  }, rt()));

test("a day that has passed matches nothing and says so", () =>
  withClient(async (c) => {
    const r = await call(c, "dogpolicies_search_places", {
      type: "restaurant",
      open_on: "2026-10-01",
      area: "lake-tahoe",
      response_format: "json",
    });
    assert.equal(r.structuredContent.outcome, "no_match");
    assert.match(r.structuredContent.message, /that day has passed/);
    assert.ok(r.structuredContent.next.some((n) => /Drop meal or open_on/.test(n)));
  }, rt()));

test("a restaurant with no meals or holiday facts is neither matched nor given empty fields", () =>
  withClient(async (c) => {
    const r = await call(c, "dogpolicies_search_places", {
      query: "Crosby",
      response_format: "json",
    });
    const p = r.structuredContent.places[0];
    assert.equal(p.meals, undefined);
    assert.equal(p.holiday_hours, undefined);
  }, rt()));

test("emergency_vet carries a hospital's upcoming holiday hours and not the ones that have passed", () =>
  withClient(async (c) => {
    const r = await call(c, "dogpolicies_emergency_vet", { place: "Reno", limit: 3, response_format: "json" });
    const vet = r.structuredContent.vets.find((v) => v.id === "animal-emergency-and-specialty-center-reno");
    assert.deepEqual(vet.holiday_hours, [
      { date: DAY, holiday: "Thanksgiving", open: true, hours: "24 hours" },
    ]);
    const others = r.structuredContent.vets.filter((v) => v.id !== vet.id);
    assert.ok(others.every((v) => v.holiday_hours === undefined));
    const md = text(await call(c, "dogpolicies_emergency_vet", { place: "Reno", limit: 3 }));
    assert.match(md, /Thanksgiving: open, 24 hours/);
    assert.doesNotMatch(md, /2026-10-02/);
  }, rt()));
