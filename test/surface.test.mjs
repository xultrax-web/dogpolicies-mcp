// The spec surface beyond tools: resources, resource templates with
// completion, prompts with argument completion, and the four tools added in
// 0.2.0 (near, plan_trip, compare_places, changes_near).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, text, withClient } from "./helpers.mjs";

test("resources: about, status and answers read; templates list and complete", () =>
  withClient(async (client, ctx) => {
    const about = await client.readResource({ uri: "dogpolicies://about" });
    assert.match(about.contents[0].text, /^# DogPolicies MCP server/);
    const status = JSON.parse(
      (await client.readResource({ uri: "dogpolicies://status" })).contents[0]
        .text,
    );
    assert.equal(status.data.as_of, ctx.graph.as_of);
    assert.equal(status.network, false);
    assert.ok(status.stats.calls >= 0);
    const answers = await client.readResource({ uri: "dogpolicies://answers" });
    assert.match(answers.contents[0].text, /answered questions/);
    const place = await client.readResource({
      uri: "dogpolicies://place/carmel-beach",
    });
    assert.match(place.contents[0].text, /^Carmel Beach/);
    assert.equal(place.contents[0].mimeType, "text/markdown");
    const brand = await client.readResource({
      uri: "dogpolicies://brand/motel-6",
    });
    assert.match(brand.contents[0].text, /Motel 6 pet policy/);
    const route = await client.readResource({ uri: "dogpolicies://route/i-5" });
    assert.match(route.contents[0].text, /dog stops on I-5/);
    await assert.rejects(
      client.readResource({ uri: "dogpolicies://place/no-such-place" }),
    );
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.deepEqual(resourceTemplates.map((t) => t.uriTemplate).sort(), [
      "dogpolicies://answer/{slug}",
      "dogpolicies://area/{id}",
      "dogpolicies://brand/{id}",
      "dogpolicies://place/{id}",
      "dogpolicies://route/{id}",
    ]);
    const area = await client.readResource({
      uri: "dogpolicies://area/east-bay",
    });
    assert.match(area.contents[0].text, /East Bay/);
    const areaCompletion = await client.complete({
      ref: { type: "ref/resource", uri: "dogpolicies://area/{id}" },
      argument: { name: "id", value: "lake" },
    });
    assert.ok(areaCompletion.completion.values.includes("lake-tahoe"));
    const tahoe = await call(client, "dogpolicies_near", {
      place: "Lake Tahoe",
      response_format: "json",
    });
    assert.equal(tahoe.structuredContent.label, "Lake Tahoe");
    assert.ok(
      tahoe.structuredContent.groups
        .flatMap((g) => g.places)
        .every((p) => p.area_id === "lake-tahoe"),
    );
    const bigSur = await call(client, "dogpolicies_search_places", {
      area: "big-sur",
      response_format: "json",
    });
    assert.ok(bigSur.structuredContent.total > 0);
    assert.ok(
      bigSur.structuredContent.places.every((p) => p.area === "Big Sur"),
    );
    const completion = await client.complete({
      ref: { type: "ref/resource", uri: "dogpolicies://place/{id}" },
      argument: { name: "id", value: "carmel" },
    });
    assert.ok(completion.completion.values.includes("carmel-beach"));
  }));

test("prompts: list, argument completion for towns, and a built message that names the tool", () =>
  withClient(async (client) => {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name).sort(), [
      "check_hotel_for_dog",
      "cite_a_rule",
      "drive_i5_with_dog",
      "plan_dog_trip",
      "road_trip_with_dog",
      "what_can_my_dog_do_here",
    ]);
    const trip = await client.getPrompt({
      name: "plan_dog_trip",
      arguments: { destination: "Monterey, CA", dog: "70 lb Lab", nights: "3" },
    });
    assert.match(
      trip.messages[0].content.text,
      /dogpolicies_plan_trip with place="Monterey, CA"/,
    );
    assert.match(trip.messages[0].content.text, /Cite every fact/);
    const completion = await client.complete({
      ref: { type: "ref/prompt", name: "plan_dog_trip" },
      argument: { name: "destination", value: "monte" },
    });
    assert.ok(
      completion.completion.values.some((v) => /^Monterey/.test(v)),
      JSON.stringify(completion),
    );
  }));

test("prompts: town completion never offers 'Carson City County' (a consolidated city), and lists each label once", () =>
  withClient(async (client) => {
    for (const [name, argument] of [
      ["plan_dog_trip", "destination"],
      ["check_hotel_for_dog", "hotel_or_town"],
      ["what_can_my_dog_do_here", "place"],
    ]) {
      const { completion } = await client.complete({
        ref: { type: "ref/prompt", name },
        argument: { name: argument, value: "Carson" },
      });
      const values = completion.values;
      assert.ok(values.includes("Carson City, NV"), `${name}: ${values}`);
      assert.ok(
        !values.some((v) => /Carson City County/i.test(v)),
        `${name}: ${values}`,
      );
      assert.equal(new Set(values).size, values.length, `${name}: no repeats`);
    }
    const { completion } = await client.complete({
      ref: { type: "ref/prompt", name: "plan_dog_trip" },
      argument: { name: "destination", value: "washoe" },
    });
    assert.ok(completion.values.includes("Washoe County, NV"), "other counties keep the word");
  }));

test("near: a town name resolves, results group by kind sorted by distance; unknown town errors", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_near", {
      place: "Carmel",
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    assert.equal(r.structuredContent.label, "Carmel, CA");
    assert.ok(r.structuredContent.total > 3);
    for (const g of r.structuredContent.groups) {
      const d = g.places.map((p) => p.distance_miles);
      assert.deepEqual(
        d,
        [...d].sort((a, b) => a - b),
      );
    }
    const md = text(
      await call(client, "dogpolicies_near", { place: "Carmel" }),
    );
    assert.match(md, /^# \d+ dog-related places within 15 miles of Carmel, CA/);
    assert.match(md, /## Beaches/);
    assert.match(md, /DogPolicies, dogpolicies\.com, CC BY 4\.0, verified/);
    const county = await call(client, "dogpolicies_near", {
      place: "Washoe County, NV",
      radius_miles: 40,
      response_format: "json",
    });
    assert.equal(county.structuredContent.label, "Washoe County, Nevada");
    const point = await call(client, "dogpolicies_near", {
      near: { lat: 36.55, lon: -121.92 },
      radius_miles: 5,
      types: ["beach"],
      response_format: "json",
    });
    assert.ok(point.structuredContent.groups.every((g) => g.type === "beach"));
    const bad = await call(client, "dogpolicies_near", { place: "Atlantis" });
    assert.ok(!bad.isError, "an unknown town is an answer");
    assert.equal(bad.structuredContent.outcome, "no_match");
    assert.equal(bad.structuredContent.code, "not_found");
    const none = await client.callTool({
      name: "dogpolicies_near",
      arguments: {},
    });
    assert.ok(!none.isError, "no place or point is an answer");
    assert.equal(none.structuredContent.outcome, "bad_input");
    assert.equal(none.structuredContent.code, "invalid");
  }));

test("plan_trip: stays with verdicts and fee math, outings grouped, one call", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_plan_trip", {
      place: "Monterey",
      dog_weight_lb: 70,
      nights: 3,
      max_total_fee: 150,
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    assert.ok(r.structuredContent.stays.length > 0);
    assert.ok(
      r.structuredContent.stays.every(
        (s) =>
          ["match", "possible"].includes(s.verdict) &&
          typeof s.fee_estimate === "string",
      ),
    );
    assert.ok(r.structuredContent.outings.some((g) => g.type === "beach"));
    const md = text(
      await call(client, "dogpolicies_plan_trip", {
        place: "Monterey",
        dog_weight_lb: 70,
        nights: 3,
      }),
    );
    assert.match(
      md,
      /^# A trip to Monterey, CA with a dog \(70 lb dog, 3 nights; within 15 miles\)/,
    );
    assert.match(md, /## Where to stay: \d+ match/);
    assert.match(md, /## Beaches/);
    const camp = await call(client, "dogpolicies_plan_trip", {
      place: "Mono County",
      stay_types: ["campground", "cabins"],
      radius_miles: 40,
      response_format: "json",
    });
    assert.ok(
      camp.structuredContent.stays.every((s) =>
        ["campground", "cabins"].includes(s.type),
      ),
    );
  }));

test("compare_places: a table with one column per place; bad ids are not_found", () =>
  withClient(async (client, ctx) => {
    const beaches = ctx.graph.places
      .filter((p) => p.type === "beach")
      .slice(0, 3)
      .map((p) => p.id);
    const r = await call(client, "dogpolicies_compare_places", {
      ids: beaches,
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    assert.equal(r.structuredContent.places.length, 3);
    assert.ok(r.structuredContent.rows.every((row) => row.values.length === 3));
    assert.ok(r.structuredContent.rows.some((row) => row.fact === "freshness"));
    const md = text(
      await call(client, "dogpolicies_compare_places", { ids: beaches }),
    );
    assert.match(md, /\| Fact \|/);
    assert.match(md, /\| Dogs allowed \|/);
    const bad = await call(client, "dogpolicies_compare_places", {
      ids: ["carmel-beach", "nope"],
    });
    assert.ok(!bad.isError, "one good id and one bad is an answer");
    assert.equal(bad.structuredContent.outcome, "no_match");
    assert.equal(bad.structuredContent.missing[0].id, "nope");
    assert.equal(bad.structuredContent.places.length, 1);
    const one = await call(client, "dogpolicies_compare_places", {
      ids: ["carmel-beach"],
    });
    assert.ok(!one.isError);
    assert.equal(one.structuredContent.outcome, "bad_input");
  }));

test("changes_near: events limited to the radius, newest first", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_changes_near", {
      place: "Alameda",
      since: "2026-01-01",
      radius_miles: 25,
      limit: 50,
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    assert.ok(r.structuredContent.events.every((e) => e.distance_miles <= 25));
    const at = r.structuredContent.events.map((e) => e.at);
    assert.deepEqual(at, [...at].sort().reverse());
    const md = text(
      await call(client, "dogpolicies_changes_near", {
        place: "Alameda",
        since: "2026-01-01",
      }),
    );
    assert.match(
      md,
      /^# \d+ verification events? since 2026-01-01 within 15 miles of Alameda, CA/,
    );
    const nothing = await call(client, "dogpolicies_changes_near", {
      place: "Alameda",
      since: "2099-01-01",
    });
    assert.match(text(nothing), /No events in this area/);
  }));

test("search and route tools accept the restaurant type", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_search_places", {
      type: "restaurant",
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.ok(r.structuredContent.places.every((p) => p.type === "restaurant"));
    const s = await call(client, "dogpolicies_route_stops", {
      kinds: ["restaurant"],
      response_format: "json",
    });
    assert.ok(!s.isError);
  }));
