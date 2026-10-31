// An in-process client over an in-memory transport: what `check`, `demo`
// and the unit tests use to call tools exactly as an AI client would,
// without a child process.

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "./server.mjs";

/** Connects a client to a fresh server over the runtime. Returns { client, close }. */
export async function connectInProcess(
  ctx,
  { clientName = "dogpolicies-inprocess" } = {},
) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createServer(ctx);
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
