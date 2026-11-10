// R-34: change feeds (Atom 1.0 and JSON Feed 1.1) for a place, a town or area,
// and a highway's stops, formatted from the changes_near answer; and the
// dogpolicies_subscribe_changes tool that hands out their links. Nothing here
// imports from worker/ (the public mirror is the package alone).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  call,
  sharedRuntime,
  testRuntime,
  text,
  withClient,
} from "./helpers.mjs";
import {
  FEED_CACHE_SECONDS,
  createFeeds,
  feedEntries,
  feedSlug,
  feedUrls,
  parseFeedPath,
  townSlug,
} from "../src/dogpolicies/feeds.mjs";
import { resolveTown } from "../src/dogpolicies/tools/common.mjs";
import { resolveRoute } from "../src/dogpolicies/tools/change-scope.mjs";

const q = (s = "") => new URLSearchParams(s);
const feeds = createFeeds(sharedRuntime());
const get = (path, query) => feeds.run(path, q(query));
const json = async (path, query) => JSON.parse((await get(path, query)).body);

/**
 * A small XML well-formedness check: one root, every tag closed in order,
 * attributes quoted, only the five predefined entities or character references.
 */
function assertWellFormed(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n/);
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack = [];
  let roots = 0;
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  let m;
  while ((m = tag.exec(body))) {
    const between = body.slice(last, m.index);
    assert.ok(!/[<>]/.test(between), `stray < or > before ${m[0]}`);
    for (const ent of between.match(/&[^;\s]*;?/g) ?? [])
      assert.match(
        ent,
        /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);$/,
        `entity ${ent}`,
      );
    last = tag.lastIndex;
    const [, close, name, , self] = m;
    if (close) assert.equal(stack.pop(), name, `closing ${name}`);
    else if (!self) {
      if (!stack.length) roots++;
      stack.push(name);
    } else if (!stack.length) roots++;
  }
  assert.equal(body.slice(last).trim(), "", "nothing after the root");
  assert.equal(stack.length, 0, "every element closed");
  assert.equal(roots, 1, "one root element");
}

const atomEntries = (xml) =>
  [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => m[0]);
const field = (xml, name) =>
  xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1];

test("feed paths: kinds, formats, options and the slugs the town index reads back", () => {
  assert.deepEqual(parseFeedPath("/feeds/changes/place/carmel-beach.atom"), {
    kind: "place",
    id: "carmel-beach",
    format: "atom",
    args: { place_id: "carmel-beach" },
  });
  const near = parseFeedPath(
    "/feeds/changes/near/lake-tahoe.json",
    q("radius=25"),
  );
  assert.equal(near.format, "json");
  assert.deepEqual(near.args, { place: "lake tahoe", radius_miles: "25" });
  const route = parseFeedPath(
    "/feeds/changes/route/i-5.atom",
    q("from=170&to=222"),
  );
  assert.deepEqual(route.args, {
    route: "i-5",
    from_mile: "170",
    to_mile: "222",
  });
  assert.equal(parseFeedPath("/feeds/changes/town/x.atom").kind, null);
  assert.equal(parseFeedPath("/api/v1/changes.json"), null);
  assert.equal(feedSlug("Washoe County, NV"), "washoe-county-nv");
  assert.equal(feedSlug("Carmel-by-the-Sea"), "carmel-by-the-sea");
  const urls = feedUrls("https://dogpolicies.com/", {
    kind: "route",
    id: "i-5",
    from: 170,
    to: 222,
  });
  assert.equal(
    urls.atom,
    "https://dogpolicies.com/feeds/changes/route/i-5.atom?from=170&to=222",
  );
  assert.equal(
    urls.json,
    "https://dogpolicies.com/feeds/changes/route/i-5.json?from=170&to=222",
  );
  assert.equal(
    feedUrls("https://dogpolicies.com", {
      kind: "near",
      id: "lake-tahoe",
      radius: 15,
    }).atom,
    "https://dogpolicies.com/feeds/changes/near/lake-tahoe.atom",
  );
  // every slug the subscribe tool hands out reads back as the same town
  const g = sharedRuntime().graph;
  for (const name of [
    "Lake Tahoe",
    "Monterey",
    "Carmel-by-the-Sea",
    "Washoe County, NV",
    "Van Nuys",
    "Central Valley",
    "East Bay",
  ]) {
    const town = resolveTown(g, name);
    assert.ok(town, name);
    const back = resolveTown(g, townSlug(town).replace(/-/g, " "));
    assert.equal(back?.name, town.name, `${name} -> ${townSlug(town)}`);
    assert.equal(back?.kind, town.kind, `${name} kind`);
  }
  assert.equal(resolveRoute(g, "I-5"), "i-5");
  assert.equal(resolveRoute(g, "Interstate 5"), "i-5");
  assert.equal(resolveRoute(g, "hwy 101"), "us-101");
  assert.equal(resolveRoute(g, "Highway 1"), "highway-1");
  assert.equal(resolveRoute(g, "I-80 Nevada"), "i-80-nevada");
  assert.equal(resolveRoute(g, "i-99"), null);
});

test("Atom feed for a place: well-formed, self link, updated from the newest entry, entries link the record", async () => {
  const r = await get("/feeds/changes/place/carmel-beach.atom");
  assert.equal(r.status, 200);
  assert.equal(r.contentType, "application/atom+xml; charset=utf-8");
  assert.equal(r.cache, FEED_CACHE_SECONDS);
  assert.ok(r.cache >= 600 && r.cache <= 1800, "about 15 minutes");
  assertWellFormed(r.body);
  assert.match(r.body, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(
    r.body,
    /<link rel="self" type="application\/atom\+xml" href="https:\/\/dogpolicies\.com\/feeds\/changes\/place\/carmel-beach\.atom"\/>/,
  );
  assert.match(
    r.body,
    /<link rel="alternate" type="text\/html" href="https:\/\/dogpolicies\.com\/places\/carmel-beach\/"\/>/,
  );
  assert.match(r.body, /<author><name>DogPolicies<\/name>/);
  const entries = atomEntries(r.body);
  assert.ok(entries.length >= 1, "Carmel Beach has verification events");
  const dates = entries.map((e) => field(e, "updated"));
  assert.deepEqual([...dates].sort().reverse(), dates, "newest first");
  assert.equal(
    field(r.body.replace(/<entry>[\s\S]*/, ""), "updated"),
    dates[0],
    "feed updated = newest entry",
  );
  for (const e of entries) {
    assert.match(field(e, "id"), /^tag:dogpolicies\.com,2026:/);
    assert.match(
      e,
      /<link rel="alternate" type="text\/html" href="https:\/\/dogpolicies\.com\/places\/carmel-beach\/"\/>/,
    );
    assert.match(field(e, "title"), /^Carmel Beach: /);
    assert.ok(field(e, "summary")?.length > 10);
  }
});

test("JSON Feed 1.1: the required fields, item ids, dates and links", async () => {
  for (const [path, query] of [
    ["/feeds/changes/place/carmel-beach.json"],
    ["/feeds/changes/near/lake-tahoe.json"],
    ["/feeds/changes/near/monterey-ca.json", "radius=25"],
    ["/feeds/changes/route/i-5.json", "from=170&to=222"],
  ]) {
    const r = await get(path, query);
    assert.equal(r.contentType, "application/feed+json; charset=utf-8", path);
    const f = JSON.parse(r.body);
    assert.equal(f.version, "https://jsonfeed.org/version/1.1");
    assert.equal(typeof f.title, "string");
    assert.ok(f.title.length > 0);
    assert.ok(Array.isArray(f.items), path);
    assert.match(f.feed_url, /^https:\/\/dogpolicies\.com\/feeds\/changes\//);
    assert.match(f.home_page_url, /^https:\/\/dogpolicies\.com\//);
    assert.equal(
      f._dogpolicies.atom_url.replace(/\.atom/, ".json"),
      f.feed_url,
    );
    const ids = new Set();
    for (const it of f.items) {
      assert.equal(typeof it.id, "string");
      assert.ok(!ids.has(it.id), `unique id ${it.id}`);
      ids.add(it.id);
      assert.equal(typeof it.content_text, "string", "content_text present");
      assert.match(it.date_published, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
      assert.match(it.url, /^https:\/\/dogpolicies\.com\//);
    }
    assert.ok(f.items.length <= 50);
  }
});

test("entry ids are stable: same on every read and the same event has the same id in every scope", async () => {
  const a = await json("/feeds/changes/place/carmel-beach.json");
  const b = await json("/feeds/changes/place/carmel-beach.json");
  assert.deepEqual(
    a.items.map((i) => i.id),
    b.items.map((i) => i.id),
  );
  // an id never depends on the slug: it carries the record's uid
  const carmel = sharedRuntime().graph.placeById.get("carmel-beach");
  for (const it of a.items) assert.ok(it.id.includes(carmel.uid), it.id);
  // a news event (here the business confirmation in the data) is its own entry, and its id
  // does not depend on the scope that lists it
  const g = sharedRuntime().graph;
  const news = g.events.find(
    (e) => e.by === "business" || e.outcome !== "confirmed",
  );
  assert.ok(news, "the data has a business confirmation");
  const place = await json(`/feeds/changes/place/${news.placeId}.json`);
  const id = place.items.find((i) =>
    i.title.startsWith(`${news.name}: confirmed by`),
  )?.id;
  assert.ok(id, "the event is its own entry");
  const site = "https://dogpolicies.com";
  const inTown = feedEntries(
    { events: [news] },
    { graph: g, site, scopeKey: "/feeds/changes/near/x" },
  );
  const onRoute = feedEntries(
    { events: [news] },
    { graph: g, site, scopeKey: "/feeds/changes/route/i-5" },
  );
  assert.equal(inTown[0].id, id);
  assert.equal(onRoute[0].id, id);
});

test("scope resolution: place id (and a near miss), town name, area, airport code when the data has one, route with miles", async () => {
  const place = await json("/feeds/changes/place/carmel-beach.json");
  assert.equal(place._dogpolicies.scope.kind, "place");
  assert.equal(place._dogpolicies.scope.id, "carmel-beach");
  const miss = await json("/feeds/changes/place/carmel-beech.json");
  assert.equal(
    miss._dogpolicies.scope.id,
    "carmel-beach",
    "a near miss resolves",
  );
  assert.match(miss.title, /closest match to "carmel-beech"/);
  const town = await json("/feeds/changes/near/monterey.json", "radius=25");
  assert.equal(town._dogpolicies.scope.radius_miles, 25);
  assert.match(town._dogpolicies.scope.label, /^Monterey, CA/);
  assert.match(town.feed_url, /near\/monterey\.json\?radius=25$/);
  const area = await json("/feeds/changes/near/lake-tahoe.json", "radius=40");
  assert.equal(area._dogpolicies.scope.label, "Lake Tahoe");
  assert.equal(
    area._dogpolicies.scope.radius_miles,
    undefined,
    "an area is its own boundary",
  );
  // airports join the gazetteer with roadmap R-20; when one resolves, its feed does too
  const g = sharedRuntime().graph;
  const airport = ["SFO", "LAX", "SAN", "SMF", "RNO"].find((code) => {
    const t = resolveTown(g, code);
    return t && /airport/i.test(`${t.name} ${t.kind}`);
  });
  if (airport) {
    const f = await json(`/feeds/changes/near/${airport.toLowerCase()}.json`);
    assert.equal(f._dogpolicies.outcome, undefined, `${airport} resolves`);
  }
  const route = await json("/feeds/changes/route/i-5.json", "from=170&to=222");
  assert.equal(route._dogpolicies.scope.kind, "route");
  assert.equal(route._dogpolicies.scope.from_mile, 170);
  assert.equal(route._dogpolicies.scope.to_mile, 222);
  assert.match(route._dogpolicies.scope.label, /^I-5, miles 170–222/);
  assert.equal(route.home_page_url, "https://dogpolicies.com/road-trips/i-5/");
  const alias = await json("/feeds/changes/route/I-5.json");
  assert.equal(
    alias._dogpolicies.scope.id,
    "i-5",
    "I-5 is read as the route id",
  );
  // the route scope is what route_stops lists: a stretch is a subset of the whole route
  const whole = await json("/feeds/changes/route/i-5.json");
  assert.ok(
    whole._dogpolicies.scope.verification_events >=
      route._dogpolicies.scope.verification_events,
  );
});

test("an unknown scope is a valid feed with one entry, did_you_mean, never an error", async () => {
  for (const [path, query, want] of [
    ["/feeds/changes/near/montereyy-bay-town.atom", "", /did you mean/i],
    ["/feeds/changes/place/no-such-place-anywhere.atom", "", /No place/],
    ["/feeds/changes/route/i-99.atom", "", /I-5/],
    ["/feeds/changes/town/monterey.atom", "", /not one of the change feeds/],
    ["/feeds/changes/near/monterey.atom", "radius=abc", /could not be read/],
  ]) {
    const r = await get(path, query);
    assert.equal(r.status, 200, path);
    assertWellFormed(r.body);
    const entries = atomEntries(r.body);
    assert.equal(entries.length, 1, `${path} has one entry`);
    assert.match(entries[0], want, path);
  }
  const f = await json("/feeds/changes/near/sacremento-ville.json");
  assert.equal(f.items.length, 1);
  assert.equal(f._dogpolicies.outcome, "no_match");
  assert.ok(Array.isArray(f._dogpolicies.did_you_mean));
  const r = await json("/feeds/changes/route/i-99.json");
  assert.ok(r._dogpolicies.did_you_mean.some((d) => d.id === "i-5"));
});

test("privacy: a correction row's reporter text never reaches a feed, only the public ticket fields", async () => {
  const SECRET = "SECRET reporter text: my phone is 555-0100";
  const ctx = testRuntime({
    corrections: async () => ({
      items: [
        {
          ticket: "c-aaaaaaaa",
          place_id: "carmel-beach",
          place_name: "Carmel Beach",
          fact: "leash",
          status: "verified",
          filed_at: "2026-10-20",
          decided_at: "2026-10-30",
          reason: null,
          status_url: "https://dogpolicies.com/corrections/status/c-aaaaaaaa/",
          message: SECRET,
          note: SECRET,
          contact: "someone@example.com",
          source_url: "https://example.com/private",
        },
      ],
      total: 1,
    }),
  });
  const f = createFeeds(ctx);
  for (const ext of ["atom", "json"]) {
    const r = await f.run(`/feeds/changes/place/carmel-beach.${ext}`, q());
    assert.ok(!r.body.includes("SECRET"), `${ext}: no reporter text`);
    assert.ok(!r.body.includes("555-0100"), `${ext}: no reporter text`);
    assert.ok(!r.body.includes("someone@example.com"), `${ext}: no contact`);
    assert.ok(
      !r.body.includes("example.com/private"),
      `${ext}: no reporter source`,
    );
    assert.match(r.body, /c-aaaaaaaa/, `${ext}: the ticket is listed`);
    assert.match(r.body, /corrections\/status\/c-aaaaaaaa/);
  }
  const items = JSON.parse(
    (await f.run("/feeds/changes/place/carmel-beach.json", q())).body,
  ).items;
  const t = items.find((i) => i.id.includes("correction/c-aaaaaaaa/verified"));
  assert.ok(t, "the ticket's own entry, id by ticket and status");
  assert.match(
    t.content_text,
    /A correction to the leash was filed on 2026-10-20\. Verified on 2026-10-30/,
  );
});

test("entries: routine confirmations are one entry per day, news events and rule changes their own", () => {
  const g = sharedRuntime().graph;
  const ev = (name, at, outcome = "confirmed", by = "editor", extra = {}) => ({
    at,
    by,
    outcome,
    name,
    placeId: name.toLowerCase(),
    placeUid: `plc_${name.toLowerCase()}`,
    url: `https://dogpolicies.com/places/${name.toLowerCase()}/`,
    facts: ["leash"],
    ...extra,
  });
  const entries = feedEntries(
    {
      events: [
        ev("A", "2026-11-03", "changed", "editor", {
          from: "on leash",
          to: "off leash",
        }),
        ev("B", "2026-11-02"),
        ev("C", "2026-11-02", "confirmed", "recheck-script"),
        ev("D", "2026-11-01", "confirmed", "business"),
      ],
      rule_changes: [
        {
          date: "2026-11-04",
          brandId: "motel-6",
          name: "Motel 6",
          kind: "changed",
          field: "fee",
          from: "Free",
          to: "$10",
        },
      ],
      corrections: [],
      page_url: "https://dogpolicies.com/road-trips/i-5/",
    },
    {
      graph: g,
      site: "https://dogpolicies.com",
      scopeKey: "/feeds/changes/route/i-5",
    },
  );
  assert.deepEqual(
    entries.map((e) => e.date),
    ["2026-11-04", "2026-11-03", "2026-11-02", "2026-11-01"],
  );
  assert.equal(entries[0].title, "Motel 6: fee changed");
  assert.equal(entries[0].url, "https://dogpolicies.com/brands/motel-6/");
  assert.equal(entries[1].title, "A: rule changed");
  assert.match(entries[1].summary, /From: on leash To: off leash/);
  assert.equal(entries[2].title, "2 records verified on 2026-11-02");
  assert.equal(entries[2].url, "https://dogpolicies.com/road-trips/i-5/");
  assert.equal(entries[3].title, "D: confirmed by the business");
});

test("subscribe_changes: links, 90-day counts and a sentence to hand over; unknown scope is an answer", () =>
  withClient(async (client) => {
    const place = await call(client, "dogpolicies_subscribe_changes", {
      place: "carmel-beach",
      response_format: "json",
    });
    assert.ok(!place.isError);
    const p = place.structuredContent;
    assert.equal(
      p.atom_url,
      "https://dogpolicies.com/feeds/changes/place/carmel-beach.atom",
    );
    assert.equal(
      p.json_url,
      "https://dogpolicies.com/feeds/changes/place/carmel-beach.json",
    );
    assert.equal(p.page_url, "https://dogpolicies.com/places/carmel-beach/");
    assert.equal(p.scope.kind, "place");
    assert.equal(p.last_90_days.since, "2026-08-02");
    assert.equal(typeof p.last_90_days.verification_events, "number");
    assert.equal(
      p.share_text,
      "Add this link to any feed reader to hear when a dog rule changes at Carmel Beach: https://dogpolicies.com/feeds/changes/place/carmel-beach.atom",
    );

    const tahoe = (
      await call(client, "dogpolicies_subscribe_changes", {
        near: "Lake Tahoe",
        response_format: "json",
      })
    ).structuredContent;
    assert.equal(
      tahoe.atom_url,
      "https://dogpolicies.com/feeds/changes/near/lake-tahoe.atom",
    );
    assert.match(
      tahoe.share_text,
      /^Add this link to any feed reader to hear when a dog rule changes in Lake Tahoe: /,
    );

    const typo = (
      await call(client, "dogpolicies_subscribe_changes", {
        near: "Montery",
        radius_miles: 20,
        response_format: "json",
      })
    ).structuredContent;
    assert.equal(
      typo.atom_url,
      "https://dogpolicies.com/feeds/changes/near/monterey-ca.atom?radius=20",
    );
    assert.equal(typo.scope.corrected_from, "Montery");
    assert.doesNotMatch(typo.share_text, /closest match/);

    const road = (
      await call(client, "dogpolicies_subscribe_changes", {
        route: "I-5",
        from_mile: 170,
        to_mile: 222,
        response_format: "json",
      })
    ).structuredContent;
    assert.equal(
      road.atom_url,
      "https://dogpolicies.com/feeds/changes/route/i-5.atom?from=170&to=222",
    );
    assert.equal(road.page_url, "https://dogpolicies.com/road-trips/i-5/");

    // the feed the tool names answers for the same scope with the same counts
    const f = await json("/feeds/changes/route/i-5.json", "from=170&to=222");
    assert.equal(f._dogpolicies.scope.label, road.scope.label);

    const md = text(
      await call(client, "dogpolicies_subscribe_changes", {
        near: "Lake Tahoe",
      }),
    );
    assert.match(md, /^# Follow dog rule changes in Lake Tahoe/);
    assert.match(md, /nothing about the reader is stored/);

    const none = await call(client, "dogpolicies_subscribe_changes", {
      near: "Nowhereville Flats",
      response_format: "json",
    });
    assert.ok(!none.isError, "an unknown name is an answer");
    assert.equal(none.structuredContent.outcome, "no_match");
    assert.equal(none.structuredContent.atom_url, null);
    assert.ok(Array.isArray(none.structuredContent.did_you_mean));

    const empty = await call(client, "dogpolicies_subscribe_changes", {
      response_format: "json",
    });
    assert.equal(empty.structuredContent.outcome, "bad_input");
    const two = await call(client, "dogpolicies_subscribe_changes", {
      place: "carmel-beach",
      route: "i-5",
      response_format: "json",
    });
    assert.equal(two.structuredContent.outcome, "bad_input");
  }));

test("changes_near takes place_id and route scopes, with rule changes for the scope", () =>
  withClient(async (client) => {
    const one = (
      await call(client, "dogpolicies_changes_near", {
        place_id: "carmel-beach",
        since: "2026-01-01",
        response_format: "json",
      })
    ).structuredContent;
    assert.equal(one.scope_kind, "place");
    assert.equal(one.place_id, "carmel-beach");
    assert.ok(one.events.every((e) => e.placeId === "carmel-beach"));
    assert.ok(Array.isArray(one.rule_changes));
    const road = (
      await call(client, "dogpolicies_changes_near", {
        route: "i-5",
        from_mile: 170,
        to_mile: 222,
        since: "2026-01-01",
        response_format: "json",
      })
    ).structuredContent;
    assert.equal(road.scope_kind, "route");
    assert.equal(road.page_url, "https://dogpolicies.com/road-trips/i-5/");
    for (const e of road.events)
      assert.ok(e.mile >= 160 && e.mile <= 232, `${e.name} mile ${e.mile}`);
    const unknown = (
      await call(client, "dogpolicies_changes_near", {
        route: "i-99",
        since: "2026-01-01",
        response_format: "json",
      })
    ).structuredContent;
    assert.equal(unknown.outcome, "no_match");
    const md = text(
      await call(client, "dogpolicies_changes_near", {
        place_id: "carmel-beach",
        since: "2026-01-01",
      }),
    );
    assert.match(
      md,
      /^# \d+ verification events? since 2026-01-01 at Carmel Beach/,
    );
  }));
