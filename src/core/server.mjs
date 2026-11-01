// The registry: plain tool, resource and prompt definitions become an MCP
// server. Each tool gets the same wrapping: strict input validation by the
// SDK, result caching, timing, and an error model that never leaks a stack.
// Resources and prompts are registered with cache hints and completions.
//
// A second server built on this core supplies its own definitions, site
// identity and data; nothing here knows about dogs.

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { toErrorResult } from "./errors.mjs";
import { Lru } from "./lru.mjs";
import { stableStringify } from "./result.mjs";

/**
 * @typedef {object} ToolDefinition
 * @property {string} name snake_case, prefixed with the server name
 * @property {string} title
 * @property {string} description written for a model choosing a tool
 * @property {object} inputSchema zod object schema
 * @property {object} [outputSchema]
 * @property {object} annotations readOnlyHint, destructiveHint, idempotentHint, openWorldHint
 * @property {(args: object, ctx: object) => Promise<object>} handler
 * @property {boolean} [cache] memoize results by arguments (read-only tools)
 * @property {string} [since] package version the tool first shipped in
 * @property {string} [deprecated] message naming the replacement, when retiring
 */

/**
 * @typedef {object} ResourceDefinition
 * @property {string} name
 * @property {string} [uri] a fixed URI, or
 * @property {{ uriTemplate: string, list?: Function, complete?: object }} [template]
 * @property {string} title
 * @property {string} description
 * @property {string} mimeType
 * @property {object} [cacheHint]
 * @property {(vars: object, uri: URL) => Promise<{ text: string } | null> | { text: string } | null} read
 */

/**
 * @typedef {object} PromptDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {object} [argsSchema] zod shape, values may be `completable`
 * @property {(args: object) => Array<{ role: string, content: object }>} build
 */

/**
 * @param {object} options
 * @param {{ name: string, title?: string, version: string }} options.identity
 * @param {string} options.instructions
 * @param {ToolDefinition[]} options.tools
 * @param {ResourceDefinition[]} [options.resources]
 * @param {PromptDefinition[]} [options.prompts]
 * @param {() => string} options.dataVersion current data version, for the cache key
 * @param {object} [options.log]
 * @param {(name: string, ctx: object) => any} [options.onToolCall]
 * @param {number} [options.cacheSize]
 * @param {object} [options.stats] a counter object shared across servers
 * @param {string} [options.aliasPrefix] also register every tool under this prefix (older clients)
 */
export function createToolServer({
  identity,
  instructions,
  tools,
  resources = [],
  prompts = [],
  dataVersion = () => "",
  log,
  onToolCall,
  cacheSize = 200,
  stats = { calls: 0, errors: 0, cacheHits: 0 },
  aliasPrefix = null,
}) {
  const server = new McpServer(
    { name: identity.name, title: identity.title, version: identity.version },
    {
      instructions,
      // Empty lists, not "method not found": directory scanners and some
      // clients call resources/list and prompts/list on every server.
      capabilities: { resources: {}, prompts: {}, tools: {} },
      // Lists and resource reads are pure over the data version: let clients
      // cache them (2026-07-28 cache hints).
      cacheHints: {
        "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "resources/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "resources/templates/list": { ttlMs: 3_600_000, cacheScope: "public" },
      },
    },
  );
  const cache = new Lru(cacheSize);

  // Tools in definition order: deterministic tools/list helps client caches.
  for (const tool of tools) {
    const description = tool.deprecated
      ? `DEPRECATED: ${tool.deprecated}\n\n${tool.description}`
      : tool.description;
    const handler = async (args, ctx) => {
      stats.calls++;
      const started = performance.now();
      const counted = onToolCall?.(tool.name, ctx);
      let output;
      try {
        const key = tool.cache
          ? `${dataVersion()}|${tool.name}|${stableStringify(args)}`
          : null;
        output = key ? cache.get(key) : undefined;
        if (output) stats.cacheHits++;
        else {
          output = await tool.handler(args, ctx);
          if (key && !output.isError) cache.set(key, output);
        }
      } catch (error) {
        output = toErrorResult(error, { log });
      }
      if (output.isError) stats.errors++;
      try {
        await counted;
      } catch {
        // counting never fails a call
      }
      log?.debug(
        `${tool.name} ${output.isError ? "error" : "ok"} in ${(performance.now() - started).toFixed(1)} ms`,
      );
      return output;
    };
    const config = {
      title: tool.title,
      description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    };
    server.registerTool(tool.name, config, handler);
    // The old names, for clients configured before a rename.
    const [, suffix] = tool.name.match(/^[a-z0-9]+_(.*)$/) ?? [];
    if (aliasPrefix && suffix)
      server.registerTool(
        `${aliasPrefix}${suffix}`,
        {
          ...config,
          title: `${tool.title} (alias)`,
          description: `Alias of ${tool.name}, kept for older clients. ${description}`,
        },
        handler,
      );
  }

  for (const r of resources) {
    const meta = {
      title: r.title,
      description: r.description,
      mimeType: r.mimeType,
      cacheHint: r.cacheHint,
    };
    const contents = async (uri, vars) => {
      const got = await r.read(vars ?? {}, uri);
      if (!got) throw new Error(`Resource not found: ${uri.href}`);
      return {
        contents: [{ uri: uri.href, mimeType: r.mimeType, text: got.text }],
      };
    };
    if (r.template) {
      const template = new ResourceTemplate(r.template.uriTemplate, {
        list: r.template.list,
        complete: r.template.complete,
      });
      server.registerResource(r.name, template, meta, (uri, vars) =>
        contents(uri, vars),
      );
    } else {
      server.registerResource(r.name, r.uri, meta, (uri) => contents(uri, {}));
    }
  }

  for (const p of prompts) {
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description, argsSchema: p.argsSchema },
      async (args) => ({
        description: p.description,
        messages: p.build(args ?? {}),
      }),
    );
  }

  return Object.assign(server, { toolStats: stats, toolCache: cache });
}

/** Tool annotations for a pure read. */
export const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Annotations for a write that files something and cannot be undone by the server. */
export const WRITE_ONCE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
});
