// An in-process client over an in-memory transport: what `check`, `demo`
// and the unit tests use to call tools exactly as an AI client would,
// without a child process. It speaks the same JSON-RPC as any MCP client
// but needs no client SDK, so the package ships only the server SDK (the
// client SDK brings process-spawning code a server never needs).

import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/server";
import { createServer } from "./server.mjs";

/** The subset of an MCP client this package needs, over one transport. */
class LocalClient {
  #transport;
  #nextId = 1;
  #pending = new Map();

  constructor(transport, info) {
    this.#transport = transport;
    this.info = info;
  }

  async connect() {
    this.#transport.onmessage = (msg) => this.#receive(msg);
    this.#transport.onclose = () => this.#failAll(new Error("connection closed"));
    await this.#transport.start();
    this.initialize = await this.#request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.info,
    });
    await this.#transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  #receive(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      const waiting = this.#pending.get(msg.id);
      if (!waiting) return;
      this.#pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
        err.code = msg.error.code;
        err.data = msg.error.data;
        waiting.reject(err);
      } else waiting.resolve(msg.result);
    } else if (msg.id !== undefined && msg.method) {
      // A request from the server (ping, roots, sampling): answer ping, decline the rest.
      const reply =
        msg.method === "ping"
          ? { jsonrpc: "2.0", id: msg.id, result: {} }
          : { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
      this.#transport.send(reply).catch(() => {});
    }
    // Notifications (logging, list changes) are not needed in-process.
  }

  #failAll(err) {
    for (const { reject } of this.#pending.values()) reject(err);
    this.#pending.clear();
  }

  #request(method, params) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#transport
        .send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
        .catch((e) => {
          this.#pending.delete(id);
          reject(e);
        });
    });
  }

  listTools(params) {
    return this.#request("tools/list", params);
  }
  callTool(params) {
    return this.#request("tools/call", params);
  }
  listResources(params) {
    return this.#request("resources/list", params);
  }
  listResourceTemplates(params) {
    return this.#request("resources/templates/list", params);
  }
  readResource(params) {
    return this.#request("resources/read", params);
  }
  listPrompts(params) {
    return this.#request("prompts/list", params);
  }
  getPrompt(params) {
    return this.#request("prompts/get", params);
  }
  complete(params) {
    return this.#request("completion/complete", params);
  }

  async close() {
    await this.#transport.close();
  }
}

/** Connects a client to a fresh server over the runtime. Returns { client, close }. */
export async function connectInProcess(
  ctx,
  { clientName = "dogpolicies-inprocess" } = {},
) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createServer(ctx);
  await server.connect(serverTransport);
  const client = new LocalClient(clientTransport, { name: clientName, version: "1.0.0" });
  await client.connect();
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
