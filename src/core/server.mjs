// The tool registry: a list of plain tool definitions becomes an MCP server.
// Each tool gets the same wrapping: strict input validation by the SDK,
// result caching, timing, and an error model that never leaks a stack.
//
// A second server built on this core supplies its own tool list, site
// identity and data; nothing here knows about dogs.

import { McpServer } from "@modelcontextprotocol/server";
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
 * @param {object} options
 * @param {{ name: string, title?: string, version: string }} options.identity
 * @param {string} options.instructions
 * @param {ToolDefinition[]} options.tools
 * @param {() => string} options.dataVersion current data version, for the cache key
 * @param {object} [options.log]
 * @param {(name: string, ctx: object) => any} [options.onToolCall]
 * @param {number} [options.cacheSize]
 */
export function createToolServer({
  identity,
  instructions,
  tools,
  dataVersion = () => "",
  log,
  onToolCall,
  cacheSize = 200,
}) {
  const server = new McpServer(
    { name: identity.name, title: identity.title, version: identity.version },
    {
      instructions,
      // Empty lists, not "method not found": directory scanners and some
      // clients call resources/list and prompts/list on every server.
      capabilities: { resources: {}, prompts: {}, tools: {} },
    },
  );
  const cache = new Lru(cacheSize);
  const stats = { calls: 0, errors: 0, cacheHits: 0 };

  for (const tool of tools) {
    const description = tool.deprecated
      ? `DEPRECATED: ${tool.deprecated}\n\n${tool.description}`
      : tool.description;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (args, ctx) => {
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
          stats.errors++;
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
      },
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
