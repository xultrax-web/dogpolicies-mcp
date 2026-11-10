// The I-5 conditions tool when the host's loader fell back to the last document it
// held (`fallback` on the document, set by the hosted Worker's cache): a stale
// reading with its age, never an error; and a loader that throws is unavailable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testRuntime, withClient, call, text } from "./helpers.mjs";

const doc = (fetchedAt, extra = {}) => ({
  fetchedAt,
  notice: "Conditions, not rules.",
  closures: [],
  weather: [],
  signs: [],
  chainControls: [],
  source: { publisher: "Caltrans" },
  ...extra,
});
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

test("i5_conditions: a fallback document is a stale reading that names its age, not an error", async () => {
  const rt = testRuntime({
    conditions: async () =>
      doc(minutesAgo(23), {
        fallback: { reason: "no answer in 4000 ms", held_ms: 600_000 },
      }),
  });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      response_format: "json",
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.outcome, undefined);
    assert.equal(r.structuredContent.stale, true);
    assert.match(r.structuredContent.notice, /failed just now/);
    assert.match(r.structuredContent.notice, /2[23] minutes old/);
    const md = await call(client, "dogpolicies_i5_conditions", {});
    assert.match(text(md), /STALE READING/);
  }, rt);
});

test("i5_conditions: a document from a working read, young or two hours old, keeps its earlier wording", async () => {
  const rt = testRuntime({ conditions: async () => doc(minutesAgo(10)) });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      response_format: "json",
    });
    assert.equal(r.structuredContent.stale, undefined);
    assert.doesNotMatch(r.structuredContent.notice, /failed just now/);
  }, rt);
  const old = testRuntime({ conditions: async () => doc(minutesAgo(5 * 60)) });
  await withClient(async (client) => {
    const r = await call(client, "dogpolicies_i5_conditions", {
      response_format: "json",
    });
    assert.equal(r.structuredContent.stale, true);
    assert.match(r.structuredContent.notice, /5 hours old/);
  }, old);
});

test("i5_conditions: a loader that throws, or holds nothing, answers unavailable and never isError", async () => {
  for (const conditions of [
    async () => {
      throw new Error("Durable Object reset");
    },
    async () => null,
  ]) {
    await withClient(async (client) => {
      const r = await call(client, "dogpolicies_i5_conditions", {
        response_format: "json",
      });
      assert.ok(!r.isError);
      assert.equal(r.structuredContent.outcome, "unavailable");
      assert.equal(r.structuredContent.fetched_at, null);
      assert.match(r.structuredContent.notice, /./);
    }, testRuntime({ conditions }));
  }
});
