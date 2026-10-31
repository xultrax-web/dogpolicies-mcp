// Streamable HTTP end to end on a random local port: the official client
// connects by URL, lists tools and calls one, exactly as a remote client would.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createHttpHandler, listen } from "../src/core/http.mjs";
import { createServer } from "../src/dogrulebook/server.mjs";
import { sharedRuntime } from "./helpers.mjs";

test("Streamable HTTP: list and call over a real socket", async () => {
  const ctx = sharedRuntime();
  const handler = createHttpHandler(() => createServer(ctx), { log: ctx.log });
  const { url, close } = await listen(handler, {
    port: 0,
    host: "127.0.0.1",
    log: ctx.log,
  });
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 9);
    const r = await client.callTool({
      name: "dogrulebook_get_brand_policy",
      arguments: { brand: "motel-6", response_format: "json" },
    });
    assert.ok(!r.isError);
    assert.equal(r.structuredContent.id, "motel-6");
    await client.close();
    const miss = await fetch(url.replace("/mcp", "/nope"));
    assert.equal(miss.status, 404);
  } finally {
    await close();
  }
});
