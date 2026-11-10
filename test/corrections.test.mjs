// R-14: the ticket in the report_correction answer, and the corrections list in
// changes_since and changes_near. The hosted server hands the runtime a loader
// (ctx.corrections); the in-process and stdio server has none and says so.
// Nothing here imports from worker/ (the public mirror is the package alone).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, testRuntime, text, withClient } from "./helpers.mjs";
import { FACT_KINDS } from "../src/dogpolicies/tools/report-correction.mjs";

const ITEMS = [
  {
    ticket: "c-aaaaaaaa",
    place_id: "carmel-beach",
    place_name: "Carmel Beach",
    fact: "leash",
    status: "verified",
    filed_at: "2026-10-20",
    decided_at: "2026-11-02",
    reason: null,
    changed_on: "2026-11-02",
    status_url: "https://dogpolicies.com/corrections/status/c-aaaaaaaa/",
  },
  {
    ticket: "c-bbbbbbbb",
    place_id: "carmel-beach",
    place_name: "Carmel Beach",
    fact: "fee",
    status: "rejected",
    filed_at: "2026-10-25",
    decided_at: "2026-10-30",
    reason: "duplicate",
    changed_on: null,
    status_url: "https://dogpolicies.com/corrections/status/c-bbbbbbbb/",
  },
  {
    ticket: "c-cccccccc",
    place_id: "lake-tahoe-nevada-beach",
    place_name: "Nevada Beach",
    fact: "unspecified",
    status: "filed",
    filed_at: "2026-11-05",
    decided_at: null,
    reason: null,
    changed_on: null,
    status_url: "https://dogpolicies.com/corrections/status/c-cccccccc/",
  },
];

const corrections = async ({ since }) => ({
  items: ITEMS.filter((t) => (t.decided_at ?? t.filed_at) >= since),
  total: ITEMS.length,
});

test("report_correction answers with a ticket and a status_url when the site filed it", async () => {
  const sent = [];
  const ctx = testRuntime({
    reporter: {
      underLimit: () => true,
      send: async (r) => {
        sent.push(r);
        return { ok: true, id: "rep_1", ticket: "c-abcd2345", public: true };
      },
    },
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_report_correction", {
      place_id: "carmel-beach",
      message: "The fee went up to $10.",
      fact: "fee",
    });
    assert.ok(!r.isError);
    const d = r.structuredContent;
    assert.equal(d.status, "filed");
    assert.equal(d.report_id, "rep_1");
    assert.equal(d.ticket, "c-abcd2345");
    assert.equal(
      d.status_url,
      "https://dogpolicies.com/corrections/status/c-abcd2345/",
    );
    assert.match(text(r), /c-abcd2345/);
    assert.equal(sent[0].fact, "fee");
    assert.ok(sent[0].placeName, "the tool passes the record's own name");
  }, ctx);
});

test("report_correction without a public ticket (local inbox, older site) keeps the old answer and nulls the new fields", async () => {
  const ctx = testRuntime({
    reporter: {
      underLimit: () => true,
      send: async () => ({
        ok: true,
        id: "rep_2",
        ticket: "c-abcd2345",
        public: false,
      }),
    },
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_report_correction", {
      place_id: "carmel-beach",
      message: "The fee went up to $10.",
    });
    const d = r.structuredContent;
    assert.equal(d.report_id, "rep_2");
    assert.equal(d.status, "filed");
    assert.equal(d.status_url, null);
    assert.doesNotMatch(text(r), /corrections\/status/);
  }, ctx);
  const old = testRuntime({
    reporter: {
      underLimit: () => true,
      send: async () => ({ ok: true, id: "rep_3" }),
    },
  });
  await withClient(async (client) => {
    const d = (
      await call(client, "dogpolicies_report_correction", {
        place_id: "carmel-beach",
        message: "The fee went up to $10.",
      })
    ).structuredContent;
    assert.equal(d.ticket, null);
    assert.equal(d.status_url, null);
  }, old);
});

test("report_correction refuses a fact kind outside the fixed list", async () => {
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_report_correction", {
      place_id: "carmel-beach",
      message: "The fee went up to $10.",
      fact: "my free text",
    });
    assert.ok(
      r.isError ||
        r.structuredContent?.outcome === "bad_input" ||
        /fact/i.test(text(r)),
    );
  });
  assert.equal(new Set(FACT_KINDS).size, FACT_KINDS.length);
});

test("changes_since lists corrections whose status changed in the window, as a separate array", async () => {
  const ctx = testRuntime({ corrections });
  await withClient(async (client) => {
    const d = (
      await call(client, "dogpolicies_changes_since", { since: "2026-10-29" })
    ).structuredContent;
    assert.ok(Array.isArray(d.events) && Array.isArray(d.rule_changes));
    assert.deepEqual(
      d.corrections.map((t) => t.ticket),
      ["c-cccccccc", "c-aaaaaaaa", "c-bbbbbbbb"],
    );
    assert.equal(d.corrections[0].changed_at, "2026-11-05");
    assert.equal(d.corrections[1].changed_at, "2026-11-02");
    assert.equal(d.corrections_total, 3);
    assert.equal(d.corrections_note, null);
    const later = (
      await call(client, "dogpolicies_changes_since", { since: "2026-11-03" })
    ).structuredContent;
    assert.deepEqual(
      later.corrections.map((t) => t.ticket),
      ["c-cccccccc"],
    );
    const md = text(
      await call(client, "dogpolicies_changes_since", { since: "2026-10-29" }),
    );
    assert.match(md, /Corrections \(3\)/);
    assert.match(md, /c-aaaaaaaa verified/);
  }, ctx);
});

test("changes_near keeps only corrections for places in the area", async () => {
  const ctx = testRuntime({ corrections });
  await withClient(async (client) => {
    const d = (
      await call(client, "dogpolicies_changes_near", {
        place: "Carmel",
        since: "2026-10-01",
        radius_miles: 5,
      })
    ).structuredContent;
    assert.ok(Array.isArray(d.corrections));
    for (const t of d.corrections) assert.equal(t.place_id, "carmel-beach");
    assert.deepEqual(
      d.corrections.map((t) => t.ticket),
      ["c-aaaaaaaa", "c-bbbbbbbb"],
    );
    assert.equal(typeof d.corrections[0].distance_miles, "number");
  }, ctx);
});

test("without a loader (stdio, in-process) corrections is empty and a note says where to look", async () => {
  await withClient(async (client) => {
    const d = (
      await call(client, "dogpolicies_changes_since", { since: "2026-10-29" })
    ).structuredContent;
    assert.deepEqual(d.corrections, []);
    assert.equal(d.corrections_total, 0);
    assert.match(d.corrections_note, /api\/v1\/corrections\.json/);
  });
});

test("a failing loader never fails the change tools", async () => {
  const ctx = testRuntime({
    corrections: async () => {
      throw new Error("db down");
    },
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_changes_since", {
      since: "2026-10-29",
    });
    assert.ok(!r.isError);
    assert.deepEqual(r.structuredContent.corrections, []);
    assert.match(r.structuredContent.corrections_note, /could not be read/);
  }, ctx);
});

test("a loader that never answers costs the change tools at most the deadline, then the 'could not be read' note, never isError", async () => {
  const { CORRECTIONS_READ_MS } = await import("../src/dogpolicies/tools/corrections.mjs");
  const ctx = testRuntime({ corrections: () => new Promise(() => {}) });
  await withClient(async (client) => {
    const started = Date.now();
    const [since, near] = await Promise.all([
      call(client, "dogpolicies_changes_since", { since: "2026-10-01" }),
      call(client, "dogpolicies_changes_near", {
        place: "Carmel",
        since: "2026-10-01",
      }),
    ]);
    const took = Date.now() - started;
    assert.ok(took < CORRECTIONS_READ_MS + 1500, `answered in ${took} ms`);
    for (const r of [since, near]) {
      assert.ok(!r.isError, text(r));
      assert.deepEqual(r.structuredContent.corrections, []);
      assert.equal(r.structuredContent.corrections_total, 0);
      assert.match(r.structuredContent.corrections_note, /could not be read just now/);
    }
  }, ctx);
});
