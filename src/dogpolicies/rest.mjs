// The same answers over plain HTTP (roadmap R-26), for agents that do not
// speak MCP. Every read-only tool is an operation, GET <base>/<operation>
// (dogpolicies_near is "near", dogpolicies_i5_conditions is "i5-conditions"):
// the query string becomes the tool's arguments, the tool's own zod input
// schema validates them, the same wrapped handler the MCP server registers
// runs, and the body is the tool's structuredContent. There is no second copy
// of any business logic here: parsing, errors and the OpenAPI description are
// all derived from the tool definitions, so they cannot drift from the MCP
// server. report_correction (the one write) is not exposed.

import * as z from "zod/v4";
import { wrapToolHandler } from "../core/server.mjs";
import { Lru } from "../core/lru.mjs";
import { tools } from "./tools/index.mjs";

/** "dogpolicies_i5_conditions" -> "i5-conditions". */
export const operationSlug = (name) =>
  name.replace(/^[a-z0-9]+_/, "").replaceAll("_", "-");

/** The first sentence of a tool description (up to the first full stop of its first paragraph). */
export function firstSentence(description) {
  const paragraph = String(description)
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const m = paragraph.match(/^(.+?[.!?])(?:\s|$)/);
  return (m ? m[1] : paragraph).trim();
}

/** A tool's input as JSON Schema 2020-12 (what a client sends). */
export const inputJsonSchema = (tool) =>
  z.toJSONSchema(tool.inputSchema, {
    io: "input",
    unrepresentable: "any",
    reused: "inline",
  });

/** A tool's answer (structuredContent) as JSON Schema. */
export const outputJsonSchema = (tool) =>
  z.toJSONSchema(tool.outputSchema, {
    io: "output",
    unrepresentable: "any",
    reused: "inline",
  });

const typeOf = (schema) => {
  if (schema?.type)
    return Array.isArray(schema.type)
      ? schema.type.find((t) => t !== "null")
      : schema.type;
  for (const s of schema?.anyOf ?? schema?.oneOf ?? []) {
    const t = typeOf(s);
    if (t && t !== "null") return t;
  }
  return undefined;
};
const itemsOf = (schema) =>
  schema?.items ??
  (schema?.anyOf ?? schema?.oneOf ?? []).map((s) => s.items).find(Boolean);
const propsOf = (schema) =>
  schema?.properties ??
  (schema?.anyOf ?? schema?.oneOf ?? []).map((s) => s.properties).find(Boolean);

function scalar(schema, raw) {
  const t = typeOf(schema);
  if (t === "number" || t === "integer") {
    const n = Number(raw);
    return raw.trim() === "" || Number.isNaN(n) ? raw : n;
  }
  if (t === "boolean") {
    const v = raw.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return raw;
}

/**
 * Query string -> the arguments object, shaped by the tool's JSON Schema:
 * numbers and booleans are read as such; an array is a repeated parameter
 * (types=beach&types=park) or a comma list (types=beach,park); an object is
 * written near.lat=36.6&near.lon=-121.9 (near[lat] works too). A parameter the
 * schema does not know is passed through, so the strict input schema reports
 * it (a typo is a 400, never silently ignored). Anything that cannot be read as
 * the type is passed as the raw string, and the tool's own schema rejects it.
 */
export function parseQuery(jsonSchema, searchParams) {
  const flat = new Map();
  for (const [name, value] of searchParams.entries()) {
    const key = name.replace(/\[([^\]]*)\]/g, ".$1");
    if (!flat.has(key)) flat.set(key, []);
    flat.get(key).push(value);
  }
  const used = new Set();
  const read = (schema, prefix) => {
    const out = {};
    for (const [k, prop] of Object.entries(propsOf(schema) ?? {})) {
      const name = prefix ? `${prefix}.${k}` : k;
      if (typeOf(prop) === "object" && propsOf(prop)) {
        const inner = read(prop, name);
        if (Object.keys(inner).length) out[k] = inner;
        continue;
      }
      const values = flat.get(name);
      if (!values) continue;
      used.add(name);
      if (typeOf(prop) === "array") {
        const item = itemsOf(prop) ?? {};
        out[k] = values
          .flatMap((v) => v.split(","))
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => scalar(item, v));
      } else {
        out[k] = values.length === 1 ? scalar(prop, values[0]) : values;
      }
    }
    return out;
  };
  const args = read(jsonSchema, "");
  // What the schema did not claim goes through as given; the strict input schema names it.
  const put = (target, key, value) =>
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  for (const [name, values] of flat) {
    if (used.has(name)) continue;
    const parts = name.split(".");
    let target = args;
    for (const part of parts.slice(0, -1)) {
      // own properties only: "__proto__.x" must never reach Object.prototype
      if (
        !Object.hasOwn(target, part) ||
        typeof target[part] !== "object" ||
        target[part] === null
      )
        put(target, part, {});
      target = target[part];
    }
    put(target, parts.at(-1), values.length === 1 ? values[0] : values);
  }
  return args;
}

/** The operations that read a live feed: kept 30 seconds, never when stale or unavailable. */
export const LIVE_OPERATIONS = new Set(["i5-conditions", "road-conditions"]);

/** How long an answer may be reused, in seconds; 0 means do not store. */
export function cacheSeconds(slug, status, body) {
  if (status !== 200) return 0;
  if (LIVE_OPERATIONS.has(slug))
    return body?.stale === true || body?.outcome === "unavailable" ? 0 : 30;
  return 60;
}

/**
 * The HTTP operations over a runtime.
 * @param {object} ctx the runtime (createRuntime)
 * @param {object} [options]
 * @param {number} [options.cacheSize] results kept (the MCP server's cache is per connection; this one lives as long as the engine)
 */
export function createRestApi(ctx, { cacheSize = 200 } = {}) {
  const cache = new Lru(cacheSize);
  const defs = tools
    .map((make) => make(ctx))
    .filter((t) => t.annotations?.readOnlyHint === true);
  const operations = new Map(
    defs.map((tool) => [
      operationSlug(tool.name),
      { slug: operationSlug(tool.name), tool, schema: inputJsonSchema(tool) },
    ]),
  );
  const valid = () => [...operations.keys()];
  return {
    operations,
    /** Names of the operations, for the 404 listing. */
    list: valid,
    /**
     * Runs one operation.
     * @param {string} slug the operation, e.g. "near"
     * @param {URLSearchParams} searchParams
     * @param {{ onToolCall?: Function, onToolResult?: Function }} [hooks] counting
     * @returns {Promise<{ status: number, body: object, cache: number }>}
     */
    async run(slug, searchParams, hooks = {}) {
      const op = operations.get(slug);
      if (!op)
        return {
          status: 404,
          cache: 0,
          body: {
            error: {
              code: "unknown_operation",
              message: `No operation "${slug}". The operations are: ${valid().join(", ")}.`,
            },
            operations: valid(),
          },
        };
      const parsed = op.tool.inputSchema.safeParse(
        parseQuery(op.schema, searchParams),
      );
      if (!parsed.success)
        return {
          status: 400,
          cache: 0,
          body: {
            error: {
              code: "bad_request",
              message: `The query does not match the input of ${op.tool.name}.`,
            },
            issues: parsed.error.issues,
          },
        };
      const handler = wrapToolHandler(op.tool, {
        stats: ctx._stats,
        cache,
        dataVersion: () => `${ctx.graph.as_of}|${ctx.today()}`,
        log: ctx.log,
        onToolCall: hooks.onToolCall,
        onToolResult: hooks.onToolResult,
      });
      const output = await handler(parsed.data, { transport: "http" });
      const body = output.structuredContent ?? {
        error: { code: "internal", message: "The server could not answer." },
      };
      const status = output.isError
        ? body?.error?.code === "rate_limited"
          ? 429
          : 500
        : 200;
      return { status, body, cache: cacheSeconds(slug, status, body) };
    },
  };
}

// ---- The OpenAPI 3.1 fragment, from the same definitions ----

const PARAM_SKIP = new Set(["$schema", "additionalProperties"]);
const clean = (schema) =>
  Object.fromEntries(
    Object.entries(schema).filter(([k]) => !PARAM_SKIP.has(k)),
  );

/** Query parameters for one tool: its input properties, objects expanded as near.lat. */
export function openApiParameters(jsonSchema) {
  const required = new Set(jsonSchema.required ?? []);
  const out = [];
  const walk = (schema, prefix, isRequired) => {
    for (const [k, prop] of Object.entries(propsOf(schema) ?? {})) {
      const name = prefix ? `${prefix}.${k}` : k;
      const req = isRequired(k);
      if (typeOf(prop) === "object" && propsOf(prop)) {
        const inner = new Set(prop.required ?? []);
        // An optional object's members are required only together; mark them optional unless the object is.
        walk(prop, name, (m) => req && inner.has(m));
        continue;
      }
      const { description, ...rest } = clean(prop);
      const note =
        typeOf(prop) === "array"
          ? " Repeat the parameter or give a comma list."
          : "";
      out.push({
        name,
        in: "query",
        required: req,
        ...((description ?? "") + note
          ? { description: ((description ?? "") + note).trim() }
          : {}),
        schema: rest,
        ...(typeOf(prop) === "array" ? { style: "form", explode: true } : {}),
      });
    }
  };
  walk(jsonSchema, "", (k) => required.has(k));
  return out;
}

const pascal = (slug) =>
  slug
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

/**
 * Paths and component schemas for every operation, ready to merge into the
 * site's OpenAPI document. Paths are relative to `${base}` (the document's
 * server URL carries /api/v1).
 */
export function restOpenApi(ctx, { prefix = "/ask" } = {}) {
  const api = createRestApi(ctx, { cacheSize: 1 });
  const paths = {};
  const schemas = {
    Problem: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: { code: { type: "string" }, message: { type: "string" } },
        },
        issues: {
          type: "array",
          description:
            "The input schema's issues (path, code, message), on a 400",
          items: { type: "object" },
        },
        operations: {
          type: "array",
          items: { type: "string" },
          description: "The valid operations, on a 404",
        },
      },
    },
  };
  for (const { slug, tool, schema } of api.operations.values()) {
    const answer = `${pascal(slug)}Answer`;
    schemas[answer] = clean(outputJsonSchema(tool));
    paths[`${prefix}/${slug}`] = {
      get: {
        operationId: tool.name,
        summary: firstSentence(tool.description),
        description: tool.description,
        tags: ["Live answers"],
        parameters: openApiParameters(schema),
        responses: {
          200: {
            description:
              "The tool's structured answer, the same JSON an MCP client receives as structuredContent. An outcome other than ok (no_match, bad_input, partial, unavailable) is still a 200 answer with did_you_mean, nearest and next.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                description: LIVE_OPERATIONS.has(slug)
                  ? "max-age=30, or no-store when the conditions document is stale or unavailable"
                  : "public, max-age=60",
              },
            },
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${answer}` },
              },
            },
          },
          400: {
            description: "A parameter does not match the input schema",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Problem" },
              },
            },
          },
          429: { description: "More than the keyless allowance this minute" },
          500: { description: "The server failed (not a data miss)" },
        },
        "x-mcp-tool": tool.name,
        "x-readOnly": true,
      },
    };
  }
  return { paths, schemas, operations: [...api.operations.keys()] };
}
