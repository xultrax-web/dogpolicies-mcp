// plan_trip's day-by-day plan and saved-trip link (roadmap R-13, decision 107):
// the plan's shape, determinism, the fee arithmetic equal to find_hotels,
// the link's round trip and length, no avoidable repeats, an honest null evening.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, sharedRuntime, text, withClient } from "./helpers.mjs";
import { decodeTrip } from "../src/dogpolicies/vendor/trip-link.mjs";

const plan = (client, args) =>
  call(client, "dogpolicies_plan_trip", {
    response_format: "json",
    ...args,
  }).then((r) => {
    assert.ok(!r.isError, text(r));
    return r.structuredContent;
  });

const SLOTS = ["morning", "afternoon", "evening"];

test("plan_trip days: one per night, every slot a real record with rule, quote, source and date", () =>
  withClient(async (client, ctx) => {
    const s = await plan(client, {
      place: "Monterey",
      nights: 3,
      dogs: 2,
      dog_weight_lb: 40,
      start_date: "2026-12-30",
    });
    assert.equal(s.days.length, 3);
    assert.deepEqual(
      s.days.map((d) => d.date),
      ["2026-12-30", "2026-12-31", "2027-01-01"],
    );
    const byId = new Map(ctx.graph.places.map((p) => [p.id, p]));
    for (const d of s.days) {
      assert.equal(d.stay.id, s.plan_stay.id);
      for (const slot of SLOTS) {
        const ref = d[slot];
        if (!ref) {
          assert.ok(d.missing[slot], `${slot} is null with a reason`);
          continue;
        }
        const p = byId.get(ref.id);
        assert.ok(p, `${ref.id} is in the graph`);
        assert.equal(ref.name, p.name);
        assert.equal(ref.url, p.url);
        assert.equal(ref.kind, p.type);
        assert.equal(ref.rule, p.answer);
        assert.ok(["yes", "yes_restricted"].includes(p.status));
        assert.ok(ref.quote && ref.source_url && ref.verified_at);
        assert.ok(typeof ref.distance_mi === "number");
        assert.ok(["stay", "destination"].includes(ref.distance_from));
      }
      assert.ok(["beach", "trail", "park"].includes(d.morning?.kind));
      assert.equal(d.afternoon?.kind, "park");
      if (d.evening) assert.equal(d.evening.kind, "restaurant");
    }
  }));

test("plan_trip days: the same input gives the same plan, byte for byte", () =>
  withClient(async (client) => {
    const args = { place: "San Diego", nights: 4, dogs: 1, save: true };
    const a = await plan(client, args);
    const b = await plan(client, args);
    assert.equal(JSON.stringify(a.days), JSON.stringify(b.days));
    assert.equal(a.trip_url, b.trip_url);
  }));

test("plan_trip fee: the plan's stay carries the numbers find_hotels returns for the same stay", () =>
  withClient(async (client) => {
    const args = { place: "Monterey", nights: 3, dogs: 2, dog_weight_lb: 40 };
    const s = await plan(client, args);
    const stay = s.plan_stay;
    assert.ok(stay, "a stay was chosen");
    const hotels = (
      await call(client, "dogpolicies_find_hotels", {
        near: { ...s.center, radius_miles: 15 },
        query: stay.name,
        limit: 50,
        nights: args.nights,
        dogs: args.dogs,
        dog_weight_lb: args.dog_weight_lb,
        response_format: "json",
      })
    ).structuredContent.hotels;
    const same = hotels.find((h) => h.id === stay.id);
    assert.ok(same, "find_hotels lists the same stay");
    assert.equal(stay.fee.total, same.fee_amount);
    assert.equal(stay.fee.arithmetic, same.fee_estimate);
    assert.equal(stay.fee.line, same.fee);
    assert.equal(stay.verdict, same.verdict);
    // and the entry in stays is the same stay with the same numbers
    const listed = s.stays.find((x) => x.id === stay.id);
    assert.equal(listed.fee_estimate, stay.fee.arithmetic);
    if (stay.fee.total != null)
      assert.equal(
        stay.fee.per_night,
        Math.round((stay.fee.total / args.nights) * 100) / 100,
      );
    assert.equal(stay.fit.pet_count, "ok");
    assert.ok(stay.fit.weight);
  }));

test("plan_trip stay_id builds the plan on another stay; an unknown one is said, not hidden", () =>
  withClient(async (client) => {
    const base = await plan(client, { place: "Monterey", nights: 2 });
    const other = base.stays[1];
    assert.ok(other);
    const s = await plan(client, {
      place: "Monterey",
      nights: 2,
      stay_id: other.id,
    });
    assert.equal(s.plan_stay.id, other.id);
    const bad = await plan(client, {
      place: "Monterey",
      nights: 2,
      stay_id: "no-such-hotel",
    });
    assert.equal(bad.plan_stay.id, base.stays[0].id);
    assert.ok(bad.plan_notes.some((n) => n.includes("no-such-hotel")));
  }));

test("plan_trip: no place repeats across slots and days while the graph has more to give", () =>
  withClient(async (client) => {
    const s = await plan(client, { place: "San Diego", nights: 4, dogs: 1 });
    const seen = new Set();
    for (const d of s.days)
      for (const slot of SLOTS) {
        const ref = d[slot];
        if (!ref) continue;
        assert.ok(!ref.repeat, `${ref.id} should not be a repeat here`);
        assert.ok(!seen.has(ref.id), `${ref.id} appears once`);
        seen.add(ref.id);
      }
    // a thin place repeats only when it must, and says so
    const thin = await plan(client, { place: "South Lake Tahoe", nights: 5 });
    for (const slot of SLOTS) {
      const ids = thin.days.map((d) => d[slot]?.id).filter(Boolean);
      const flagged = thin.days.filter((d) => d[slot]?.repeat).length;
      assert.equal(ids.length - new Set(ids).size > 0, flagged > 0);
    }
  }));

test("plan_trip: dinner is null with a reason where the graph has no dog-friendly restaurant", () =>
  withClient(async (client, ctx) => {
    const eats = ctx.graph.places.filter(
      (p) => p.type === "restaurant" && p.geo,
    );
    // a town far from every restaurant record: the Owens Valley
    const s = await plan(client, { place: "Bishop", nights: 2 });
    const near = s.center;
    const any = eats.some(
      (p) =>
        ["yes", "yes_restricted"].includes(p.status) &&
        Math.hypot(p.geo.lat - near.lat, (p.geo.lon - near.lon) * 0.8) < 0.2,
    );
    assert.ok(!any, "fixture: no dog-friendly restaurant record near Bishop");
    for (const d of s.days) {
      assert.equal(d.evening, null);
      assert.match(d.missing.evening, /No restaurant, patio or winery/);
      // two parks, four slots: a repeat is said, and never twice in one day
      assert.notEqual(d.morning?.id, d.afternoon?.id);
    }
    assert.ok(s.days.some((d) => d.afternoon?.repeat));
    // a place with restaurants fills it; markdown says "none" where it cannot
    const md = text(
      await call(client, "dogpolicies_plan_trip", {
        place: "Bishop",
        nights: 2,
      }),
    );
    assert.match(md, /## The plan, day by day/);
    assert.match(md, /- Evening: none\. No restaurant/);
  }));

test("plan_trip save: trip_url carries the plan in the fragment and round-trips; short enough to paste", () =>
  withClient(async (client) => {
    const s = await plan(client, {
      place: "Monterey",
      nights: 4,
      dogs: 2,
      dog_weight_lb: 60,
      max_total_fee: 400,
      start_date: "2026-12-01",
      save: true,
    });
    assert.match(s.trip_url, /^https:\/\/dogpolicies\.com\/trips\/#v1\./);
    assert.ok(!s.trip_url.includes("?"), "no query string: the fragment only");
    assert.ok(s.trip_url.length < 1500, `length ${s.trip_url.length}`);
    const t = decodeTrip(new URL(s.trip_url).hash);
    assert.equal(t.nights, 4);
    assert.equal(t.dogs, 2);
    assert.equal(t.weightLb, 60);
    assert.equal(t.size, "large");
    assert.equal(t.maxFee, 400);
    assert.equal(t.start, "2026-12-01");
    assert.equal(t.stay, s.plan_stay.id);
    assert.deepEqual(
      t.morning,
      s.days.map((d) => d.morning?.id ?? null),
    );
    assert.deepEqual(
      t.afternoon,
      s.days.map((d) => d.afternoon?.id ?? null),
    );
    assert.deepEqual(
      t.evening,
      s.days.map((d) => d.evening?.id ?? null),
    );
    // without save there is no link, and the markdown offers one
    const plain = await plan(client, { place: "Monterey", nights: 2 });
    assert.equal(plain.trip_url, null);
    const md = text(
      await call(client, "dogpolicies_plan_trip", {
        place: "Monterey",
        nights: 2,
      }),
    );
    assert.match(md, /call again with save=true/);
  }));

test("plan_trip: a long stay shows 14 days and says so; a trip without stays or places has no plan", () =>
  withClient(async (client) => {
    const s = await plan(client, { place: "Monterey", nights: 20, save: true });
    assert.equal(s.days.length, 14);
    assert.ok(s.plan_notes.some((n) => /first 14 of 20/.test(n)));
    assert.equal(decodeTrip(new URL(s.trip_url).hash).nights, 20);
    assert.ok(s.trip_url.length < 2500, `length ${s.trip_url.length}`);
    const none = await call(client, "dogpolicies_plan_trip", {
      place: "Nowhereville",
      save: true,
      response_format: "json",
    });
    assert.ok(!none.isError);
    assert.deepEqual(none.structuredContent.days, []);
    assert.equal(none.structuredContent.trip_url, null);
    const badDate = await call(client, "dogpolicies_plan_trip", {
      place: "Monterey",
      start_date: "2026-02-31",
    });
    assert.ok(badDate.isError || /date/i.test(text(badDate)));
  }));

test("the plan never leaves a stay out of the graph: ids in the link are all real places", () =>
  withClient(async (client) => {
    const ctx = sharedRuntime();
    const ids = new Set(ctx.graph.places.map((p) => p.id));
    const s = await plan(client, {
      place: "Lake Tahoe",
      nights: 3,
      save: true,
    });
    const t = decodeTrip(new URL(s.trip_url).hash);
    for (const id of [t.stay, ...t.morning, ...t.afternoon, ...t.evening])
      if (id) assert.ok(ids.has(id), id);
  }));
