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
 * @property {(issues: object[], args: object, tool: ToolDefinition) => object} [invalidAnswer]
 *   when present, the SDK does not refuse arguments that fail the schema: the schema runs
 *   inside the handler, and a failure becomes this answer (decision 111) instead of a
 *   protocol error. The advertised JSON Schema is the schema's own, unchanged.
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
 * @param {{ name: string, title?: string, version: string, websiteUrl?: string, icons?: { src: string, mimeType?: string, sizes?: string[] }[] }} options.identity
 * @param {string} options.instructions
 * @param {ToolDefinition[]} options.tools
 * @param {ResourceDefinition[]} [options.resources]
 * @param {PromptDefinition[]} [options.prompts]
 * @param {() => string} options.dataVersion current data version, for the cache key
 * @param {object} [options.log]
 * @param {(name: string, ctx: object) => any} [options.onToolCall]
 * @param {(name: string, ctx: object, done: { args: object, output: object, ms: number }) => any} [options.onToolResult] after the call, with its result and time
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
  onToolResult,
  cacheSize = 200,
  stats = { calls: 0, errors: 0, cacheHits: 0 },
  aliasPrefix = null,
}) {
  const server = new McpServer(
    {
      name: identity.name,
      title: identity.title,
      version: identity.version,
      ...(identity.icons ? { icons: identity.icons } : {}),
      ...(identity.websiteUrl ? { websiteUrl: identity.websiteUrl } : {}),
    },
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
    // A tool with invalidAnswer runs its own schema inside wrapToolHandler (decision 111):
    // the SDK gets the same JSON Schema with a pass-through validator.
    const lenient = Boolean(tool.invalidAnswer);
    const handler = wrapToolHandler(tool, {
      stats,
      cache,
      dataVersion,
      log,
      onToolCall,
      onToolResult,
    });
    const config = {
      title: tool.title,
      description,
      inputSchema: lenient ? lenientInput(tool.inputSchema) : tool.inputSchema,
      outputSchema: tool.outputSchema,
      // The title also goes in the annotations: directories (Claude's among
      // them) read annotations.title for the listing.
      annotations: { title: tool.title, ...tool.annotations },
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

/**
 * Runs a tool. A tool with `invalidAnswer` has its schema run here instead of in
 * the SDK (decision 111), so arguments that fail it get an answer, and a word read
 * as something else ("hotel" as lodging) is said in `resolved_from`.
 */
async function runTool(tool, args, ctx) {
  if (!tool.invalidAnswer) return tool.handler(args, ctx);
  const raw = args && typeof args === "object" ? args : {};
  const checked = await tool.inputSchema["~standard"].validate(raw);
  if (checked.issues?.length) return tool.invalidAnswer(checked.issues, raw, tool);
  return withResolved(
    await tool.handler(checked.value, ctx),
    resolvedFrom(raw, checked.value),
  );
}

/**
 * The wrapper every tool call goes through, MCP or not: result caching, the
 * counting hooks, timing, and the error model (a throw becomes an error
 * result, never a stack). The MCP server registers it as the tool's handler;
 * the site's HTTP operations (R-26) call it with already-validated arguments,
 * so both transports run one code path and give one answer.
 *
 * @returns {(args: object, ctx?: object) => Promise<object>} the tool result
 */
export function wrapToolHandler(
  tool,
  {
    stats = { calls: 0, errors: 0, cacheHits: 0 },
    cache = new Lru(200),
    dataVersion = () => "",
    log,
    onToolCall,
    onToolResult,
  } = {},
) {
  return async (args, ctx) => {
    stats.calls++;
    const started = performance.now();
    const counted = onToolCall?.(tool.name, ctx);
    let output;
    try {
      const key = tool.cache
        ? `${dataVersion()}|${tool.name}|${stableStringify(args)}${
            // A tool that reads live data says how long its answer holds.
            tool.cacheTtlMs ? `|${Math.floor(Date.now() / tool.cacheTtlMs)}` : ""
          }`
        : null;
      output = key ? cache.get(key) : undefined;
      if (output) stats.cacheHits++;
      else {
        output = await runTool(tool, args, ctx);
        if (key && !output.isError) cache.set(key, output);
      }
    } catch (error) {
      output = toErrorResult(error, { log });
    }
    if (output.isError) stats.errors++;
    const ms = performance.now() - started;
    try {
      await counted;
      await onToolResult?.(tool.name, ctx, { args, output, ms });
    } catch {
      // counting never fails a call
    }
    log?.debug(
      `${tool.name} ${output.isError ? "error" : "ok"} in ${ms.toFixed(1)} ms`,
    );
    return output;
  };
}

/**
 * The same schema for the SDK's eyes (the JSON Schema a client reads) with
 * validation turned into a pass-through: the registry runs the real schema in
 * the handler. Not a loophole: nothing reaches a tool unchecked.
 */
export function lenientInput(schema) {
  const std = schema["~standard"];
  return {
    "~standard": {
      version: std.version,
      vendor: std.vendor,
      jsonSchema: std.jsonSchema,
      validate: (value) => ({ value }),
    },
  };
}

// Arguments whose reading is not worth a line in the answer.
const QUIET = new Set(["response_format"]);
const plain = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
const words = (x) =>
  typeof x === "string" ||
  (Array.isArray(x) && x.every((y) => typeof y === "string"));
const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x, i) => plain(x) === plain(b[i]))
    : !Array.isArray(a) && !Array.isArray(b) && plain(a) === plain(b);

/**
 * Which arguments were read as something else: a word mapped to its canonical
 * value ("hotel" as lodging, "NB" as north). Case, spacing and hyphens alone
 * are not worth saying; numbers and booleans read from strings are not either.
 */
export function resolvedFrom(raw, parsed) {
  const out = {};
  for (const [key, asked] of Object.entries(raw)) {
    if (QUIET.has(key) || !(key in parsed)) continue;
    const used = parsed[key];
    if (!words(asked) || !words(used) || same(asked, used)) continue;
    out[key] = { asked, used };
  }
  return Object.keys(out).length ? out : null;
}

/** The result with `resolved_from` in its data and one line in its text. */
export function withResolved(output, resolved) {
  if (!resolved || output.isError || !output.structuredContent) return output;
  const say = (v) => (Array.isArray(v) ? v.join(", ") : v);
  const line = `Read ${Object.entries(resolved)
    .map(([k, r]) => `${k} "${say(r.asked)}" as ${say(r.used)}`)
    .join("; ")}.`;
  const structuredContent = {
    ...output.structuredContent,
    resolved_from: resolved,
  };
  const first = output.content?.[0];
  let text = first?.text ?? "";
  if (text.startsWith("{")) {
    try {
      text = JSON.stringify(
        { ...JSON.parse(text), resolved_from: resolved },
        null,
        2,
      );
    } catch {
      text += "\n\n" + line;
    }
  } else text += "\n\n" + line;
  return {
    ...output,
    structuredContent,
    content: [
      { ...first, type: "text", text },
      ...(output.content ?? []).slice(1),
    ],
  };
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
