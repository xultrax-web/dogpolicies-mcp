// Seasonal dog rules as state (roadmap R-23): get_place, near and
// search_places return `today` for a place with seasonal rules, computed with
// the server's date (pinned to 2026-10-31 in tests), and the answer and
// citation lead with a seasonal rule in effect or starting within 14 days.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, testRuntime, text, withClient } from "./helpers.mjs";
import { seasonNow } from "../src/dogpolicies/vendor/season.mjs";

const get = (client, id) =>
  call(client, "dogpolicies_get_place", { id, response_format: "json" });

test("get_place: a seasonal rule in effect today leads the answer and the citation", () =>
  withClient(async (client) => {
    const r = (await get(client, "ocean-beach-san-francisco"))
      .structuredContent;
    const lead =
      "Today (until May 15): dogs must be leashed in the Snowy Plover Protection Area, from Stairwell 21 south to Sloat Boulevard, per the National Park Service.";
    assert.equal(r.today.date, "2026-10-31", "the server's date");
    assert.equal(r.today.in_season, true);
    assert.equal(r.today.sentence, lead);
    assert.equal(r.today.in_effect[0].starts, "2026-07-01");
    assert.equal(r.today.in_effect[0].ends, "2027-05-15");
    assert.equal(r.today.in_effect[0].leash, "required");
    assert.equal(r.today.next.starts, "2027-07-01");
    assert.match(r.today.source_url, /^https:\/\/www\.nps\.gov\//);
    assert.ok(r.today.quote.includes("July1 - May 15"));
    assert.ok(r.answer.startsWith(`${lead} Yes, with restrictions.`));
    assert.ok(
      r.citation.startsWith(
        `Ocean Beach (San Francisco) (San Francisco, CA): ${lead} Yes`,
      ),
    );
    assert.ok(r.facts.some((f) => f.label === "Seasonal rules"));
    assert.ok(r.rule_records.some((x) => x.kind === "seasons"));
    const md = text(
      await call(client, "dogpolicies_get_place", {
        id: "ocean-beach-san-francisco",
      }),
    );
    assert.ok(
      md.startsWith(
        "Ocean Beach (San Francisco) (San Francisco, CA): Today (until May 15):",
      ),
    );
    assert.ok(md.includes(`**${r.answer}**`));
  }));

test("get_place: a season starting within 14 days says so; one far off is only `next`", () =>
  withClient(async (client) => {
    const ski = (await get(client, "burton-creek-state-park"))
      .structuredContent;
    assert.equal(ski.today.in_season, false);
    assert.equal(ski.today.starts_soon[0].in_days, 1);
    assert.ok(
      ski.answer.startsWith(
        "Starting November 1 (until May 1): no dogs on the designated Nordic ski trails when snow is present, per the California Department of Parks and Recreation.",
      ),
    );
    const fiesta = (await get(client, "fiesta-island")).structuredContent;
    assert.equal(fiesta.today.in_season, false);
    assert.equal(fiesta.today.sentence, null);
    assert.deepEqual(fiesta.today.starts_soon, []);
    assert.equal(fiesta.today.next.starts, "2027-04-15");
    assert.ok(
      !fiesta.answer.includes("Today ("),
      "the year-round answer alone",
    );
    const md = text(
      await call(client, "dogpolicies_get_place", { id: "fiesta-island" }),
    );
    assert.match(
      md,
      /No seasonal rule is in effect on 2026-10-31\. Next: April 15 to September 15 \(starts 2027-04-15\)/,
    );
  }));

test("near and search_places carry `today` on seasonal places only", () =>
  withClient(async (client) => {
    const near = (
      await call(client, "dogpolicies_near", {
        place: "Del Mar",
        types: ["beach"],
        per_type: 20,
        response_format: "json",
      })
    ).structuredContent;
    const items = near.groups.flatMap((g) => g.places);
    const north = items.find((p) => p.id === "del-mar-north-beach");
    assert.ok(north, "Del Mar's North Beach is near Del Mar");
    assert.equal(north.today.in_season, true);
    assert.ok(
      north.answer.startsWith(
        "Today (until June 15): dogs may be off leash under voice control, per the City of Del Mar.",
      ),
    );
    for (const p of items.filter(
      (p) => !["del-mar-north-beach", "del-mar-main-beach"].includes(p.id),
    ))
      if (!p.today)
        assert.ok(!p.answer.startsWith("Today ("), `${p.id} has no lead`);
    const search = (
      await call(client, "dogpolicies_search_places", {
        query: "Crissy Field",
        response_format: "json",
      })
    ).structuredContent;
    const crissy = search.places.find((p) => p.id === "crissy-field");
    assert.equal(crissy.today.in_effect[0].ends, "2027-05-15");
    assert.ok(
      crissy.citation.includes(
        "Today (until May 15): dogs must be leashed in the Crissy Field Wildlife Protection Area",
      ),
    );
    const plain = (
      await call(client, "dogpolicies_search_places", {
        query: "Carmel Beach",
        response_format: "json",
      })
    ).structuredContent.places.find((p) => p.id === "carmel-beach");
    assert.ok(
      plain && !("today" in plain),
      "a place without seasonal rules has no today",
    );
  }));

test("`today` follows the server's date: Ocean Beach between May 16 and June 30 has no lead", async () => {
  const ctx = testRuntime({ today: () => "2027-06-01" });
  await withClient(async (client) => {
    const r = (await get(client, "ocean-beach-san-francisco"))
      .structuredContent;
    assert.equal(r.today.date, "2027-06-01");
    assert.equal(r.today.in_season, false);
    assert.equal(r.today.sentence, null);
    assert.equal(r.today.next.starts, "2027-07-01");
    assert.equal(r.today.next.in_days, 30);
    assert.ok(r.answer.startsWith("Yes, with restrictions."));
  }, ctx);
  // The snapshot itself stores nothing date-dependent: the year-round answer.
  const p = ctx.graph.placeById.get("ocean-beach-san-francisco");
  assert.ok(!p.answer.includes("Today ("));
  assert.ok(!p.citation.includes("Today ("));
  assert.equal(seasonNow(p, "2027-06-01").active.length, 0);
  assert.equal(seasonNow(p, "2027-07-01").active.length, 1);
});
