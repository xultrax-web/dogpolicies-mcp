// Closed rest areas on I-5: route_stops, i5_corridor and plan_trip add
// closed_now (Caltrans' reason and end time) from the conditions document the
// host passes in, skip the closed stop when they name the next one, and answer
// exactly as before when the document is missing, malformed, stale or empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testRuntime, withClient, call, text } from "./helpers.mjs";

const NOW = () => Math.floor(Date.now() / 1000);
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const GORMAN = { lat: 34.7975, lon: -118.851 };
const NB = "tejon-pass-rest-area-i-5-northbound";
const SB = "tejon-pass-rest-area-i-5-southbound";

// Tejon Pass: northbound rest area s 331522, southbound s 331632 (Caltrans mile 205.7 / 205.8).
const closure = (over = {}) => ({
  id: "lcs_T5PA",
  kind: "closure",
  sBegin: 331635,
  sEnd: 331635,
  mileBegin: 205.8,
  mileEnd: 205.8,
  direction: "southbound",
  facility: "Rest Area",
  type: "Full",
  work: "Rest Area Maintenance",
  lanesClosed: "All",
  startEpoch: NOW() - 86400,
  endEpoch: null,
  indefinite: true,
  ...over,
});
// How Caltrans publishes the northbound one: the full closure of the rest area's off-ramp.
const northRamp = (over = {}) =>
  closure({
    id: "lcs_C5LA",
    sBegin: 331304,
    sEnd: 331319,
    direction: "northbound",
    facility: "Off Ramp",
    work: "Miscellaneous Work",
    endEpoch: NOW() + 86400 * 100,
    indefinite: false,
    ...over,
  });
const doc = (closures, extra = {}) => ({
  schema: "dogpolicies-conditions/1",
  fetchedAt: minutesAgo(8),
  notice: "Conditions, not rules.",
  closures,
  weather: [],
  signs: [],
  chainControls: [],
  source: { publisher: "Caltrans" },
  ...extra,
});

const ASK = {
  near: GORMAN,
  direction: "north",
  ahead_miles: 40,
  kinds: ["rest_area"],
};
const stops = async (conditions, args = {}) => {
  let out;
  await withClient(async (client) => {
    const j = await call(client, "dogpolicies_route_stops", {
      ...ASK,
      ...args,
      response_format: "json",
    });
    assert.ok(!j.isError);
    const md = await call(client, "dogpolicies_route_stops", {
      ...ASK,
      ...args,
    });
    out = { json: j.structuredContent, md: text(md) };
  }, testRuntime({ conditions }));
  return out;
};
const byId = (json, id) => json.stops.find((s) => s.id === id);

test("route_stops northbound: the ramp closure closes Tejon Pass northbound, with Caltrans' reason and end", async () => {
  const { json, md } = await stops(async () => doc([northRamp(), closure()]));
  const nb = byId(json, NB);
  assert.ok(nb, "northbound Tejon Pass is still listed");
  assert.equal(nb.closed_now.reason, "Miscellaneous Work");
  assert.equal(nb.closed_now.source, "Caltrans");
  assert.match(nb.closed_now.until, /^20\d\d-/);
  assert.ok(nb.closed_now.fetched_at.length > 10);
  assert.equal(
    byId(json, SB),
    undefined,
    "the southbound one serves the other way",
  );
  assert.match(md, /Closed now \(Caltrans\)/);
  assert.match(
    md,
    /Tejon Pass Rest Area \(northbound I-5\): Closed now: Miscellaneous Work, until [A-Z][a-z]{2} \d+, 20\d\d \(Caltrans\)/,
  );
});

test("route_stops southbound: the rest-area closure with no end says 'end not set'", async () => {
  const { json, md } = await stops(async () => doc([northRamp(), closure()]), {
    near: { lat: 34.9, lon: -118.9 },
    direction: "south",
    ahead_miles: 40,
  });
  const sb = byId(json, SB);
  assert.ok(sb, "southbound Tejon Pass is listed");
  assert.equal(sb.closed_now.reason, "Rest Area Maintenance");
  assert.equal(sb.closed_now.until, null);
  assert.match(
    md,
    /Closed now: Rest Area Maintenance, end not set \(Caltrans\)/,
  );
  assert.equal(byId(json, NB), undefined);
});

test("route_stops: one direction closed leaves the other open, and the text names the first open stop", async () => {
  const north = await stops(async () => doc([northRamp()]), {
    ahead_miles: 120,
  });
  assert.ok(byId(north.json, NB).closed_now);
  const open = north.json.stops.filter((s) => !s.closed_now);
  assert.ok(open.length, "another rest area is open ahead");
  assert.ok(north.md.includes(`the first open stop is ${open[0].name}`));
  const south = await stops(async () => doc([northRamp()]), {
    near: { lat: 34.9, lon: -118.9 },
    direction: "south",
  });
  assert.ok(byId(south.json, SB));
  assert.equal(byId(south.json, SB).closed_now, undefined);
});

test("route_stops: a closure past its end, one not started, a lane closure or a far ramp closes nothing", async () => {
  const cases = [
    [northRamp({ endEpoch: NOW() - 3600 })],
    [northRamp({ startEpoch: NOW() + 3600 })],
    [northRamp({ type: "Lane", lanesClosed: "1" })],
    [northRamp({ sBegin: 329000, sEnd: 329100 })],
    [northRamp({ facility: "On Ramp" })],
    [northRamp({ direction: "southbound" })],
  ];
  for (const closures of cases) {
    const { json, md } = await stops(async () => doc(closures));
    assert.ok(byId(json, NB), "listed");
    assert.equal(byId(json, NB).closed_now, undefined);
    assert.doesNotMatch(md, /Closed now/);
  }
});

test("route_stops: no closures, no document, a failing loader, a malformed or a stale document answer as before", async () => {
  const base = await stops(null);
  assert.equal(byId(base.json, NB).closed_now, undefined);
  const broken = [
    async () => doc([]),
    async () => null,
    async () => {
      throw new Error("Durable Object reset");
    },
    async () => ({ closures: "not a list", fetchedAt: minutesAgo(1) }),
    async () => ({
      closures: [null, 7, {}, { sBegin: "x" }],
      fetchedAt: minutesAgo(1),
    }),
    async () => doc([northRamp()], { fetchedAt: "yesterday" }),
    async () => doc([northRamp()], { fetchedAt: minutesAgo(3 * 60) }),
    async () => "garbage",
  ];
  for (const conditions of broken) {
    const got = await stops(conditions);
    assert.deepEqual(
      got.json.stops.map((s) => s.id),
      base.json.stops.map((s) => s.id),
    );
    assert.ok(got.json.stops.every((s) => s.closed_now === undefined));
    assert.doesNotMatch(got.md, /Closed now/);
  }
});

test("route_stops: a loader that never answers does not hold the answer for more than a few seconds", async () => {
  const started = Date.now();
  const got = await stops(() => new Promise(() => {}));
  assert.ok(Date.now() - started < 8000);
  assert.ok(byId(got.json, NB));
});

test("i5_corridor: a closed rest area carries closed_now and the text names the first open stop", async () => {
  const args = {
    near: GORMAN,
    direction: "north",
    ahead_miles: 120,
    kinds: ["rest_area"],
  };
  await withClient(
    async (client) => {
      const j = (
        await call(client, "dogpolicies_i5_corridor", {
          ...args,
          response_format: "json",
        })
      ).structuredContent;
      assert.equal(
        j.stops.find((s) => s.id === NB).closed_now.reason,
        "Miscellaneous Work",
      );
      const md = text(await call(client, "dogpolicies_i5_corridor", args));
      assert.match(
        md,
        /Closed now \(Caltrans\): Tejon Pass Rest Area \(northbound I-5\), Miscellaneous Work, until /,
      );
      assert.match(md, /the first open stop is /);
    },
    testRuntime({ conditions: async () => doc([northRamp()]) }),
  );
  await withClient(
    async (client) => {
      const j = (
        await call(client, "dogpolicies_i5_corridor", {
          ...args,
          response_format: "json",
        })
      ).structuredContent;
      assert.ok(j.stops.every((s) => s.closed_now === undefined));
    },
    testRuntime({ conditions: async () => null }),
  );
});

test("plan_trip: the I-5 leg's next family stops skip the closed rest area and name it", async () => {
  const run = async (conditions) => {
    let out;
    await withClient(async (client) => {
      const r = await call(client, "dogpolicies_plan_trip", {
        near: GORMAN,
        response_format: "json",
      });
      assert.ok(!r.isError);
      out = r.structuredContent.i5;
    }, testRuntime({ conditions }));
    return out;
  };
  const open = await run(null);
  const closed = await run(async () => doc([northRamp(), closure()]));
  assert.ok(open.family_stops_north.some((s) => s.id === NB));
  assert.ok(!closed.family_stops_north.some((s) => s.id === NB));
  assert.ok(
    closed.closed_now_stops.some(
      (s) => s.id === NB && s.closed_now.reason === "Miscellaneous Work",
    ),
  );
  assert.equal(open.closed_now_stops, undefined);
});

test("a closure end no Date can hold (a garbage or wrong-unit epoch from the feed) reads 'end not set', never isError", async () => {
  const absurd = 9999999999999;
  const conditions = async () => doc([northRamp({ endEpoch: absurd }), closure({ endEpoch: absurd * 1000, indefinite: false })]);
  await withClient(async (client) => {
    const stopsJ = await call(client, "dogpolicies_route_stops", { ...ASK, response_format: "json" });
    assert.ok(!stopsJ.isError, text(stopsJ));
    const nb = byId(stopsJ.structuredContent, NB);
    assert.ok(nb.closed_now, "still closed now");
    assert.equal(nb.closed_now.until, null);
    const stopsMd = await call(client, "dogpolicies_route_stops", ASK);
    assert.ok(!stopsMd.isError, text(stopsMd));
    assert.match(text(stopsMd), /Closed now: Miscellaneous Work, end not set \(Caltrans\)/);

    const corridorArgs = { near: GORMAN, direction: "north", ahead_miles: 120, kinds: ["rest_area"] };
    for (const format of ["json", "markdown"]) {
      const r = await call(client, "dogpolicies_i5_corridor", { ...corridorArgs, response_format: format });
      assert.ok(!r.isError, `${format}: ${text(r)}`);
    }
    const corridor = await call(client, "dogpolicies_i5_corridor", { ...corridorArgs, response_format: "json" });
    assert.equal(corridor.structuredContent.stops.find((s) => s.id === NB).closed_now.until, null);

    for (const format of ["json", "markdown"]) {
      const r = await call(client, "dogpolicies_i5_conditions", { response_format: format });
      assert.ok(!r.isError, `${format}: ${text(r)}`);
    }
    const md = text(await call(client, "dogpolicies_i5_conditions", {}));
    assert.match(md, /Miscellaneous Work[^\n]*, end not set/);
    assert.doesNotMatch(md, /until null|Invalid/);
  }, testRuntime({ conditions }));
});
