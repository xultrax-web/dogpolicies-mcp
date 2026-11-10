// The I-5 axis in the package (0.3.0): route_stops with ahead_miles, family
// and paired; the corridor tool by strip, miles and point; get_place's axis
// and paired stop; plan_trip's I-5 leg; the conditions tool offline; the
// corridor resource and the drive prompt. Fixtures: northbound at Harris
// Ranch (the family question), an exit pairing, a strip query.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, sharedRuntime, text, withClient } from "./helpers.mjs";

const HARRIS_RANCH = { lat: 36.2531, lon: -120.2504 };
const MI = 1609.344;

test("the snapshot carries the I-5 axis: calibration, strips, paired stops, and s on every I-5 stop", () => {
  const route = sharedRuntime().graph.routes["i-5"];
  assert.ok(route.axis, "routes['i-5'].axis");
  assert.match(route.axis.version, /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}$/);
  assert.equal(route.axis.strips.length, 11);
  assert.ok(route.axis.calibration.length > 800);
  assert.ok(route.axis.paired.length > 20);
  const withS = route.stops.filter((s) => s.s_m != null);
  assert.equal(withS.length, route.stops.length, "every I-5 stop has s_m");
  for (let i = 1; i < route.stops.length; i++)
    assert.ok(
      route.stops[i].s_m >= route.stops[i - 1].s_m,
      "stops sorted by s",
    );
  for (const s of route.stops) {
    assert.ok(["left", "right", "both"].includes(s.axis_side));
    assert.ok(Number.isInteger(s.elevation_m));
    assert.ok(s.strip);
  }
  // Other routes carry no axis.
  assert.equal(sharedRuntime().graph.routes["us-101"].axis, undefined);
  // No brand name travels with a pair.
  for (const p of route.axis.paired) {
    assert.deepEqual(Object.keys(p.peopleStops).sort(), [
      "cafe",
      "fast_food",
      "fuel",
      "total",
    ]);
    assert.ok(p.dogStop.distM <= 1500);
  }
});

test("route_stops: northbound at Harris Ranch, family=true, ahead_miles=40 finds nothing; 60 finds the Erreca rest area with hours and water", () =>
  withClient(async (client) => {
    const none = await call(client, "dogpolicies_route_stops", {
      route: "i-5",
      near: HARRIS_RANCH,
      direction: "north",
      ahead_miles: 40,
      family: true,
    });
    assert.ok(!none.isError);
    assert.equal(none.structuredContent.total, 0);
    assert.ok(
      Math.abs(none.structuredContent.start.mile - 333.5) < 1,
      `start ${none.structuredContent.start.mile}`,
    );
    assert.ok(
      none.structuredContent.start.s_m > 535_000 &&
        none.structuredContent.start.s_m < 539_000,
    );
    const r = await call(client, "dogpolicies_route_stops", {
      route: "i-5",
      near: HARRIS_RANCH,
      direction: "north",
      ahead_miles: 60,
      family: true,
      response_format: "json",
    });
    assert.ok(!r.isError);
    const j = JSON.parse(text(r));
    assert.ok(j.total >= 1);
    const first = j.stops[0];
    assert.equal(first.id, "john-chuck-erreca-rest-area-i-5-northbound");
    assert.ok(
      first.miles_ahead > 50 && first.miles_ahead < 54,
      `miles_ahead ${first.miles_ahead}`,
    );
    assert.equal(first.side, "right");
    assert.equal(first.restrooms, true);
    assert.equal(first.water, true);
    assert.equal(first.pet_area, true);
    assert.equal(first.family_stop, true);
    assert.ok(first.hours && /24 hours/.test(first.hours.text));
    assert.match(first.hours.source_url, /^https:\/\/dot\.ca\.gov\//);
    assert.ok(
      Number.isInteger(first.s_m) && Number.isInteger(first.elevation_m),
    );
    assert.equal(first.strip, "westside");
    // The southbound twin never appears northbound.
    assert.ok(
      !j.stops.some(
        (s) => s.id === "john-chuck-erreca-rest-area-i-5-southbound",
      ),
    );
    // Southbound from the same point, the window runs the other way.
    const south = await call(client, "dogpolicies_route_stops", {
      route: "i-5",
      near: HARRIS_RANCH,
      direction: "south",
      ahead_miles: 20,
      family: true,
      response_format: "json",
    });
    const sj = JSON.parse(text(south));
    assert.ok(sj.stops.every((s) => s.miles_ahead >= 0 && s.miles_ahead <= 20));
    assert.ok(sj.stops.some((s) => /coalinga-avenal.*southbound/.test(s.id)));
    assert.ok(sj.stops.every((s) => ["left", "both"].includes(s.side)));
  }));

test("route_stops: paired=true lists exits in the window with counts, never names, and a dog stop with its citation", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_route_stops", {
      route: "i-5",
      from_mile: 0,
      to_mile: 30,
      paired: true,
      limit: 3,
      response_format: "json",
    });
    assert.ok(!r.isError);
    const j = JSON.parse(text(r));
    assert.ok(j.paired_stops.length >= 3, `${j.paired_stops.length} pairs`);
    for (const p of j.paired_stops) {
      assert.equal(p.exit.source, "OpenStreetMap");
      assert.equal(p.people_stops.restrooms, "unverified");
      assert.ok(p.people_stops.total >= 1);
      assert.ok(p.dog_stop.citation.includes("Source:"));
      assert.ok(p.dog_stop.url.startsWith("https://"));
      assert.ok(p.miles_ahead >= 0);
      assert.doesNotMatch(
        JSON.stringify(p.people_stops),
        /starbucks|mcdonald|chevron|in-n-out/i,
      );
    }
    const md = text(
      await call(client, "dogpolicies_route_stops", {
        route: "i-5",
        from_mile: 0,
        to_mile: 30,
        paired: true,
        limit: 3,
      }),
    );
    assert.match(md, /## \d+ paired stops in the window/);
    assert.match(md, /restrooms not verified/);
    assert.match(md, /OpenStreetMap data \(ODbL/);
  }));

test("route_stops on a route without an axis is unchanged: no s_m, no paired block", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_route_stops", {
      route: "us-101",
      from_mile: 69,
      to_mile: 130,
      paired: true,
      response_format: "json",
    });
    assert.ok(!r.isError);
    const j = JSON.parse(text(r));
    assert.ok(j.total > 0);
    assert.equal(j.stops[0].s_m, undefined);
    assert.equal(j.paired_stops, undefined);
    assert.equal(j.start, undefined);
  }));

test("i5_corridor: no window lists the 11 stretches; a strip, a mile range and a point each give stops with s", () =>
  withClient(async (client) => {
    const all = await call(client, "dogpolicies_i5_corridor", {
      response_format: "json",
    });
    assert.ok(!all.isError);
    const j = JSON.parse(text(all));
    assert.equal(j.strips.length, 11);
    assert.equal(j.strips[0].id, "sandiego");
    assert.equal(j.strips[0].from_mile, 0);
    assert.ok(j.strips.at(-1).to_mile > 790);
    assert.equal(j.window, null);
    assert.equal(j.stops.length, 0);
    for (let i = 1; i < j.strips.length; i++)
      assert.ok(j.strips[i].start_s_m > j.strips[i - 1].start_s_m);

    const grapevine = JSON.parse(
      text(
        await call(client, "dogpolicies_i5_corridor", {
          strip: "grapevine",
          kinds: ["rest_area"],
          response_format: "json",
        }),
      ),
    );
    assert.equal(grapevine.window.kind, "strip");
    assert.ok(
      grapevine.stops.some((s) => /tejon-pass/.test(s.id)),
      "Tejon Pass is in the Grapevine strip",
    );
    for (const s of grapevine.stops) {
      assert.equal(s.strip, "grapevine");
      assert.ok(
        s.s_m >= grapevine.window.lo_s && s.s_m <= grapevine.window.hi_s,
      );
    }

    const miles = JSON.parse(
      text(
        await call(client, "dogpolicies_i5_corridor", {
          from_mile: 300,
          to_mile: 340,
          response_format: "json",
          limit: 50,
        }),
      ),
    );
    assert.equal(miles.window.kind, "miles");
    assert.ok(miles.stops.some((s) => s.id === "harris-ranch-inn"));
    assert.ok(miles.stops.every((s) => s.mile >= 299 && s.mile <= 341));

    const ahead = JSON.parse(
      text(
        await call(client, "dogpolicies_i5_corridor", {
          near: HARRIS_RANCH,
          direction: "north",
          ahead_miles: 60,
          family: true,
          paired: true,
          response_format: "json",
        }),
      ),
    );
    assert.equal(ahead.window.kind, "ahead");
    assert.equal(ahead.window.strip, "westside");
    assert.equal(
      ahead.stops[0].id,
      "john-chuck-erreca-rest-area-i-5-northbound",
    );
    assert.ok(
      ahead.stops.every(
        (s) => s.family_stop && s.miles_ahead > 0 && s.miles_ahead <= 60,
      ),
    );
    assert.ok(Array.isArray(ahead.paired_stops));

    const md = text(
      await call(client, "dogpolicies_i5_corridor", { strip: "shasta" }),
    );
    assert.match(
      md.split("\n")[0],
      /^# \d+ dog stops on I-5, Red Bluff → Mt Shasta/,
    );
    assert.match(md, /DogPolicies, dogpolicies\.com, CC BY 4\.0/);
    const far = await call(client, "dogpolicies_i5_corridor", {
      near: { lat: 36.555, lon: -121.923 },
    });
    assert.ok(!far.isError, "a point far from I-5 is an answer");
    assert.equal(far.structuredContent.outcome, "bad_input");
    assert.equal(far.structuredContent.code, "invalid");
    assert.ok(far.structuredContent.nearest_i5.miles_away > 25);
    assert.equal(far.structuredContent.total, 0);
    assert.match(text(far), /miles from I-5/);
  }));

test("get_place: an I-5 stop carries axis; a pairing's dog side carries paired_stop; elsewhere both are null", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_get_place", {
      id: "harris-ranch-inn",
      response_format: "json",
    });
    const j = JSON.parse(text(r));
    assert.equal(j.axis.route, "i-5");
    assert.ok(j.axis.s > 536_000 && j.axis.s < 538_000);
    assert.ok(Math.abs(j.axis.mile - 333.4) < 0.5);
    assert.equal(j.axis.strip, "westside");
    const md = text(
      await call(client, "dogpolicies_get_place", { id: "harris-ranch-inn" }),
    );
    assert.match(
      md,
      /On I-5 at mile 333\.\d, \d+\.\d mi off the freeway, (northbound side|southbound side|both directions), road at [\d,]+ ft/,
    );
    const pairs = sharedRuntime().graph.routes["i-5"].axis.paired;
    const dog = pairs[0].dogStop.placeId;
    const pr = JSON.parse(
      text(
        await call(client, "dogpolicies_get_place", {
          id: dog,
          response_format: "json",
        }),
      ),
    );
    assert.ok(pr.paired_stop, "the dog side of a pair carries it");
    assert.equal(pr.paired_stop.dog_stop.placeId, dog);
    assert.equal(pr.paired_stop.people_stops.restrooms, "unverified");
    const carmel = JSON.parse(
      text(
        await call(client, "dogpolicies_get_place", {
          id: "carmel-beach",
          response_format: "json",
        }),
      ),
    );
    assert.equal(carmel.axis, null);
    assert.equal(carmel.paired_stop, null);
  }));

test("plan_trip: a town on I-5 gets the drive leg; a coastal town does not", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_plan_trip", {
      place: "Coalinga",
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    const j = JSON.parse(text(r));
    assert.ok(j.i5, "Coalinga is on I-5");
    assert.ok(j.i5.position.s > 500_000 && j.i5.position.s < 580_000);
    assert.ok(
      Array.isArray(j.i5.family_stops_north) &&
        Array.isArray(j.i5.family_stops_south),
    );
    for (const s of [...j.i5.family_stops_north, ...j.i5.family_stops_south]) {
      assert.equal(s.family_stop, true);
      assert.ok(s.miles_ahead >= 0 && s.miles_ahead <= 60);
    }
    const md = text(
      await call(client, "dogpolicies_plan_trip", { place: "Coalinga" }),
    );
    assert.match(md, /## On I-5: mile \d+/);
    const monterey = JSON.parse(
      text(
        await call(client, "dogpolicies_plan_trip", {
          place: "Monterey",
          response_format: "json",
        }),
      ),
    );
    assert.equal(monterey.i5, null);
  }));

test("i5_conditions: offline answers unavailable with the live page; the input schema takes a window", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      from_mile: 170,
      to_mile: 222,
    });
    assert.ok(!r.isError, "no network is an answer, not an error");
    assert.equal(r.structuredContent.outcome, "unavailable");
    assert.equal(r.structuredContent.fetched_at, null);
    assert.deepEqual(r.structuredContent.closures, []);
    assert.match(text(r), /road-trips\/i-5\//);
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "dogpolicies_i5_conditions");
    assert.ok(t.description.includes("not verified rules"));
    assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), [
      "ahead_miles",
      "direction",
      "from_mile",
      "near",
      "response_format",
      "to_mile",
    ]);
  }));

test("i5_conditions: with a network and a document, items in the window come back placed on the axis", async () => {
  const doc = {
    fetchedAt: "2026-11-04T18:00:00.000Z",
    notice: "Conditions are feed data, not rules.",
    source: {
      publisher: "Caltrans",
      portal: "https://cwwp2.dot.ca.gov/",
      terms: { checked: "2026-11-04" },
    },
    closures: [
      {
        id: "lcs_A",
        sBegin: 330_000,
        sEnd: 332_000,
        mileBegin: 205,
        mileEnd: 206.2,
        direction: "northbound",
        type: "Lane",
        work: "Paving",
        lanesClosed: "1",
        totalLanes: "4",
        where: "Tejon Pass",
        endEpoch: 1793900000,
        indefinite: false,
        nearestStop: { name: "Tejon Pass Rest Area", milesAway: 0.3 },
      },
    ],
    weather: [
      {
        id: "rwis_1",
        s: 331_000,
        mile: 205.6,
        name: "Tejon Summit",
        elevationFt: 4160,
        airF: 34,
        surfaceF: 31,
        windMph: 22,
        gustMph: 35,
        visibilityMi: 2.5,
        nearestStop: { name: "Tejon Pass Rest Area", milesAway: 0.2 },
      },
    ],
    signs: [
      {
        id: "cms_1",
        s: 325_000,
        mile: 202,
        name: "Gorman",
        direction: "northbound",
        lines: ["CHAINS REQUIRED", "AHEAD"],
        chains: true,
      },
    ],
    chainControls: [
      {
        id: "cc_1",
        s: 326_000,
        mile: 202.6,
        name: "Gorman",
        direction: "northbound",
        status: "R-1",
        statusText: "Chains are required",
        inEffect: true,
        statusAt: "2026-11-04T17:30:00",
      },
      {
        id: "cc_2",
        s: 900_000,
        mile: 560,
        name: "Dunnigan",
        direction: "both",
        status: "R-0",
        statusText: "No chain controls are in effect at this time.",
        inEffect: false,
        statusAt: null,
      },
    ],
  };
  const fetch = async (url) => {
    assert.match(url, /\/api\/v1\/conditions\/i-5\.json$/);
    return new Response(JSON.stringify(doc), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const { testRuntime } = await import("./helpers.mjs");
  const ctx = testRuntime({
    offline: false,
    baseUrl: "https://dogpolicies.com",
    fetch,
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      from_mile: 170,
      to_mile: 222,
      response_format: "json",
    });
    assert.ok(!r.isError, text(r));
    const j = JSON.parse(text(r));
    assert.equal(j.fetched_at, doc.fetchedAt);
    assert.equal(j.closures.length, 1);
    assert.equal(j.weather.length, 1);
    assert.equal(j.signs.length, 1);
    assert.equal(j.chain_controls.length, 1, "Dunnigan is outside the window");
    assert.equal(j.chains_in_effect, true);
    const md = text(
      await call(client, "dogpolicies_i5_conditions", {
        from_mile: 170,
        to_mile: 222,
      }),
    );
    assert.match(md, /CHAIN CONTROLS IN EFFECT/);
    assert.match(md, /not rules/);
    assert.match(md, /Tejon Summit/);
    const north = JSON.parse(
      text(
        await call(client, "dogpolicies_i5_conditions", {
          near: { lat: 38.9, lon: -121.97 },
          direction: "north",
          ahead_miles: 30,
          response_format: "json",
        }),
      ),
    );
    assert.equal(north.chain_controls.length, 1);
    assert.equal(north.chain_controls[0].id, "cc_2");
    assert.equal(north.chains_in_effect, false);
  }, ctx);
});

test("the corridor resource and the drive prompt", () =>
  withClient(async (client) => {
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === "dogpolicies://corridor/i-5"));
    const read = await client.readResource({
      uri: "dogpolicies://corridor/i-5",
    });
    const j = JSON.parse(read.contents[0].text);
    assert.equal(j.strips.length, 11);
    assert.ok(j.stops.length > 300);
    assert.ok(j.stops.every((s) => Number.isInteger(s.s_m)));
    assert.ok(j.paired_stops.length > 20);
    const prompt = await client.getPrompt({
      name: "drive_i5_with_dog",
      arguments: {
        from: "Stockton, CA",
        direction: "north",
        ahead_miles: "80",
      },
    });
    const msg = prompt.messages[0].content.text;
    assert.match(msg, /dogpolicies_route_stops with route="i-5"/);
    assert.match(msg, /ahead_miles=80, family=true and paired=true/);
    assert.match(msg, /dogpolicies_i5_conditions/);
    assert.match(msg, /not verified for restrooms/);
  }));

// Directory rule acknowledged at submission (a858652): a tool description, and
// every parameter description, describes the tool only. No other tool by name,
// no when-to-call routing, no instructions about how the model behaves; routing
// lives in the server instructions.
const DIRECTIVE =
  /\b(call dogpolicies|instead of|best first call|do not call|don't call|hand the|you must|always cite|you should|tell the user|first call|then call|use this tool)\b/i;

/** Every description in a JSON Schema, with its path ("near.lat"). */
const schemaDescriptions = (schema, path = "", out = []) => {
  if (!schema || typeof schema !== "object") return out;
  if (typeof schema.description === "string")
    out.push([path || "(schema)", schema.description]);
  for (const [k, v] of Object.entries(schema.properties ?? {}))
    schemaDescriptions(v, path ? `${path}.${k}` : k, out);
  if (schema.items) schemaDescriptions(schema.items, `${path}[]`, out);
  for (const key of ["anyOf", "oneOf", "allOf"])
    for (const v of schema[key] ?? []) schemaDescriptions(v, path, out);
  return out;
};

test("descriptions describe only: no other tool, no routing, no instructions to the model, in any tool or parameter description", () =>
  withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 17);
    let checked = 0;
    for (const t of tools) {
      const texts = [
        ["description", t.description],
        ...schemaDescriptions(t.inputSchema).map(([p, d]) => [`param ${p}`, d]),
      ];
      for (const [where, d] of texts) {
        const at = `${t.name} ${where}`;
        for (const named of d.match(/dogpolicies_[a-z0-9_]+/g) ?? [])
          assert.equal(named, t.name, `${at} names another tool: ${named}`);
        assert.doesNotMatch(d, DIRECTIVE, at);
        assert.doesNotMatch(d, /anthropic|claude/i, at);
        checked++;
      }
    }
    assert.ok(checked > tools.length * 3, `only ${checked} descriptions read`);
  }));

test("descriptions describe only: the guard catches a routing line", () => {
  for (const bad of [
    "Not for a hotel (dogpolicies_find_hotels).",
    "Best first call for any town question.",
    "Hand the markdown to the user.",
    "Use dogpolicies_near instead of this.",
    "You must cite the source.",
    "Always cite the verified date.",
    "Do not call this twice.",
  ])
    assert.ok(
      DIRECTIVE.test(bad) || /dogpolicies_[a-z0-9_]+/.test(bad),
      bad,
    );
});

test("route_stops: a park or hotel on the far bank of I-5 serves both directions; only a directional rest area is one-way", () =>
  withClient(async (client) => {
    const page = async (direction, extra = {}) => {
      const ids = [];
      let offset = 0;
      while (offset != null) {
        const r = await call(client, "dogpolicies_route_stops", {
          from_mile: 200,
          to_mile: 222,
          direction,
          limit: 50,
          offset,
          response_format: "json",
          ...extra,
        });
        ids.push(...r.structuredContent.stops.map((s) => s.id));
        offset = r.structuredContent.next_offset ?? null;
      }
      return ids;
    };
    const north = await page("north");
    const south = await page("south");
    // Fort Tejon sits on the left bank (axis_side left) with no one-way side: both directions
    assert.ok(
      north.includes("fort-tejon-state-historic-park"),
      "northbound sees the left-bank park",
    );
    assert.ok(
      south.includes("fort-tejon-state-historic-park"),
      "southbound sees it too",
    );
    // the rest areas keep their direction
    assert.ok(north.includes("tejon-pass-rest-area-i-5-northbound"));
    assert.ok(
      !north.includes("tejon-pass-rest-area-i-5-southbound"),
      "a southbound rest area is not a northbound stop",
    );
    assert.ok(south.includes("tejon-pass-rest-area-i-5-southbound"));
    assert.ok(!south.includes("tejon-pass-rest-area-i-5-northbound"));
  }));
