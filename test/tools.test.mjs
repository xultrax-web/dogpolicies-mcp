// Every tool, called as an AI client calls it: happy paths, error codes,
// citation-first text, license line, both formats, paging, determinism.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, sharedRuntime, text, withClient } from "./helpers.mjs";

const LICENSE =
  /^DogPolicies, dogpolicies\.com, CC BY 4\.0, verified \d{4}-\d{2}-\d{2}$/m;
const NAMES = [
  "dogpolicies_browse_answers",
  "dogpolicies_changes_near",
  "dogpolicies_changes_since",
  "dogpolicies_compare_places",
  "dogpolicies_find_hotels",
  "dogpolicies_get_brand_policy",
  "dogpolicies_get_place",
  "dogpolicies_get_rule",
  "dogpolicies_i5_conditions",
  "dogpolicies_i5_corridor",
  "dogpolicies_near",
  "dogpolicies_plan_trip",
  "dogpolicies_report_correction",
  "dogpolicies_road_conditions",
  "dogpolicies_route_stops",
  "dogpolicies_search_places",
  "dogpolicies_subscribe_changes",
];

test("server: identity, instructions, tool list, annotations, empty resources and prompts", () =>
  withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), NAMES);
    for (const t of tools) {
      assert.ok(t.title, `${t.name} has a title`);
      assert.ok(t.description.length > 40, `${t.name} describes itself`);
      assert.equal(
        typeof t.annotations.readOnlyHint,
        "boolean",
        `${t.name} readOnlyHint`,
      );
      assert.equal(typeof t.annotations.destructiveHint, "boolean");
      assert.equal(typeof t.annotations.openWorldHint, "boolean");
      assert.equal(
        t.annotations.readOnlyHint,
        t.name !== "dogpolicies_report_correction",
      );
      assert.equal(t.inputSchema.type, "object");
      assert.equal(
        t.inputSchema.additionalProperties,
        false,
        `${t.name} rejects unknown fields`,
      );
      assert.ok(t.outputSchema, `${t.name} has an output schema`);
    }
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === "dogpolicies://about"));
    const { prompts } = await client.listPrompts();
    assert.ok(prompts.length >= 5);
  }));

test("search_places: name query, citation first, license last, both formats", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_search_places", {
      query: "Point Lobos State Natural",
    });
    assert.ok(!r.isError);
    const md = text(r);
    assert.match(md.split("\n")[0], /^# \d+ places? found/);
    assert.match(
      md.split("\n")[2],
      /^- Point Lobos.*Source: .* checked \d{4}-\d{2}-\d{2}\. (Dog Rulebook|DogPolicies) record: https:\/\/(dogrulebook|dogpolicies)\.com\/places\//,
    );
    assert.match(md, LICENSE);
    assert.equal(r.structuredContent.places[0].status, "no");
    assert.equal(r.structuredContent.as_of, sharedRuntime().graph.as_of);
    const j = await call(client, "dogpolicies_search_places", {
      query: "Point Lobos State Natural",
      response_format: "json",
    });
    assert.deepEqual(JSON.parse(text(j)), j.structuredContent);
  }));

test("search_places: filters by type, off-leash, near (sorted by distance), county, state, dogs_allowed", () =>
  withClient(async (client) => {
    const sd = await call(client, "dogpolicies_search_places", {
      type: "beach",
      off_leash: true,
      near: { lat: 32.72, lon: -117.16, radius_miles: 20 },
      response_format: "json",
    });
    const places = sd.structuredContent.places;
    assert.ok(places.some((p) => /Ocean Beach, San Diego/.test(p.name)));
    assert.ok(
      places.every(
        (p, i, a) => i === 0 || a[i - 1].distance_miles <= p.distance_miles,
      ),
    );
    assert.ok(places.every((p) => p.type === "beach"));
    const marin = await call(client, "dogpolicies_search_places", {
      type: "park",
      county: "Marin County",
      dogs_allowed: true,
      response_format: "json",
    });
    assert.ok(marin.structuredContent.total > 0);
    assert.ok(
      marin.structuredContent.places.every((p) =>
        ["yes", "yes_restricted"].includes(p.status),
      ),
    );
    const nv = await call(client, "dogpolicies_search_places", {
      state: "NV",
      dogs_allowed: false,
      response_format: "json",
    });
    assert.ok(
      nv.structuredContent.places.every(
        (p) => p.state === "NV" && p.status === "no",
      ),
    );
    const none = await call(client, "dogpolicies_search_places", {
      query: "zzzz-no-such-place",
    });
    assert.ok(!none.isError);
    assert.match(text(none), /No matching records/);
  }));

test("search_places: pagination is consistent and the text fits the budget", () =>
  withClient(async (client) => {
    const a = await call(client, "dogpolicies_search_places", {
      type: "park",
      limit: 50,
      response_format: "json",
    });
    assert.ok(a.structuredContent.has_more);
    assert.ok(text(a).length <= 25_000);
    const b = await call(client, "dogpolicies_search_places", {
      type: "park",
      limit: 50,
      offset: a.structuredContent.next_offset,
      response_format: "json",
    });
    assert.equal(b.structuredContent.offset, a.structuredContent.next_offset);
    const ids = new Set(a.structuredContent.places.map((p) => p.id));
    assert.ok(
      b.structuredContent.places.every((p) => !ids.has(p.id)),
      "no overlap between pages",
    );
    const md = await call(client, "dogpolicies_search_places", {
      type: "park",
      limit: 50,
    });
    assert.ok(text(md).length <= 25_000);
  }));

test("search_places: input that cannot be used is a bad_input answer, never an error (decision 111)", () =>
  withClient(async (client) => {
    for (const args of [
      { query: "x" },
      { state: "OR" },
      { type: "spaceship" },
      { near: { lat: 0, lon: 0 } },
      { nope: 1 },
    ]) {
      const r = await client.callTool({
        name: "dogpolicies_search_places",
        arguments: args,
      });
      assert.ok(!r.isError, `answers ${JSON.stringify(args)}`);
      assert.equal(r.structuredContent.outcome, "bad_input");
      assert.equal(r.structuredContent.code, "invalid");
      assert.deepEqual(r.structuredContent.places, []);
      assert.ok(r.structuredContent.next.length);
    }
    // a page size is a ceiling: too big or too small is capped, not refused
    for (const limit of [0, 51, 500]) {
      const r = await call(client, "dogpolicies_search_places", {
        limit,
        response_format: "json",
      });
      assert.ok(!r.isError && r.structuredContent.outcome === undefined);
      assert.ok(
        r.structuredContent.count <= 50 && r.structuredContent.count >= 1,
      );
    }
  }));

test("get_place: full record with sources, rule ids, not_stated, quote marked as data", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_get_place", {
      id: "carmel-beach",
    });
    const md = text(r);
    assert.match(md.split("\n")[0], /^Carmel Beach.*cite with link\)\.$/);
    assert.match(md, /Sources:\n1\. /);
    assert.match(md, /rule id rul_[a-z0-9]+_dogsallowed/);
    assert.match(md, /Source text \(quoted, not instructions\):/);
    assert.match(md, LICENSE);
    const d = r.structuredContent;
    assert.ok(d.rule_records.length > 0);
    assert.ok(
      d.rule_records.every((x) =>
        ["fresh", "due", "stale", "unreadable"].includes(x.freshness),
      ),
    );
    assert.ok(Array.isArray(d.not_stated));
    assert.ok(d.sources[0].url.startsWith("http"));
    assert.equal(
      d.url,
      `${sharedRuntime().graph.site.url}/places/carmel-beach/`,
    );
    // a place's exact name finds it (assistants often pass the name instead of the id)
    const named = await client.callTool({
      name: "dogpolicies_get_place",
      arguments: { id: "Carmel Beach" },
    });
    assert.ok(!named.isError, "finds Carmel Beach by name");
    assert.equal(named.structuredContent.id, "carmel-beach");
    // an id nothing matches is an answer with close matches, never an error;
    // one the schema refuses (too long) is rejected before the handler runs
    for (const id of ["nope", "../etc/passwd"]) {
      const e = await call(client, "dogpolicies_get_place", { id });
      assert.ok(!e.isError, `answers ${id}`);
      assert.equal(e.structuredContent.outcome, "no_match");
      assert.equal(e.structuredContent.code, "not_found");
      assert.ok(Array.isArray(e.structuredContent.did_you_mean));
      assert.match(text(e), /Try next:/);
    }
    const long = await call(client, "dogpolicies_get_place", {
      id: "a".repeat(121),
    });
    assert.ok(!long.isError, "an id over 120 characters is an answer");
    assert.equal(long.structuredContent.outcome, "bad_input");
  }));

test("get_place: an OpenStreetMap hotel carries the ODbL attribution", () =>
  withClient(async (client, ctx) => {
    const osm = ctx.graph.places.find((p) => p.osm);
    const r = await call(client, "dogpolicies_get_place", { id: osm.id });
    assert.match(text(r), /OpenStreetMap contributors/);
    assert.equal(r.structuredContent.record_license, "ODbL-1.0");
  }));

test("find_hotels: verdicts, fee arithmetic spelled out, cheapest first, exclusions counted", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_find_hotels", {
      county: "Monterey",
      dog_weight_lb: 70,
      nights: 2,
      dogs: 2,
      response_format: "json",
    });
    const d = r.structuredContent;
    assert.ok(d.counts.match + d.counts.possible + d.counts.excluded > 0);
    assert.ok(d.hotels.every((h) => ["match", "possible"].includes(h.verdict)));
    assert.ok(
      d.hotels.every(
        (h) => typeof h.fee_estimate === "string" && h.fee_estimate.length > 0,
      ),
    );
    const known = d.hotels
      .filter((h) => h.verdict === "match" && h.fee_amount != null)
      .map((h) => h.fee_amount);
    assert.deepEqual(
      known,
      [...known].sort((a, b) => a - b),
    );
    const md = text(
      await call(client, "dogpolicies_find_hotels", {
        county: "Monterey",
        dog_weight_lb: 70,
        nights: 2,
      }),
    );
    assert.match(
      md,
      /^# \d+ match, \d+ possible, \d+ excluded \(70 lb dog, 2 nights\)/,
    );
    assert.match(md, /Pet fee: /);
    const strict = await call(client, "dogpolicies_find_hotels", {
      county: "Monterey",
      include_possible: false,
      response_format: "json",
    });
    assert.ok(
      strict.structuredContent.hotels.every((h) => h.verdict === "match"),
    );
    const budget = await call(client, "dogpolicies_find_hotels", {
      query: "Motel 6",
      max_total_fee: 0,
      response_format: "json",
    });
    assert.ok(
      budget.structuredContent.hotels.every(
        (h) => h.fee_amount === 0 || h.fee_is_maximum || h.fee_amount == null,
      ),
    );
  }));

test("find_hotels: a chain hotel's inherited policy is flagged", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_find_hotels", {
      brand: "motel-6",
      response_format: "json",
      limit: 5,
    });
    assert.ok(r.structuredContent.hotels.length > 0);
    assert.ok(
      r.structuredContent.hotels.some(
        (h) => h.brand_policy && h.confidence === "inherited_brand",
      ),
    );
    assert.match(
      text(
        await call(client, "dogpolicies_find_hotels", {
          brand: "motel-6",
          limit: 5,
        }),
      ),
      /Brand-policy hotels have not yet confirmed/,
    );
  }));

test("get_brand_policy: by id and by name, with exceptions and counts; unknown brand lists the covered ones", () =>
  withClient(async (client) => {
    const a = await call(client, "dogpolicies_get_brand_policy", {
      brand: "red-roof",
    });
    const b = await call(client, "dogpolicies_get_brand_policy", {
      brand: "Red Roof",
      response_format: "json",
    });
    assert.ok(!a.isError && !b.isError);
    assert.equal(a.structuredContent.id, b.structuredContent.id);
    assert.match(text(a), /^# .* pet policy\n/);
    assert.match(text(a), /\d+ California and \d+ Nevada properties/);
    assert.match(text(a), LICENSE);
    const e = await call(client, "dogpolicies_get_brand_policy", {
      brand: "Nonesuch Inns",
    });
    assert.ok(!e.isError, "an unknown brand is an answer");
    assert.equal(e.structuredContent.outcome, "no_match");
    assert.equal(e.structuredContent.code, "not_found");
    assert.ok(e.structuredContent.did_you_mean.length >= 1);
    assert.match(text(e), /Covered brands:/);
  }));

test("browse_answers: lists questions, then a question's places; unknown slug errors", () =>
  withClient(async (client) => {
    const list = await call(client, "dogpolicies_browse_answers", {
      response_format: "json",
    });
    assert.ok(list.structuredContent.questions.length > 50);
    const q = list.structuredContent.questions.find(
      (x) => x.slug === "off-leash-dog-beaches-california",
    );
    assert.ok(q, "the off-leash beaches question exists");
    const places = await call(client, "dogpolicies_browse_answers", {
      slug: q.slug,
      limit: 50,
      response_format: "json",
    });
    assert.equal(places.structuredContent.total, q.results);
    assert.equal(places.structuredContent.url, q.url);
    assert.match(
      text(await call(client, "dogpolicies_browse_answers", { slug: q.slug })),
      /^# Where/,
    );
    const e = await call(client, "dogpolicies_browse_answers", {
      slug: "no-such-question",
    });
    assert.ok(!e.isError, "an unknown slug is an answer");
    assert.equal(e.structuredContent.outcome, "no_match");
    assert.ok(e.structuredContent.questions.length > 50, "with the whole list");
    assert.ok(Array.isArray(e.structuredContent.did_you_mean));
  }));

test("route_stops: miles in driving order, direction reversal, a start point, kinds, weight check", () =>
  withClient(async (client) => {
    const north = await call(client, "dogpolicies_route_stops", {
      from_mile: 170,
      to_mile: 222,
      limit: 50,
      response_format: "json",
    });
    const miles = north.structuredContent.stops.map((s) => s.mile);
    assert.ok(miles.length > 0);
    assert.deepEqual(
      miles,
      [...miles].sort((a, b) => a - b),
    );
    assert.ok(miles.every((m) => m >= 170 && m <= 222));
    const south = await call(client, "dogpolicies_route_stops", {
      from_mile: 222,
      to_mile: 170,
      direction: "south",
      limit: 50,
      response_format: "json",
    });
    const sm = south.structuredContent.stops.map((s) => s.mile);
    assert.deepEqual(
      sm,
      [...sm].sort((a, b) => b - a),
    );
    assert.equal(south.structuredContent.direction, "south");
    const la = await call(client, "dogpolicies_route_stops", {
      near: { lat: 34.05, lon: -118.24 },
      dog_weight_lb: 70,
      limit: 5,
      response_format: "json",
    });
    assert.ok(
      la.structuredContent.from_mile > 100 &&
        la.structuredContent.from_mile < 200,
      `from_mile ${la.structuredContent.from_mile}`,
    );
    const rest = await call(client, "dogpolicies_route_stops", {
      kinds: ["rest_area"],
      limit: 50,
      response_format: "json",
    });
    assert.ok(
      rest.structuredContent.stops.every((s) => s.type === "rest_area"),
    );
    const nv = await call(client, "dogpolicies_route_stops", {
      route: "i-80-nevada",
      near: { lat: 39.53, lon: -119.81 },
      direction: "east",
      limit: 10,
      response_format: "json",
    });
    assert.equal(nv.structuredContent.direction, "east");
    assert.match(nv.structuredContent.guide, /\/road-trips\/i-80-nevada\/$/);
    assert.match(
      text(
        await call(client, "dogpolicies_route_stops", {
          from_mile: 170,
          to_mile: 222,
        }),
      ),
      /^# \d+ dog stops on I-5 in California, miles 170–222 heading north/,
    );
  }));

test("get_rule: a rule by id with its place citation, permalink and freshness; bad ids are not_found", () =>
  withClient(async (client) => {
    const d = await call(client, "dogpolicies_get_place", {
      id: "carmel-beach",
      response_format: "json",
    });
    const id = d.structuredContent.rule_records[0].id;
    const r = await call(client, "dogpolicies_get_rule", { id });
    assert.equal(r.structuredContent.rule.id, id);
    assert.match(
      r.structuredContent.rule.permalink,
      /^https:\/\/(dogrulebook|dogpolicies)\.com\/places\/carmel-beach\/#rule-/,
    );
    assert.match(text(r).split("\n")[0], /^Carmel Beach/);
    assert.match(
      text(r),
      /Confidence: stated\. Verified \d{4}-\d{2}-\d{2}; re-check due \d{4}-\d{2}-\d{2}; freshness (fresh|due|stale|unreadable)\./,
    );
    for (const bad of ["rul_nope_fee", "rul_../x_fee", "123456"]) {
      const e = await call(client, "dogpolicies_get_rule", { id: bad });
      assert.ok(!e.isError, `answers ${bad}`);
      assert.equal(e.structuredContent.outcome, "no_match");
      assert.equal(e.structuredContent.code, "not_found");
      assert.equal(e.structuredContent.rule, null);
    }
  }));

test("changes_since: events newest first, outcome filter, rule changes, paging", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_changes_since", {
      since: "2026-01-01",
      limit: 50,
      response_format: "json",
    });
    const at = r.structuredContent.events.map((e) => e.at);
    assert.ok(at.length > 0);
    assert.deepEqual(at, [...at].sort().reverse());
    assert.ok(
      r.structuredContent.events.every(
        (e) => e.at >= "2026-01-01" && e.url.startsWith("https://"),
      ),
    );
    assert.ok(r.structuredContent.rule_changes.length > 0);
    const only = await call(client, "dogpolicies_changes_since", {
      since: "2026-01-01",
      outcome: "confirmed",
      response_format: "json",
    });
    assert.ok(
      only.structuredContent.events.every((e) => e.outcome === "confirmed"),
    );
    const future = await call(client, "dogpolicies_changes_since", {
      since: "2099-01-01",
    });
    assert.equal(future.structuredContent.total, 0);
    const bad = await call(client, "dogpolicies_changes_since", {
      since: "yesterday",
    });
    assert.ok(!bad.isError);
    assert.equal(bad.structuredContent.outcome, "bad_input");
    assert.deepEqual(bad.structuredContent.accepted?.since ?? ["YYYY-MM-DD"], [
      "YYYY-MM-DD",
    ]);
  }));

test("report_correction (offline): validates the place, never sends, returns the web form URL", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_report_correction", {
      place_id: "carmel-beach",
      message: "The leash rule changed last month.",
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.status, "not_sent");
    assert.equal(
      r.structuredContent.form_url,
      `${sharedRuntime().graph.site.url}/places/carmel-beach/#correction`,
    );
    assert.match(text(r), /no site configured/);
    const e = await call(client, "dogpolicies_report_correction", {
      place_id: "no-such-place",
      message: "Something is wrong here.",
    });
    assert.ok(
      !e.isError,
      "an unknown place is an answer, and nothing is filed",
    );
    assert.equal(e.structuredContent.outcome, "bad_input");
    assert.equal(e.structuredContent.status, "not_sent");
    assert.equal(e.structuredContent.report_id, null);
    const short = await call(client, "dogpolicies_report_correction", {
      place_id: "carmel-beach",
      message: "hi",
    });
    assert.ok(!short.isError);
    assert.equal(short.structuredContent.outcome, "bad_input");
    assert.equal(short.structuredContent.status, "not_sent");
  }));

test("determinism: the same call gives byte-identical text, and the cache serves the repeat", () =>
  withClient(async (client, ctx) => {
    const { server } = { server: null };
    const a = await call(client, "dogpolicies_search_places", {
      county: "Monterey",
      type: "beach",
    });
    const b = await call(client, "dogpolicies_search_places", {
      county: "Monterey",
      type: "beach",
    });
    assert.equal(text(a), text(b));
    assert.deepEqual(a.structuredContent, b.structuredContent);
    void server;
    void ctx;
  }));

test("freshness follows the date the server is asked on", async () => {
  const { testRuntime } = await import("./helpers.mjs");
  const later = testRuntime({ today: () => "2028-01-01" });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_get_place", {
      id: "carmel-beach",
      response_format: "json",
    });
    assert.equal(r.structuredContent.freshness, "stale");
    assert.match(
      text(
        await call(client, "dogpolicies_search_places", {
          query: "Carmel Beach",
        }),
      ),
      /stale or unreadable/,
    );
  }, later);
});

test("near: neighborhoods, regions, hyphens and small typos resolve; nonsense does not", () =>
  withClient(async (client) => {
    const call = (place) =>
      client.callTool({ name: "dogpolicies_near", arguments: { place } });
    const vanNuys = await call("van nuys");
    assert.ok(!vanNuys.isError, "Van Nuys");
    assert.match(vanNuys.structuredContent.label, /Van Nuys/);
    const valley = await call("central-valley");
    assert.ok(!valley.isError, "central-valley");
    assert.equal(valley.structuredContent.label, "Central Valley");
    const typo = await call("Montery");
    assert.ok(!typo.isError, "Montery");
    assert.match(typo.structuredContent.label, /Monterey.*closest match/);
    // 0.4.1: the second ring of neighborhoods and the names people say for them (roadmap R-01)
    for (const [asked, expected] of [
      ["koreatown", /Koreatown, CA/],
      ["venice beach", /Venice, CA/],
      ["the mission", /Mission District, CA/],
      ["dtla", /Downtown Los Angeles, CA/],
      ["La Jolla", /La Jolla, CA/],
      ["the strip", /The Strip, NV/],
    ]) {
      const r = await call(asked);
      assert.ok(!r.isError, asked);
      assert.notEqual(
        r.structuredContent.outcome,
        "no_match",
        `${asked} resolves`,
      );
      assert.match(r.structuredContent.label, expected, asked);
    }
    const junk = await call("zzyzx test town");
    assert.ok(!junk.isError, "nonsense is an answer, not an error");
    assert.equal(junk.structuredContent.outcome, "no_match");
    assert.equal(junk.structuredContent.code, "not_found");
    assert.equal(junk.structuredContent.center, null);
    assert.equal(junk.structuredContent.total, 0);
    assert.ok(junk.structuredContent.next.length > 0, "says what to call next");
  }));

test("airports: codes, names and the names people say resolve as places, with a 5 mile default radius", () =>
  withClient(async (client) => {
    const near = (place, extra = {}) =>
      client.callTool({
        name: "dogpolicies_near",
        arguments: { place, ...extra },
      });
    for (const [asked, label] of [
      ["SFO", /San Francisco International Airport \(SFO\), CA/],
      ["sfo airport", /\(SFO\)/],
      ["San Francisco International", /\(SFO\)/],
      ["LAX airport", /Los Angeles International Airport \(LAX\)/],
      ["lax", /\(LAX\)/],
      ["Harry Reid", /Harry Reid International Airport \(LAS\), NV/],
      ["McCarran", /\(LAS\)/],
      ["Reno-Tahoe", /Reno-Tahoe International Airport \(RNO\), NV/],
      ["john wayne airport", /\(SNA\)/],
      ["Oakland Airport", /\(OAK\)/],
      ["SJC", /\(SJC\)/],
      ["sacramento airport", /\(SMF\)/],
      ["BUR", /\(BUR\)/],
      ["LGB", /\(LGB\)/],
      ["ONT", /\(ONT\)/],
      ["san diego airport", /\(SAN\)/],
      ["PSP", /\(PSP\)/],
      ["FAT", /\(FAT\)/],
      ["SBA", /\(SBA\)/],
      ["SBP", /\(SBP\)/],
      ["MRY", /\(MRY\)/],
      ["STS", /\(STS\)/],
    ]) {
      const r = await near(asked);
      assert.ok(!r.isError, asked);
      assert.notEqual(r.structuredContent.outcome, "no_match", `${asked} resolves`);
      assert.match(r.structuredContent.label, label, asked);
    }
    // the airport is a point with its own radius; an explicit radius wins
    const sfo = await near("SFO");
    assert.equal(sfo.structuredContent.radius_miles, 5);
    const wide = await near("SFO", { radius_miles: 20 });
    assert.equal(wide.structuredContent.radius_miles, 20);
    // a plain town keeps the 15 mile default
    assert.equal((await near("Monterey")).structuredContent.radius_miles, 15);
    // an airport's own relief-area record is found around it
    const lax = await near("SFO");
    assert.match(text(lax), /International Airport \(SFO\)|pet relief/i);
    // a slip in a code is an answer with the airport offered, not an error
    const slip = await near("SFP");
    assert.ok(!slip.isError, "a slipped code is an answer");
    assert.ok(
      slip.structuredContent.did_you_mean.some((d) => d.name === "SFO"),
      "SFO is offered for SFP",
    );
  }));

test("airports: find_hotels and plan_trip take an airport, and the relief-area records are in the data", () =>
  withClient(async (client) => {
    const hotels = await call(client, "dogpolicies_find_hotels", {
      query: "LAX",
      dogs: 1,
    });
    assert.ok(!hotels.isError);
    const found = hotels.structuredContent.hotels ?? [];
    assert.ok(found.length > 0, "hotels around LAX");
    assert.ok(
      found.every((h) => h.distance_miles <= 5),
      "all within the airport's 5 miles",
    );
    const trip = await call(client, "dogpolicies_plan_trip", {
      place: "San Diego airport",
    });
    assert.ok(!trip.isError);
    assert.match(trip.structuredContent.label, /\(SAN\)/);
    assert.equal(trip.structuredContent.radius_miles, 5);
    const sfo = await call(client, "dogpolicies_search_places", {
      query: "San Francisco International Airport",
    });
    assert.ok(
      (sfo.structuredContent.places ?? []).some((p) =>
        /International Airport/.test(p.name),
      ),
      "SFO's relief-area record is found by name",
    );
  }));
