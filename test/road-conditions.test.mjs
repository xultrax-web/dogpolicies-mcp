// dogpolicies_road_conditions: the host's loader hands the tool one route's
// conditions document (the hosted Worker reads it from its conditions loop).
// Fresh, stale and unavailable readings, the spellings of a route, a route the
// loop does not follow, windows by mile, town and stretch, and direction.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  call,
  sharedRuntime,
  testRuntime,
  text,
  withClient,
} from "./helpers.mjs";
import {
  ROAD_CONDITIONS_ROUTES,
  findStretch,
  pacificEpoch,
  roadOf,
} from "../src/dogpolicies/tools/road-conditions.mjs";
import { toolDefinitions } from "../src/dogpolicies/server.mjs";

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const stop = (name, mile, milesAway) => ({
  id: name.toLowerCase().replace(/[^a-z]+/g, "-"),
  name,
  mile,
  url: `https://dogpolicies.com/places/${name.toLowerCase().replace(/[^a-z]+/g, "-")}/`,
  milesAway,
});
// An I-80 document in the shape the site's loop writes (worker/conditions-core.mjs).
const i80 = (fetchedAt, extra = {}) => ({
  schema: "dogpolicies-conditions/1",
  route: "i-80",
  state: "CA",
  fetchedAt,
  notice:
    "Conditions are Caltrans feed data fetched at fetchedAt, placed by route mile on I-80 in California. They are not verified facts and not rules; check Caltrans QuickMap (quickmap.dot.ca.gov) before you go.",
  source: {
    publisher: "California Department of Transportation (Caltrans)",
    portal: "https://cwwp2.dot.ca.gov/",
    districts: [4, 3],
    terms: { checked: "2026-11-04" },
  },
  errors: ["rwis d4: HTTP 500", "cc d4: HTTP 500"],
  closures: [
    {
      id: "lcs_C80IA",
      kind: "closure",
      mileBegin: 7.1,
      mileEnd: 7.9,
      direction: "eastbound",
      facility: "Mainline",
      type: "Alternating Lanes",
      work: "Utility Work",
      lanesClosed: "2, 3",
      totalLanes: "6",
      where: "E/End S.F.O.B.B.",
      endEpoch: 1794315000,
      indefinite: false,
      nearestStop: stop("Emeryville Crescent", 7.5, 0.4),
    },
    {
      id: "lcs_T80VA",
      kind: "closure",
      mileBegin: 136.5,
      mileEnd: 134.6,
      direction: "westbound",
      facility: "Conventional Hwy",
      type: "Lane",
      work: "Fire Emergency",
      lanesClosed: "2",
      totalLanes: "2",
      where: "Long Ravine (Carpenter Rd)",
      endEpoch: null,
      indefinite: true,
      nearestStop: null,
    },
  ],
  weather: [
    {
      id: "rwis_3_3",
      kind: "weather",
      mile: 176.3,
      name: "Hwy 80 at Donner Summit",
      elevationFt: 7221,
      airF: 28,
      surfaceF: 30,
      windMph: 12,
      gustMph: 25,
      visibilityMi: 0.4,
      // Ten minutes before the fetch, as the loop writes it (epoch seconds).
      recordedAt: "2026-11-25T18:14:02",
      recordedEpoch: Math.round(Date.parse(fetchedAt) / 1000) - 600,
      nearestStop: stop("Donner Summit Rest Area", 176.8, 0.5),
    },
    {
      // A station the district file still carries from May.
      id: "rwis_3_9",
      kind: "weather",
      mile: 189.9,
      name: "Hwy 80 at Truckee Scales",
      elevationFt: 5826,
      airF: 60,
      surfaceF: 84,
      windMph: 8.5,
      gustMph: 13.4,
      visibilityMi: 0.5,
      recordedAt: "2026-05-19T12:56:01",
      recordedEpoch: 1779220561,
      nearestStop: null,
    },
  ],
  signs: [
    {
      id: "cms_3_1249",
      kind: "sign",
      mile: 171,
      name: "027 - Kingvale",
      direction: "westbound",
      lines: ["CHAINS REQUIRED", "KINGVALE TO", "TRUCKEE"],
      chains: true,
      nearestStop: null,
    },
  ],
  chainControls: [
    {
      id: "cc_3_3-PLA-80-69.01-W-202",
      kind: "chain_control",
      mile: 170.4,
      name: "Kingvale",
      direction: "westbound",
      status: "R-0",
      statusText: "No chain controls are in effect at this time.",
      inEffect: false,
      statusAt: "2026-11-03T21:02:11",
      nearestStop: null,
    },
    {
      id: "cc_3_3-NEV-80-R005.84L-E-251",
      kind: "chain_control",
      mile: 176.9,
      name: "Castle Peak",
      direction: "eastbound",
      status: "R-2",
      statusText:
        "Chains are required on all vehicles except four wheel drive vehicles with snow tires on all four wheels.",
      inEffect: true,
      statusAt: "2026-11-25T17:40:00",
      nearestStop: stop("Donner Summit Rest Area", 176.8, 0.1),
    },
  ],
  ...extra,
});

const roads = (docs) => async (route) => docs[route] ?? null;

test("road_conditions: chains in effect on I-80 eastbound, with Caltrans' wording, closures and weather in the window", async () => {
  const asked = [];
  const rt = testRuntime({
    roadConditions: async (route) => {
      asked.push(route);
      return route === "i-80" ? i80(minutesAgo(9)) : null;
    },
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_road_conditions", {
      route: "I-80",
      direction: "east",
      response_format: "json",
    });
    assert.ok(!r.isError);
    const s = r.structuredContent;
    assert.equal(s.outcome, undefined);
    assert.equal(s.route, "i-80");
    assert.equal(s.road, "I-80");
    assert.equal(s.stale, undefined);
    assert.equal(s.chain_controls_in_effect, true);
    assert.equal(s.chains_in_effect, true);
    assert.deepEqual(
      s.chain_controls.map((c) => c.name),
      ["Castle Peak"],
      "only the controls in effect, eastbound",
    );
    assert.match(s.chain_controls[0].statusText, /^Chains are required/);
    assert.deepEqual(s.counts, {
      closures: 1,
      chain_controls_in_effect: 1,
      chain_control_points: 1,
      weather: 2,
      weather_current: 1,
      signs: 0,
    });
    // A reading ten minutes before the fetch is current; the May one is not.
    const [donner, scales] = s.weather;
    assert.equal(donner.current, true);
    assert.equal(donner.reading_age_hours, 0.2);
    assert.equal(scales.current, false);
    assert.ok(scales.reading_age_hours > 24 * 100);
    assert.deepEqual(
      s.closures.map((c) => c.id),
      ["lcs_C80IA"],
      "the westbound fire closure is left out",
    );
    assert.deepEqual(s.feeds_failed, ["rwis d4: HTTP 500", "cc d4: HTTP 500"]);
    assert.match(s.notice, /not verified facts and not rules/);
    assert.equal(s.live_map, "https://quickmap.dot.ca.gov/");
    assert.match(s.conditions_url, /\/api\/v1\/conditions\/i-80\.json$/);
    const md = text(
      await call(client, "dogpolicies_road_conditions", { route: "80" }),
    );
    assert.match(
      md,
      /^# I-80 conditions, all of I-80 in California: CHAIN CONTROLS IN EFFECT at 1 of 2 chain-control points/,
    );
    assert.match(
      md,
      /Mile 176\.9 \(Castle Peak, eastbound\): R-2, "Chains are required/,
    );
    assert.match(md, /1 sign in the window mention chains/);
    assert.match(md, /2 weather stations \(1 with a current reading\)/);
    assert.match(
      md,
      /Mile 176\.3 \(Hwy 80 at Donner Summit, 7221 ft\): air 28 °F/,
    );
    assert.match(
      md,
      /Mile 189\.9 \(Hwy 80 at Truckee Scales, 5826 ft\): no current reading; the station's last reading in the feed is from 2026-05-19 12:56:01 Pacific/,
    );
    assert.doesNotMatch(
      md,
      /air 60 °F/,
      "an old reading's numbers are left out",
    );
    assert.match(md, /"CHAINS REQUIRED \/ KINGVALE TO \/ TRUCKEE"/);
    assert.match(
      md,
      /Mile 136\.5–134\.6, westbound: Lane closure .*Fire Emergency.*end not set/,
    );
    assert.match(
      md,
      /Feeds that did not answer at the last fetch: rwis d4: HTTP 500/,
    );
    assert.match(md, /quickmap\.dot\.ca\.gov/);
  }, rt);
  assert.deepEqual([...new Set(asked)], ["i-80"]);
});

test("road_conditions: a reading over two hours old, or the host's held copy, is stale and says how old", async () => {
  const old = testRuntime({
    roadConditions: roads({ "i-80": i80(minutesAgo(5 * 60)) }),
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_road_conditions", {
      route: "I-80",
      response_format: "json",
    });
    assert.equal(r.structuredContent.stale, true);
    assert.match(r.structuredContent.notice, /5 hours old/);
    const md = await call(client, "dogpolicies_road_conditions", {
      route: "I-80",
    });
    assert.match(text(md), /STALE READING/);
  }, old);
  const held = testRuntime({
    roadConditions: roads({
      "i-80": i80(minutesAgo(20), {
        fallback: { reason: "no answer in 4000 ms", held_ms: 600_000 },
      }),
    }),
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_road_conditions", {
      route: "i-80",
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.stale, true);
    assert.match(r.structuredContent.notice, /failed just now/);
    assert.match(r.structuredContent.notice, /(19|20|21) minutes old/);
  }, held);
});

test("road_conditions: no document, a loader that throws, another route's document or no network: unavailable, never isError", async () => {
  for (const roadConditions of [
    async () => null,
    async () => {
      throw new Error("Durable Object reset");
    },
    async () => ({ ...i80(minutesAgo(5)), route: "i-5" }),
  ]) {
    await withClient(async (client) => {
      const r = await call(client, "dogpolicies_road_conditions", {
        route: "US 50",
        response_format: "json",
      });
      assert.ok(!r.isError);
      const s = r.structuredContent;
      assert.equal(s.outcome, "unavailable");
      assert.equal(s.route, "us-50");
      assert.equal(s.fetched_at, null);
      assert.equal(s.live_map, "https://quickmap.dot.ca.gov/");
      assert.match(s.message, /quickmap\.dot\.ca\.gov/);
      assert.deepEqual(s.closures, []);
    }, testRuntime({ roadConditions }));
  }
  // The offline package with no loader.
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_road_conditions", {
      route: "I-15",
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.outcome, "unavailable");
    assert.match(r.structuredContent.message, /without network access/);
  });
});

test("road_conditions: on I-5 the I-5 tool's own document serves when the host has no route loader", async () => {
  const i5 = {
    fetchedAt: minutesAgo(7),
    notice: "Conditions, not rules.",
    closures: [],
    weather: [
      {
        id: "rwis_2_2",
        kind: "weather",
        s: 1255000,
        mile: 780,
        strip: "siskiyou",
        name: "Anderson Grade",
      },
    ],
    signs: [],
    chainControls: [],
    source: { publisher: "Caltrans" },
  };
  await withClient(
    async (client) => {
      const r = await call(client, "dogpolicies_road_conditions", {
        route: "I-5",
        from_mile: 700,
        to_mile: 796,
        response_format: "json",
      });
      assert.ok(!r.isError);
      assert.equal(r.structuredContent.road, "I-5");
      assert.deepEqual(
        r.structuredContent.weather.map((w) => w.name),
        ["Anderson Grade"],
      );
      assert.deepEqual(r.structuredContent.window, {
        from_mile: 700,
        to_mile: 796,
      });
    },
    testRuntime({ conditions: async () => i5 }),
  );
});

test("road_conditions: the ways people name the four routes", () => {
  const cases = {
    "I-80": "i-80",
    "i-80": "i-80",
    80: "i-80",
    "Interstate 80": "i-80",
    "US 50": "us-50",
    "US-50": "us-50",
    "Highway 50": "us-50",
    "hwy 50": "us-50",
    "I-15": "i-15",
    15: "i-15",
    "I-5": "i-5",
    I5: "i-5",
  };
  for (const [asked, id] of Object.entries(cases))
    assert.equal(roadOf(asked).id, id, asked);
  assert.equal(roadOf("US-101").miss, "uncovered");
  assert.equal(
    roadOf("I-80 to Reno").id,
    "i-80",
    "the California part toward Reno",
  );
  assert.deepEqual(roadOf("i-80-nevada"), {
    miss: "outside",
    digits: "80",
    near: "i-80",
  });
  assert.equal(roadOf("Donner Pass").miss, "unread");
  // Caltrans writes reading times in California time; the feed's own epoch agrees.
  assert.equal(pacificEpoch("2026-11-09T21:14:02"), 1794287642);
  assert.equal(
    pacificEpoch("2026-05-19T12:56:01"),
    Date.UTC(2026, 4, 19, 19, 56, 1) / 1000,
  );
  assert.equal(pacificEpoch("not a time"), null);
  assert.deepEqual(Object.keys(ROAD_CONDITIONS_ROUTES).sort(), [
    "i-15",
    "i-5",
    "i-80",
    "us-50",
  ]);
});

test("road_conditions: a highway the loop does not follow is no_match with the four it does, never isError", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_road_conditions", {
      route: "US-101",
      response_format: "json",
    });
    assert.ok(!r.isError);
    const s = r.structuredContent;
    assert.equal(s.outcome, "no_match");
    assert.equal(s.code, "not_found");
    assert.deepEqual(s.did_you_mean.map((x) => x.route).sort(), [
      "i-15",
      "i-5",
      "i-80",
      "us-50",
    ]);
    assert.ok(s.next.some((n) => /dogpolicies_route_stops/.test(n)));
    assert.equal(s.route, null);
    const nv = await call(client, "dogpolicies_road_conditions", {
      route: "I-80 Nevada",
      response_format: "json",
    });
    assert.equal(nv.structuredContent.outcome, "no_match");
    assert.equal(nv.structuredContent.did_you_mean[0].route, "i-80");
    assert.match(nv.structuredContent.message, /outside California/);
    const md = text(
      await call(client, "dogpolicies_road_conditions", {
        route: "Highway 99",
      }),
    );
    assert.match(md, /^# Road not covered/);
    assert.match(md, /I-80 \(`i-80`\): San Francisco to the Nevada line/);
  }));

test("road_conditions: windows by mile, town and named stretch; an unknown or distant town is an answer", async () => {
  const rt = testRuntime({
    roadConditions: roads({
      "i-80": i80(minutesAgo(3)),
      "i-15": { ...i80(minutesAgo(3)), route: "i-15" },
    }),
  });
  const stretches = Boolean(
    sharedRuntime().graph.routes["i-80"].stretches?.length,
  );
  await withClient(async (client) => {
    const json = async (args) =>
      (
        await call(client, "dogpolicies_road_conditions", {
          ...args,
          response_format: "json",
        })
      ).structuredContent;
    const range = await json({ route: "I-80", from_mile: 170, to_mile: 180 });
    assert.deepEqual(range.window, { from_mile: 170, to_mile: 180 });
    assert.deepEqual(range.closures, []);
    assert.equal(range.counts.chain_control_points, 2);
    const truckee = await json({ route: "I-80", town: "Truckee" });
    assert.ok(
      truckee.window.from_mile <= 186 && truckee.window.to_mile >= 186,
      JSON.stringify(truckee.window),
    );
    const ahead = await json({
      route: "I-15",
      town: "Barstow",
      direction: "north",
      ahead_miles: 120,
    });
    assert.equal(ahead.window.town.name, "Barstow");
    assert.ok(
      ahead.window.from_mile > 170 && ahead.window.from_mile < 185,
      `Barstow at ${ahead.window.from_mile}`,
    );
    assert.equal(
      ahead.window.to_mile,
      sharedRuntime().graph.routes["i-15"].length_miles,
    );
    assert.equal(ahead.window.direction, "north");
    if (stretches) {
      const donner = await json({ route: "Donner Pass" });
      assert.equal(donner.route, "i-80");
      assert.equal(donner.window.stretch.name, "Donner Pass and Truckee");
      assert.equal(donner.chain_controls_in_effect, true);
      const echo = findStretch(
        sharedRuntime().graph.routes["us-50"],
        "Echo Summit",
      );
      assert.match(echo.name, /Echo Summit/);
    }
    const nowhere = await json({ route: "I-80", town: "Zzyzx Test Town" });
    assert.equal(nowhere.outcome, "no_match");
    assert.ok(nowhere.next.some((n) => /Leave town out/.test(n)));
    const far = await json({ route: "I-15", town: "Eureka" });
    assert.equal(far.outcome, "bad_input");
    assert.match(far.message, /miles from I-15/);
  }, rt);
});

test("road_conditions: the description starts from the traveler's question, says feed data not rules, and says it reports conditions, not stops, without naming another tool", () => {
  const t = toolDefinitions(sharedRuntime()).find(
    (x) => x.name === "dogpolicies_road_conditions",
  );
  assert.match(t.description, /^Do I need chains on I-80 to Tahoe right now\?/);
  assert.match(t.description, /not rules/);
  assert.match(t.description, /conditions, not places to stop/);
  assert.doesNotMatch(t.description, /dogpolicies_/);
  assert.doesNotMatch(
    t.description,
    /\b(you should|tell the user|first call|then call|instead of|use this tool|call dogpolicies_)\b/i,
  );
  assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(t.since, "0.5.0");
  assert.deepEqual(Object.keys(t.inputSchema.shape).sort(), [
    "ahead_miles",
    "direction",
    "from_mile",
    "response_format",
    "route",
    "to_mile",
    "town",
  ]);
});

test("road_conditions: a closure end no Date can hold reads 'end not set', never isError", async () => {
  const doc = i80(minutesAgo(9));
  doc.closures[0].endEpoch = 9999999999999;
  await withClient(async (client) => {
    for (const format of ["json", "markdown"]) {
      const r = await call(client, "dogpolicies_road_conditions", { route: "I-80", response_format: format });
      assert.ok(!r.isError, `${format}: ${text(r)}`);
    }
    const md = text(await call(client, "dogpolicies_road_conditions", { route: "I-80" }));
    assert.match(md, /Utility Work[^\n]*, end not set/);
    assert.doesNotMatch(md, /until null|Invalid/);
  }, testRuntime({ roadConditions: async (route) => (route === "i-80" ? doc : null) }));
});
