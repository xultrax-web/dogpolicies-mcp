// The hosted Worker reads its own snapshot with trustSnapshot (a shape check) instead
// of validateSnapshot (zod over every place). They must agree on the real snapshot and
// on what each rejects at the top level, and the runtime built either way must answer alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { BUNDLED_SNAPSHOT } from "../src/dogpolicies/server.mjs";
import {
  hydrate,
  trustSnapshot,
  validateSnapshot,
} from "../src/dogpolicies/graph.mjs";
import { testRuntime, withClient, call } from "./helpers.mjs";

const raw = () => JSON.parse(gunzipSync(readFileSync(BUNDLED_SNAPSHOT)));

test("trustSnapshot accepts what validateSnapshot accepts, with the same defaults", () => {
  const full = validateSnapshot(raw());
  const trusted = trustSnapshot(raw());
  for (const k of [
    "schema",
    "as_of",
    "areas",
    "towns",
    "regions",
    "brands",
    "answers",
    "changes",
  ])
    assert.deepEqual(trusted[k], full[k], k);
  assert.equal(trusted.places.length, full.places.length);
  // a snapshot without the two defaulted arrays gets them
  const bare = raw();
  delete bare.areas;
  delete bare.towns;
  const t = trustSnapshot(bare);
  assert.deepEqual([t.areas, t.towns], [[], []]);
});

test("trustSnapshot refuses a file that is not the snapshot shape", () => {
  for (const bad of [
    null,
    {},
    { ...raw(), schema: -1 },
    { ...raw(), as_of: "soon" },
    { ...raw(), places: [] },
    { ...raw(), routes: null },
    { ...raw(), brands: undefined },
  ])
    assert.throws(() => trustSnapshot(bad), /snapshot rejected/);
});

test("the verification log is built once, on first use", () => {
  const g = hydrate(trustSnapshot(raw()));
  const first = g.events;
  assert.ok(first.length > 0);
  assert.equal(g.events, first, "the same array on every read");
  assert.ok(
    first.every((e, i) => i === 0 || first[i - 1].at >= e.at),
    "newest first",
  );
});

test("a runtime built with trustSnapshot answers the way a validated one does", async () => {
  const trusted = testRuntime({ snapshot: raw(), trustSnapshot: true });
  const checked = testRuntime({ snapshot: raw() });
  const ask = (rt, name, args) =>
    withClient(
      async (client) =>
        (await call(client, name, { ...args, response_format: "json" }))
          .structuredContent,
      rt,
    );
  for (const [name, args] of [
    ["dogpolicies_near", { place: "Monterey" }],
    ["dogpolicies_near", { place: "Van Nuys" }],
    ["dogpolicies_near", { place: "Montrey" }],
    ["dogpolicies_near", { place: "Washoe County, NV" }],
    ["dogpolicies_changes_since", { since: "2020-01-01" }],
  ])
    assert.deepEqual(
      await ask(trusted, name, args),
      await ask(checked, name, args),
      `${name} ${JSON.stringify(args)}`,
    );
});
