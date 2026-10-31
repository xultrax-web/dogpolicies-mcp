// The correction reporter with a fake network: what is sent, rate limits,
// and how every failure turns into a result the user can act on.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createReporter } from "../src/dogrulebook/report.mjs";
import { call, testRuntime, text, withClient } from "./helpers.mjs";

test("reporter sends one JSON POST with only the report fields and reads the id back", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(
      JSON.stringify({
        id: "rep_abc",
        placeId: "carmel-beach",
        status: "filed",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const r = createReporter({
    endpoint: "https://dogrulebook.com/corrections/submit",
    fetch,
  });
  assert.ok(r.underLimit());
  const out = await r.send({
    placeId: "carmel-beach",
    message: "Fee went up.",
    sourceUrl: "https://example.gov/rules",
  });
  assert.deepEqual(out, { ok: true, id: "rep_abc" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    kind: "correction",
    placeId: "carmel-beach",
    message: "Fee went up.",
    sourceUrl: "https://example.gov/rules",
    contact: "",
    via: "mcp-npm",
  });
  assert.equal(seen[0].init.headers.Accept, "application/json");
  assert.equal(seen[0].init.redirect, "error");
});

test("reporter: client-side rate limit, then reset after a minute", () => {
  let now = 1_000_000;
  const r = createReporter({
    endpoint: "https://x.test",
    perMinute: 2,
    now: () => now,
  });
  assert.ok(r.underLimit());
  assert.ok(r.underLimit());
  assert.ok(!r.underLimit());
  now += 61_000;
  assert.ok(r.underLimit());
});

test("reporter: HTTP 429, 500, non-JSON, no id, timeout and network errors all return ok:false with a reason", async () => {
  const cases = [
    [async () => new Response("", { status: 429 }), /rate limited/],
    [async () => new Response("", { status: 500 }), /HTTP 500/],
    [
      async () =>
        new Response("<html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      /unexpected/,
    ],
    [
      async () =>
        new Response(JSON.stringify({ error: "say more" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      /say more/,
    ],
    [
      async () => {
        const e = new Error("t");
        e.name = "TimeoutError";
        throw e;
      },
      /timed out/,
    ],
    [
      async () => {
        throw new Error("ECONNREFUSED");
      },
      /network error/,
    ],
  ];
  for (const [fetch, re] of cases) {
    const out = await createReporter({
      endpoint: "https://x.test",
      fetch,
    }).send({ placeId: "a", message: "b" });
    assert.equal(out.ok, false);
    assert.match(out.reason, re);
  }
});

test("report_correction tool online: filed, then rate_limited, then unavailable with the form URL", async () => {
  let mode = "ok";
  const fetch = async () =>
    mode === "ok"
      ? new Response(JSON.stringify({ id: "rep_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response("", { status: 503 });
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const ctx = testRuntime({
    offline: false,
    fetch,
    cacheDir: mkdtempSync(join(tmpdir(), "drb-report-")),
  });
  await withClient(async (client) => {
    const ok = await call(client, "dogrulebook_report_correction", {
      place_id: "carmel-beach",
      message: "The leash rule changed.",
    });
    assert.equal(ok.structuredContent.status, "filed");
    assert.equal(ok.structuredContent.report_id, "rep_1");
    assert.match(text(ok), /Filed correction rep_1/);
    mode = "down";
    const down = await call(client, "dogrulebook_report_correction", {
      place_id: "carmel-beach",
      message: "The leash rule changed again.",
    });
    assert.equal(down.structuredContent.error.code, "unavailable");
    assert.match(text(down), /#correction/);
    for (let i = 0; i < 3; i++)
      await call(client, "dogrulebook_report_correction", {
        place_id: "carmel-beach",
        message: "Repeat report number " + i,
      });
    const limited = await call(client, "dogrulebook_report_correction", {
      place_id: "carmel-beach",
      message: "One more report.",
    });
    assert.equal(limited.structuredContent.error.code, "rate_limited");
  }, ctx);
});
