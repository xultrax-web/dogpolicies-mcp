// No dead ends: what a tool answers when the data has no match. Every case
// goes through the client, so the SDK's output validation runs on each
// answer: a no-match answer that did not fit its tool's schema would throw.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  call,
  sharedRuntime,
  testRuntime,
  text,
  withClient,
} from "./helpers.mjs";
import { miles } from "../src/core/geo.mjs";

test("near: an unknown name answers with close matches and next steps, schema intact", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_near", {
      place: "Tahoe City Pines",
      response_format: "json",
    });
    assert.ok(!r.isError);
    const d = r.structuredContent;
    assert.equal(d.outcome, "no_match");
    assert.equal(d.code, "not_found");
    assert.equal(d.center, null);
    assert.equal(d.label, "Tahoe City Pines");
    assert.deepEqual(d.groups, []);
    assert.ok(
      d.did_you_mean.some((t) => /Tahoe/.test(t.name)),
      "a Tahoe town is suggested",
    );
    assert.ok(
      d.next.some((s) => /place=/.test(s)),
      "next names a call to make",
    );
    assert.ok(d.as_of, "the envelope is there");
    const md = text(
      await call(client, "dogpolicies_near", { place: "Tahoe City Pines" }),
    );
    assert.match(md, /^# No place named "Tahoe City Pines"/);
    assert.match(md, /Did you mean:/);
    assert.match(md, /Try next:/);
  }));

test("near: nothing inside the radius widens it and says so; nothing within 100 miles lists the nearest anyway", () =>
  withClient(async (client) => {
    // 20 miles inland of Carmel Beach: no beach within 5, some within 30.
    const widened = await call(client, "dogpolicies_near", {
      near: { lat: 36.55, lon: -121.57 },
      radius_miles: 5,
      types: ["beach"],
      response_format: "json",
    });
    assert.ok(!widened.isError);
    assert.notEqual(widened.structuredContent.outcome, "no_match");
    assert.equal(widened.structuredContent.radius_widened_from, 5);
    assert.ok(widened.structuredContent.radius_miles > 5);
    assert.ok(widened.structuredContent.groups[0].places.length > 0);
    assert.match(
      text(
        await call(client, "dogpolicies_near", {
          near: { lat: 36.55, lon: -121.57 },
          radius_miles: 5,
          types: ["beach"],
        }),
      ),
      /widened to \d+/,
    );
    // A point with nothing of any kind within 100 miles: found from the data,
    // so the test holds as coverage grows (it skips that half if none is left).
    const ctx = sharedRuntime();
    const candidates = [
      { lat: 38.5, lon: -117.5 },
      { lat: 41.9, lon: -114.3 },
      { lat: 37.3, lon: -115.2 },
      { lat: 40.9, lon: -117.9 },
      { lat: 35.2, lon: -115.1 },
    ];
    const far = candidates.find(
      (c) =>
        Math.min(
          ...ctx.graph.places.filter((p) => p.geo).map((p) => miles(c, p.geo)),
        ) > 100,
    );
    if (!far) return;
    const desert = await call(client, "dogpolicies_near", {
      near: far,
      radius_miles: 5,
      response_format: "json",
    });
    assert.ok(!desert.isError);
    const d = desert.structuredContent;
    assert.equal(d.outcome, "no_match");
    assert.deepEqual(d.center, far);
    assert.equal(d.groups.length, 0);
    assert.equal(d.nearest.length, 5);
    assert.ok(
      d.nearest.every(
        (p, i, a) => i === 0 || a[i - 1].distance_miles <= p.distance_miles,
      ),
      "nearest first",
    );
    assert.ok(d.nearest[0].distance_miles > 5);
    assert.ok(d.did_you_mean.length > 0, "the nearest towns with records");
    assert.match(
      text(
        await call(client, "dogpolicies_near", { near: far, radius_miles: 5 }),
      ),
      /Nearest in the data instead:/,
    );
  }));

test("search_places: no match carries close matches and next steps; a typo finds the place", () =>
  withClient(async (client) => {
    const none = await call(client, "dogpolicies_search_places", {
      query: "zzyzx test town",
      response_format: "json",
    });
    assert.ok(!none.isError);
    assert.equal(none.structuredContent.total, 0);
    assert.equal(none.structuredContent.outcome, "no_match");
    assert.ok(none.structuredContent.next.length > 0);
    const typo = await call(client, "dogpolicies_search_places", {
      query: "Carmel Beech",
      response_format: "json",
    });
    assert.equal(typo.structuredContent.total, 0);
    assert.equal(typo.structuredContent.did_you_mean[0].id, "carmel-beach");
    assert.match(
      text(
        await call(client, "dogpolicies_search_places", {
          query: "Carmel Beech",
        }),
      ),
      /Did you mean:[\s\S]*carmel-beach/,
    );
    // a town in the query points to near
    const town = await call(client, "dogpolicies_search_places", {
      query: "Monterey",
      type: "cabins",
      off_leash: true,
      response_format: "json",
    });
    if (town.structuredContent.total === 0)
      assert.ok(
        town.structuredContent.next.some((s) => /dogpolicies_near/.test(s)),
      );
  }));

test("get_place: a near miss resolves to the one clear match and says so; nothing close is a no_match answer", () =>
  withClient(async (client) => {
    const close = await call(client, "dogpolicies_get_place", {
      id: "carmel-beech",
      response_format: "json",
    });
    assert.ok(!close.isError);
    assert.equal(close.structuredContent.id, "carmel-beach");
    assert.equal(close.structuredContent.resolved_from, "carmel-beech");
    assert.equal(close.structuredContent.outcome, undefined);
    assert.match(
      text(await call(client, "dogpolicies_get_place", { id: "carmel-beech" })),
      /closest match to "carmel-beech"/,
    );
    const none = await call(client, "dogpolicies_get_place", {
      id: "xyzzy-nowhere-at-all",
      response_format: "json",
    });
    assert.ok(!none.isError);
    assert.equal(none.structuredContent.outcome, "no_match");
    assert.equal(none.structuredContent.freshness, null);
    assert.equal(none.structuredContent.status, "unknown");
    assert.deepEqual(none.structuredContent.rule_records, []);
  }));

test("get_rule: a place's missing rule answers with the place and its recorded rules; an unknown uid with neither", () =>
  withClient(async (client, ctx) => {
    const carmel = ctx.graph.placeById.get("carmel-beach");
    // rule ids carry the uid without its "plc_" prefix
    const r = await call(client, "dogpolicies_get_rule", {
      id: `rul_${carmel.uid.replace(/^plc_/, "")}_nosuchkind`,
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.outcome, "no_match");
    assert.equal(r.structuredContent.rule, null);
    assert.equal(r.structuredContent.place.id, "carmel-beach");
    assert.ok(
      r.structuredContent.did_you_mean.every((x) => /^rul_/.test(x.id)),
    );
    const none = await call(client, "dogpolicies_get_rule", {
      id: "rul_zzzzzzzzzzzzzzzz_fee",
      response_format: "json",
    });
    assert.equal(none.structuredContent.outcome, "no_match");
    assert.equal(none.structuredContent.place, null);
  }));

test("compare_places: the ids it finds are compared, the rest listed as missing", () =>
  withClient(async (client, ctx) => {
    const [a, b] = ctx.graph.places.slice(0, 2).map((p) => p.id);
    const r = await call(client, "dogpolicies_compare_places", {
      ids: [a, b, "nope"],
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.outcome, "partial");
    assert.equal(r.structuredContent.places.length, 2);
    assert.equal(r.structuredContent.missing[0].id, "nope");
    assert.ok(r.structuredContent.rows.every((row) => row.values.length === 2));
    assert.match(
      text(
        await call(client, "dogpolicies_compare_places", {
          ids: [a, b, "nope"],
        }),
      ),
      /"nope" matched no place/,
    );
  }));

test("browse_answers and get_brand_policy: close slugs and brands are offered", () =>
  withClient(async (client) => {
    const slug = await call(client, "dogpolicies_browse_answers", {
      slug: "off leash beaches",
      response_format: "json",
    });
    assert.equal(slug.structuredContent.outcome, "no_match");
    assert.match(slug.structuredContent.did_you_mean[0].slug, /off-leash/);
    // a number word or a two-letter slip resolves to the covered brand, labeled
    const six = await call(client, "dogpolicies_get_brand_policy", {
      brand: "Motel Six",
      response_format: "json",
    });
    assert.equal(six.structuredContent.id, "motel-6");
    assert.equal(six.structuredContent.resolved_from, "Motel Six");
    const brand = await call(client, "dogpolicies_get_brand_policy", {
      brand: "Nonesuch Inns",
      response_format: "json",
    });
    assert.equal(brand.structuredContent.outcome, "no_match");
    assert.ok(brand.structuredContent.did_you_mean.length >= 1);
    assert.ok(
      brand.structuredContent.next.some((s) =>
        /dogpolicies_find_hotels/.test(s),
      ),
    );
  }));

test("report_correction: a near-miss id resolves; an unknown id files nothing and says bad_input", () =>
  withClient(async (client) => {
    const close = await call(client, "dogpolicies_report_correction", {
      place_id: "carmel-beech",
      message: "The leash rule changed last month.",
    });
    assert.ok(!close.isError);
    assert.equal(close.structuredContent.place_id, "carmel-beach");
    assert.equal(close.structuredContent.status, "not_sent");
    assert.match(
      close.structuredContent.form_url,
      /carmel-beach\/#correction$/,
    );
    const none = await call(client, "dogpolicies_report_correction", {
      place_id: "no-such-place-here",
      message: "Something is wrong here.",
    });
    assert.equal(none.structuredContent.outcome, "bad_input");
    assert.equal(none.structuredContent.report_id, null);
  }));

test("i5_conditions: a document from the host is served, an old one is marked stale, none is unavailable", async () => {
  const doc = (fetchedAt) => ({
    fetchedAt,
    notice: "Conditions, not rules.",
    closures: [],
    weather: [],
    signs: [],
    chainControls: [],
    source: { publisher: "Caltrans" },
  });
  const fresh = testRuntime({
    conditions: async () => doc(new Date().toISOString()),
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      from_mile: 170,
      to_mile: 222,
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    assert.equal(r.structuredContent.outcome, undefined);
    assert.equal(r.structuredContent.stale, undefined);
    assert.ok(r.structuredContent.fetched_at);
  }, fresh);
  const old = testRuntime({
    conditions: async () => doc("2026-01-01T00:00:00.000Z"),
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {});
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.stale, true);
    assert.match(text(r), /STALE READING/);
  }, old);
  const none = testRuntime({ conditions: async () => null });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      near: { lat: 40.59, lon: -122.39 },
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.outcome, "unavailable");
    assert.equal(r.structuredContent.fetched_at, null);
  }, none);
  const far = await withClient(
    (client) =>
      call(client, "dogpolicies_i5_conditions", {
        near: { lat: 36.555, lon: -121.923 },
        response_format: "json",
      }),
    fresh,
  );
  assert.equal(far.structuredContent.outcome, "bad_input");
  assert.ok(far.structuredContent.nearest_i5.miles_away > 25);
});

test("numbers written as strings are read as numbers", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_search_places", {
      county: "Monterey",
      limit: "3",
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.ok(r.structuredContent.places.length <= 3);
    const h = await call(client, "dogpolicies_find_hotels", {
      county: "Monterey",
      dog_weight_lb: "70",
      dogs: "2",
      nights: "3",
      response_format: "json",
    });
    assert.ok(!h.isError, text(h));
  }));
