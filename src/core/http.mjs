// Streamable HTTP on a local port, with the same server factory stdio uses.
// The SDK's handler speaks fetch-style Request/Response; this bridges
// node:http to it and validates Host and Origin so a web page cannot reach
// a local server through DNS rebinding.

import { createServer as createHttpServer } from "node:http";
import { Readable } from "node:stream";
import { createMcpHandler } from "@modelcontextprotocol/server";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * @param {() => import("@modelcontextprotocol/server").McpServer} factory
 * @param {object} [options]
 * @param {string} [options.path] endpoint path, default "/mcp"
 * @param {string[]} [options.allowedHosts] Host header values allowed besides localhost ones
 * @param {object} [options.log]
 */
export function createHttpHandler(
  factory,
  { path = "/mcp", allowedHosts = [], log } = {},
) {
  const handler = createMcpHandler(factory, {
    onerror: (error) => log?.warn(`http: ${error.message}`),
  });
  const okHost = (host) => {
    if (!host) return false;
    const name = host.replace(/:\d+$/, "").toLowerCase();
    return LOCAL_HOSTS.includes(name) || allowedHosts.includes(name);
  };
  const okOrigin = (origin) => {
    if (!origin) return true;
    try {
      return okHost(new URL(origin).host);
    } catch {
      return false;
    }
  };

  /** Answers one fetch-style Request. */
  async function fetchHandler(request) {
    const url = new URL(request.url);
    if (url.pathname.replace(/\/$/, "") !== path.replace(/\/$/, ""))
      return new Response("Not found", { status: 404 });
    if (!okHost(request.headers.get("host")))
      return new Response("Forbidden host", { status: 403 });
    if (!okOrigin(request.headers.get("origin")))
      return new Response("Forbidden origin", { status: 403 });
    return handler.fetch(request);
  }
  return { fetch: fetchHandler, path };
}

/** Converts a node IncomingMessage to a fetch Request. */
function toRequest(req, { host }) {
  const url = new URL(req.url, `http://${req.headers.host ?? host}`);
  const method = req.method ?? "GET";
  const body = ["GET", "HEAD"].includes(method)
    ? undefined
    : Readable.toWeb(req);
  return new Request(url, {
    method,
    headers: req.headers,
    body,
    ...(body ? { duplex: "half" } : {}),
  });
}

/** Writes a fetch Response to a node ServerResponse, streaming SSE bodies. */
async function sendResponse(res, response) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) res.setHeader(k, v);
  if (!response.body) return res.end();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

/**
 * Starts an HTTP server on a port. Resolves to { url, close }.
 * @param {ReturnType<typeof createHttpHandler>} handler
 * @param {{ port?: number, host?: string, log?: object }} [options]
 */
export function listen(handler, { port = 3737, host = "127.0.0.1", log } = {}) {
  const server = createHttpServer(async (req, res) => {
    try {
      const response = await handler.fetch(
        toRequest(req, { host: `${host}:${port}` }),
      );
      await sendResponse(res, response);
    } catch (error) {
      log?.error(`request failed: ${error.message}`);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        url: `http://${host}:${actual}${handler.path}`,
        port: actual,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
