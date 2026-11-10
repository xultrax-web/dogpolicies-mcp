// Input a model will plausibly send (decision 111): synonyms read before the
// schema checks them, a value that maps to nothing answered as bad_input with
// what is accepted, and free-text search read as a kind and a place. The
// advertised JSON Schema keeps listing the canonical values.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, sharedRuntime, text, withClient } from "./helpers.mjs";
import { parseQuery } from "../src/dogpolicies/tools/query-words.mjs";
import {
  KINDS,
  KIND_SYNONYMS,
  choice,
  choiceList,
  dateInput,
  flag,
  lookup,
  makeTable,
  pointInput,
} from "../src/dogpolicies/tools/tolerant.mjs";
import { toolDefinitions } from "../src/dogpolicies/server.mjs";

const NAMES = toolDefinitions(sharedRuntime()).map((t) => t.name);

test("tools/list still lists the canonical values, whatever the tool accepts", () =>
  withClient(async (client) => {
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
    const kinds = by.dogpolicies_route_stops.properties.kinds;
    assert.equal(kinds.type, "array");
    assert.deepEqual(kinds.items.enum, KINDS);
    assert.deepEqual(by.dogpolicies_route_stops.properties.direction.enum, [
      "north",
      "south",
      "east",
      "west",
    ]);
    assert.equal(
      by.dogpolicies_route_stops.properties.direction.default,
      "north",
    );
    assert.deepEqual(by.dogpolicies_search_places.properties.state.enum, [
      "CA",
      "NV",
    ]);
    assert.ok(
      by.dogpolicies_search_places.properties.type.enum.includes("lodging"),
    );
    assert.equal(
      by.dogpolicies_search_places.properties.dogs_allowed.type,
      "boolean",
    );
    assert.ok(
      by.dogpolicies_route_stops.properties.route.enum.includes("us-101"),
    );
    assert.equal(by.dogpolicies_search_places.properties.limit.maximum, 50);
    assert.equal(
      by.dogpolicies_changes_since.properties.since.pattern,
      "^\\d{4}-\\d{2}-\\d{2}$",
    );
    for (const t of tools)
      assert.equal(t.inputSchema.additionalProperties, false);
  }));

test("route_stops: hotel, NB, a string for the list, 'yes' for a boolean: all read, none refused", () =>
  withClient(async (client) => {
    const base = { from_mile: 170, to_mile: 222, response_format: "json" };
    const canon = await call(client, "dogpolicies_route_stops", {
      ...base,
      kinds: ["lodging"],
      direction: "north",
    });
    assert.ok(canon.structuredContent.total > 0);
    assert.equal(canon.structuredContent.resolved_from, undefined);
    for (const [kinds, direction] of [
      [["hotel"], "NB"],
      [["Hotels"], "northbound"],
      ["motel", "heading north"],
      [["stay"], "N"],
      ["hotels, motels", "North"],
    ]) {
      const r = await call(client, "dogpolicies_route_stops", {
        ...base,
        kinds,
        direction,
      });
      assert.ok(!r.isError, JSON.stringify({ kinds, direction }));
      assert.equal(r.structuredContent.outcome, undefined);
      assert.equal(r.structuredContent.total, canon.structuredContent.total);
      assert.deepEqual(r.structuredContent.resolved_from.kinds.used, [
        "lodging",
      ]);
    }
    const nb = await call(client, "dogpolicies_route_stops", {
      ...base,
      kinds: ["hotel"],
      direction: "NB",
    });
    assert.deepEqual(nb.structuredContent.resolved_from, {
      kinds: { asked: ["hotel"], used: ["lodging"] },
      direction: { asked: "NB", used: "north" },
    });
    assert.match(
      text(
        await call(client, "dogpolicies_route_stops", {
          ...base,
          kinds: ["hotel"],
          response_format: "markdown",
        }),
      ),
      /Read kinds "hotel" as lodging\./,
    );
    // booleans and numbers sent as strings
    const s = await call(client, "dogpolicies_route_stops", {
      from_mile: "170",
      to_mile: "222",
      family: "yes",
      dog_friendly_only: "true",
      limit: "5",
      response_format: "json",
    });
    assert.ok(!s.isError && s.structuredContent.total >= 0);
    assert.ok(s.structuredContent.count <= 5);
  }));

test("route_stops: a route as people say it", () =>
  withClient(async (client) => {
    const want = {
      "I-5": "I-5",
      i5: "I-5",
      "Interstate 5": "I-5",
      101: "US-101",
      "Highway 101": "US-101",
      "US 101": "US-101",
      PCH: "Highway 1",
      "Hwy 1": "Highway 1",
      "I-80": "I-80",
      "Interstate 80 Nevada": "I-80",
      "US-95": "US-95",
      "nevada i-15": "I-15",
    };
    for (const [asked, short] of Object.entries(want)) {
      const r = await call(client, "dogpolicies_route_stops", {
        route: asked,
        limit: 1,
        response_format: "json",
      });
      assert.ok(!r.isError, asked);
      assert.notEqual(r.structuredContent.outcome, "bad_input", asked);
      assert.equal(r.structuredContent.route, short, asked);
    }
    const nv = await call(client, "dogpolicies_route_stops", {
      route: "Interstate 80 Nevada",
      limit: 1,
      response_format: "json",
    });
    assert.match(nv.structuredContent.guide, /i-80-nevada/);
  }));

test("a value that maps to nothing is a bad_input answer that lists what is accepted", () =>
  withClient(async (client) => {
    const r = await call(client, "dogpolicies_route_stops", {
      kinds: ["spaceship"],
      direction: "sideways",
      response_format: "json",
    });
    assert.ok(!r.isError);
    const sc = r.structuredContent;
    assert.equal(sc.outcome, "bad_input");
    assert.equal(sc.code, "invalid");
    assert.deepEqual(sc.accepted.kinds, KINDS);
    assert.deepEqual(sc.accepted.direction, ["north", "south", "east", "west"]);
    assert.deepEqual(sc.stops, []);
    assert.equal(sc.total, 0);
    assert.match(sc.message, /spaceship/);
    assert.ok(sc.next.some((n) => /lodging/.test(n)));
    const md = await call(client, "dogpolicies_route_stops", {
      kinds: ["spaceship"],
    });
    assert.match(text(md), /^# Arguments not usable/);
    assert.match(text(md), /accepted: rest_area, stop, lodging/);
  }));

test("every tool answers wrong arguments as bad_input and passes its own output schema", () =>
  withClient(async (client) => {
    for (const name of NAMES) {
      for (const args of [
        { nope: 1 },
        { response_format: "xml-ish" },
        {
          limit: { x: 1 },
          since: 5,
          id: 7,
          ids: 9,
          place: {},
          near: "nowhere",
        },
      ]) {
        const r = await client.callTool({ name, arguments: args });
        assert.ok(!r.isError, `${name} ${JSON.stringify(args)}`);
        assert.equal(r.structuredContent.outcome, "bad_input", name);
        assert.ok(r.structuredContent.next.length, name);
      }
    }
  }));

test("words for the other enums: state, type, brand, area, region, outcome, format", () =>
  withClient(async (client) => {
    const ok = async (name, args) => {
      const r = await call(client, name, { response_format: "json", ...args });
      assert.ok(!r.isError, `${name} ${JSON.stringify(args)}`);
      assert.notEqual(
        r.structuredContent.outcome,
        "bad_input",
        `${name} ${JSON.stringify(args)}`,
      );
      return r.structuredContent;
    };
    const st = await ok("dogpolicies_search_places", {
      state: "Nevada",
      type: "dog parks",
      dogs_allowed: "true",
      limit: 100,
    });
    assert.ok(st.places.every((p) => p.state === "NV" && p.type === "park"));
    assert.equal(st.resolved_from.state.used, "NV");
    assert.equal(st.resolved_from.type.used, "park");
    const hike = await ok("dogpolicies_search_places", {
      type: "hiking",
      county: "Marin County",
    });
    assert.ok(hike.places.every((p) => p.type === "trail"));
    const sd = await ok("dogpolicies_search_places", {
      type: "Beaches",
      area: "Lake Tahoe",
      dogs_allowed: "yes",
    });
    assert.ok(sd.places.every((p) => p.type === "beach"));
    assert.deepEqual(
      (await ok("dogpolicies_search_places", { area: "Tahoe", type: "beach" }))
        .resolved_from.area,
      {
        asked: "Tahoe",
        used: "lake-tahoe",
      },
    );
    assert.ok(
      (
        await ok("dogpolicies_search_places", {
          region: "Central Coast",
          type: "beach",
        })
      ).total > 0,
    );
    const m6 = await ok("dogpolicies_find_hotels", { brand: "Motel 6" });
    assert.ok(m6.total > 0);
    assert.ok(
      (await ok("dogpolicies_find_hotels", { brand: "La Quinta" })).total > 0,
    );
    const near = await ok("dogpolicies_near", {
      place: "Carmel",
      types: "beaches and parks",
      dogs_allowed_only: "false",
    });
    assert.deepEqual(near.groups.map((g) => g.type).sort(), ["beach", "park"]);
    const plan = await ok("dogpolicies_plan_trip", {
      place: "Monterey",
      stay_types: ["Hotel", "camping"],
      nights: "2",
      include_possible: "no",
    });
    assert.ok(
      plan.stays.every((p) => ["lodging", "campground"].includes(p.type)),
    );
    const ch = await ok("dogpolicies_changes_since", {
      since: "2026/01/01",
      outcome: "rule change",
    });
    assert.ok(ch.events.every((e) => e.outcome === "changed"));
    assert.equal(
      (
        await ok("dogpolicies_changes_since", {
          since: "2026-01",
          response_format: "JSON",
        })
      ).total >= 0,
      true,
    );
    const corr = await ok("dogpolicies_i5_corridor", {
      strip: "the Grapevine",
      direction: "Southbound",
      kinds: "rest area",
      family: "1",
    });
    assert.ok(!corr.outcome);
    assert.equal(corr.resolved_from.strip.used, "grapevine");
    const cond = await ok("dogpolicies_i5_conditions", {
      from_mile: "170",
      to_mile: "222",
      direction: "SB",
    });
    assert.ok(cond);
    // a point as {latitude, longitude} or "lat,lon"
    for (const near of [
      { latitude: 36.6, longitude: -121.9, radius: 10 },
      "36.6, -121.9",
    ]) {
      const r = await ok("dogpolicies_search_places", { near, type: "beach" });
      assert.ok(r.total > 0);
    }
    // comparing: a comma list
    const both = await ok("dogpolicies_compare_places", {
      ids: "carmel-beach, carmel-river-state-beach",
    });
    assert.ok(both.places.length >= 1);
  }));

test("the synonym tables: the words a model sends for each kind", () => {
  const kind = makeTable(KINDS, KIND_SYNONYMS);
  const cases = {
    lodging: [
      "hotel",
      "Hotels",
      "motel",
      "stay",
      "lodging",
      "inn",
      "resort",
      "Dog Friendly Hotels",
      "place to stay",
    ],
    campground: [
      "campground",
      "camping",
      "campsite",
      "RV park",
      "rv_park",
      "campgrounds",
    ],
    cabins: ["cabin", "Cabins", "cottage"],
    beach: ["beach", "beaches", "Dog Beach"],
    park: [
      "dog park",
      "dog_park",
      "dogpark",
      "Dog Parks",
      "state park",
      "off-leash park",
    ],
    trail: ["trail", "trails", "hike", "hiking", "hikes", "trailhead"],
    restaurant: [
      "restaurant",
      "patio",
      "food",
      "dining",
      "winery",
      "brewery",
      "cafe",
      "tasting room",
    ],
    rest_area: [
      "rest area",
      "rest stop",
      "rest_area",
      "Rest-Area",
      "rest areas",
    ],
    stop: ["truck stop", "gas station", "travel stop"],
  };
  for (const [canon, words] of Object.entries(cases))
    for (const w of words)
      assert.equal(lookup(kind, w), canon, `${w} is ${canon}`);
  assert.equal(lookup(kind, "spaceship"), undefined);
  const dir = choice(["north", "south"], {
    north: ["n", "nb", "northbound"],
    south: ["s", "sb", "southbound"],
  });
  assert.equal(dir.parse("NB"), "north");
  assert.equal(dir.parse("Going South"), "south");
  assert.throws(() => dir.parse("up and over"));
  assert.deepEqual(
    choiceList(["a", "b"], { a: ["alpha"] }).parse("alpha, b and alpha"),
    ["a", "b"],
  );
  const f = flag();
  for (const [v, want] of [
    ["yes", true],
    ["No", false],
    ["TRUE", true],
    ["0", false],
    [1, true],
    [false, false],
  ])
    assert.equal(f.parse(v), want);
  assert.throws(() => f.parse("maybe"));
  assert.deepEqual(pointInput("36.6,-121.9"), { lat: 36.6, lon: -121.9 });
  assert.deepEqual(pointInput({ latitude: "36.6", lng: -121.9 }), {
    lat: 36.6,
    lon: -121.9,
  });
  assert.equal(dateInput("2026/9/1"), "2026-09-01");
  assert.equal(dateInput("2026-09"), "2026-09-01");
  assert.equal(dateInput("2026-09-01T10:00:00Z"), "2026-09-01");
  assert.equal(dateInput("yesterday"), "yesterday");
});

test("parseQuery: kind words, dog words and connectives come out; the name is what is left", () => {
  const cases = [
    [
      "June Lake cabins",
      {
        kinds: ["cabins", "lodging", "campground"],
        name: "june lake",
        dogs: false,
      },
    ],
    [
      "patio restaurant Alameda",
      { kinds: ["restaurant"], name: "alameda", dogs: false },
    ],
    [
      "dog friendly hotels in Carmel",
      { kinds: ["lodging"], name: "carmel", dogs: true },
    ],
    [
      "beaches near Santa Cruz that allow dogs",
      { kinds: ["beach"], name: "santa cruz", dogs: true },
    ],
    [
      "hikes in Yosemite with dogs",
      { kinds: ["trail"], name: "yosemite", dogs: true },
    ],
    [
      "wineries Healdsburg dogs",
      { kinds: ["restaurant"], name: "healdsburg", dogs: true },
    ],
    [
      "dog parks around Sacramento",
      { kinds: ["park"], name: "sacramento", dogs: false },
    ],
    [
      "Dog-friendly hotels at Lake Tahoe",
      { kinds: ["lodging"], name: "lake tahoe", dogs: true },
    ],
    [
      "Can I bring my dog to Carmel Beach",
      { kinds: ["beach"], name: "carmel", dogs: false },
    ],
    ["Motel 6 Fresno", { kinds: ["lodging"], name: "6 fresno", dogs: false }],
    [
      "Point Lobos",
      { kinds: [], name: "point lobos", dogs: false, changed: false },
    ],
  ];
  for (const [q, want] of cases) {
    const got = parseQuery(q);
    for (const [k, v] of Object.entries(want))
      assert.deepEqual(got[k], v, `${q}: ${k}`);
  }
  assert.equal(parseQuery("off leash dog parks in Las Vegas").offLeash, true);
});

// 26 realistic phrasings, the two eval phrases among them: each finds the right kind in the right place
const PHRASES = [
  [
    "June Lake cabins",
    { type: ["cabins", "lodging", "campground"], text: /june lake/i },
  ],
  ["patio restaurant Alameda", { type: ["restaurant"], text: /alameda/i }],
  [
    "dog friendly hotels in Carmel",
    { type: ["lodging"], text: /carmel/i, dogs: true },
  ],
  [
    "beaches near Santa Cruz that allow dogs",
    { type: ["beach"], text: /santa cruz/i, dogs: true },
  ],
  [
    "Lake Tahoe cabins with my dog",
    { type: ["cabins", "lodging", "campground"], dogs: true },
  ],
  [
    "hikes in Yosemite with dogs",
    { type: ["trail"], text: /yosemite/i, dogs: true },
  ],
  [
    "wineries Healdsburg dogs",
    { type: ["restaurant"], text: /healdsburg/i, dogs: true },
  ],
  ["motels in Fresno", { type: ["lodging"], text: /fresno/i }],
  ["dog parks in Sacramento", { type: ["park"], text: /sacramento/i }],
  ["campgrounds near Big Sur", { type: ["campground"], text: /big sur/i }],
  ["restaurants with patios in Napa", { type: ["restaurant"], text: /napa/i }],
  [
    "pet friendly hotels San Diego",
    { type: ["lodging"], text: /san diego/i, dogs: true },
  ],
  ["trails near Mammoth Lakes", { type: ["trail"], text: /mammoth/i }],
  ["rv parks near Bishop", { type: ["campground"], text: /bishop/i }],
  [
    "breweries in San Luis Obispo",
    { type: ["restaurant"], text: /san luis obispo|paso robles|slo/i },
  ],
  [
    "cabins in Big Bear",
    { type: ["cabins", "lodging", "campground"], text: /big bear/i },
  ],
  [
    "hotels that allow dogs in Reno",
    { type: ["lodging"], text: /reno/i, dogs: true },
  ],
  [
    "dog-friendly cafes in Berkeley",
    { type: ["restaurant"], text: /berkeley/i, dogs: true },
  ],
  [
    "state parks near Monterey that allow dogs",
    { type: ["park"], text: /monterey/i, dogs: true },
  ],
  [
    "off leash dog parks in Las Vegas",
    { type: ["park"], text: /las vegas|clark/i, offLeash: true },
  ],
  [
    "where can I stay with my dog in Truckee",
    { type: ["lodging"], text: /truckee|tahoe/i, dogs: true },
  ],
  [
    "dog friendly beaches in Malibu",
    { type: ["beach"], text: /malibu/i, dogs: true },
  ],
  [
    "campgrounds in Mendocino that take dogs",
    { type: ["campground"], dogs: true },
  ],
  ["Hotels Palm Springs", { type: ["lodging"], text: /palm springs/i }],
  ["trail Lake Tahoe dogs", { type: ["trail"], dogs: true }],
  ["beach Carmel", { type: ["beach"], text: /carmel/i }],
];

test("search_places: free text is read as a kind and a place (26 phrasings)", () =>
  withClient(async (client) => {
    for (const [query, want] of PHRASES) {
      const r = await call(client, "dogpolicies_search_places", {
        query,
        limit: 50,
        response_format: "json",
      });
      const sc = r.structuredContent;
      assert.ok(!r.isError, query);
      assert.ok(
        sc.total > 0,
        `${query}: found ${sc.total} (${sc.outcome} ${sc.message ?? ""})`,
      );
      assert.notEqual(sc.outcome, "no_match", query);
      if (sc.query_read?.type || want.type)
        for (const p of sc.places)
          if (sc.outcome !== "partial")
            assert.ok(
              want.type.includes(p.type),
              `${query}: ${p.name} is ${p.type}`,
            );
      if (want.dogs && sc.outcome !== "partial")
        assert.ok(
          sc.places.every((p) => ["yes", "yes_restricted"].includes(p.status)),
          query,
        );
      if (want.text && sc.outcome !== "partial")
        assert.ok(
          sc.places.some((p) =>
            want.text.test(`${p.name} ${p.city} ${p.county} ${p.area}`),
          ),
          `${query}: ${sc.places.map((p) => p.name).join(" | ")}`,
        );
      if (want.offLeash) assert.equal(sc.query_read.off_leash, true);
      if (sc.query_read) assert.ok(sc.message, `${query} says how it was read`);
    }
  }));

test("search_places: a name that matches as typed is not second-guessed; one that matches nothing falls back and says so", () =>
  withClient(async (client) => {
    const exact = await call(client, "dogpolicies_search_places", {
      query: "Carmel Beach",
      response_format: "json",
    });
    assert.equal(exact.structuredContent.query_read, undefined);
    assert.ok(
      exact.structuredContent.places.some((p) => p.name === "Carmel Beach"),
    );
    // the kind finds nothing there: the place without it, as a partial answer
    const dropped = await call(client, "dogpolicies_search_places", {
      query: "trail Pismo Beach",
      response_format: "json",
    });
    const d = dropped.structuredContent;
    if (d.outcome === "partial") {
      assert.match(d.message, /Read "trail Pismo Beach" as/);
      assert.ok(d.total > 0);
    }
    // only some words match: the best-matching places, with what matched
    const some = await call(client, "dogpolicies_search_places", {
      query: "Healdsburg zzyzxqq winery",
      response_format: "json",
    });
    const s = some.structuredContent;
    assert.equal(s.outcome, "partial");
    assert.deepEqual(s.matched_terms, ["healdsburg"]);
    assert.match(s.message, /"healdsburg"/);
    assert.ok(s.total > 0);
    // nothing at all: still an answer with next steps
    const none = await call(client, "dogpolicies_search_places", {
      query: "dragons beach zzyzxqq",
      response_format: "json",
    });
    assert.equal(none.structuredContent.outcome, "no_match");
    assert.ok(none.structuredContent.next.length);
    // an explicit type beats a kind word in the query
    const typed = await call(client, "dogpolicies_search_places", {
      query: "hotels in Carmel",
      type: "beach",
      response_format: "json",
    });
    assert.ok(typed.structuredContent.places.every((p) => p.type === "beach"));
    // a question about one place is never narrowed to the places that say yes
    const q = await call(client, "dogpolicies_search_places", {
      query: "Can I bring my dog to Carmel Beach",
      response_format: "json",
    });
    assert.equal(q.structuredContent.query_read?.dogs_allowed, undefined);
  }));
