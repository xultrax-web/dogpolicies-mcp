// Performance budgets. Generous enough for a slow CI runner, tight enough to
// catch a regression that makes every call scan the snapshot twice.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../src/dogpolicies/server.mjs";
import { call, sharedRuntime, text, withClient } from "./helpers.mjs";

// Shared CI runners (GitHub's macOS ones above all) are noisy neighbors: the
// time budgets double there; on a developer machine they hold as written.
const SLACK = process.env.CI ? 2 : 1;
const BUDGET = {
  loadMs: 2500 * SLACK, // gunzip + parse + index the bundled snapshot
  searchP95Ms: 60 * SLACK, // a text search over every place
  detailP95Ms: 10 * SLACK, // a lookup by id
  hotelsP95Ms: 60 * SLACK, // a county of hotels evaluated against a dog
  memoryMb: 350, // heap after load
  textChars: 25_000, // the budget every tool honors
};

const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

test(`load: the bundled snapshot loads and indexes under ${BUDGET.loadMs} ms`, () => {
  const t = performance.now();
  const ctx = createRuntime({
    env: {},
    overrides: { offline: true, logLevel: "silent" },
  });
  const ms = performance.now() - t;
  assert.ok(ctx.graph.places.length > 1000);
  assert.ok(ms < BUDGET.loadMs, `load took ${ms.toFixed(0)} ms`);
  const heap = process.memoryUsage().heapUsed / 1e6;
  assert.ok(heap < BUDGET.memoryMb, `heap ${heap.toFixed(0)} MB`);
});

test("call latency budgets (p95 over repeated uncached calls)", () =>
  withClient(async (client) => {
    const time = async (name, argsFor, n) => {
      const xs = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        const r = await call(client, name, argsFor(i));
        xs.push(performance.now() - t);
        assert.ok(!r.isError);
      }
      return p95(xs);
    };
    const words = [
      "beach",
      "state park",
      "motel",
      "lake",
      "canyon",
      "creek",
      "inn",
      "trail",
    ];
    const search = await time(
      "dogpolicies_search_places",
      (i) => ({ query: words[i % words.length], offset: i % 7 }),
      60,
    );
    assert.ok(
      search < BUDGET.searchP95Ms,
      `search p95 ${search.toFixed(1)} ms`,
    );
    const ids = sharedRuntime()
      .graph.places.slice(0, 60)
      .map((p) => p.id);
    const detail = await time(
      "dogpolicies_get_place",
      (i) => ({ id: ids[i] }),
      60,
    );
    assert.ok(
      detail < BUDGET.detailP95Ms,
      `detail p95 ${detail.toFixed(1)} ms`,
    );
    const counties = [
      "Monterey",
      "San Diego",
      "Los Angeles",
      "Clark",
      "Washoe",
      "Sonoma",
    ];
    const hotels = await time(
      "dogpolicies_find_hotels",
      (i) => ({
        county: counties[i % counties.length],
        dog_weight_lb: 40 + i,
        nights: 1 + (i % 3),
      }),
      48,
    );
    assert.ok(
      hotels < BUDGET.hotelsP95Ms,
      `hotels p95 ${hotels.toFixed(1)} ms`,
    );
  }));

test("every list tool keeps its text under the character budget at the largest page", () =>
  withClient(async (client) => {
    const big = [
      ["dogpolicies_search_places", { limit: 50 }],
      ["dogpolicies_search_places", { type: "campground", limit: 50 }],
      ["dogpolicies_find_hotels", { limit: 50, dogs: 2, nights: 3 }],
      ["dogpolicies_browse_answers", {}],
      [
        "dogpolicies_browse_answers",
        { slug: "california-state-parks-that-allow-dogs", limit: 50 },
      ],
      ["dogpolicies_route_stops", { route: "us-101", limit: 50 }],
      ["dogpolicies_changes_since", { since: "2000-01-01", limit: 50 }],
    ];
    for (const [name, args] of big) {
      const r = await call(client, name, args);
      assert.ok(!r.isError, name);
      assert.ok(
        text(r).length <= BUDGET.textChars,
        `${name} ${text(r).length} chars`,
      );
    }
  }));
