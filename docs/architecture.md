# Architecture

`dogpolicies-mcp` is two things: the DogPolicies MCP server, and a core
that knows nothing about dogs. A second server (another dataset, another
product) reuses the core and supplies three things: its data, its
definitions (tools, resources, prompts), its identity.

Protocol: MCP 2026-07-28 through the official `@modelcontextprotocol/server`
SDK 2.x, which also serves 2025-11-25 and earlier clients. Runtime: Node
20.19+, ESM, two runtime dependencies (the SDK and zod).

## Layout

```
bin/dogpolicies-mcp.mjs         CLI: stdio (default), --http, demo, check
src/config.mjs                  the single config point: names, brand, env vars, limits, allowed hosts
src/core/                       reusable, dog-free
  server.mjs                    definitions -> McpServer; validation, cache, timing, errors, cache hints
  errors.mjs                    ToolError, stable codes, fail(), toErrorResult()
  result.mjs                    text+structured results, paged lists under a character budget
  citation.mjs                  attribution envelope, "verified {date}" line, footers, quoteBlock()
  source.mjs                    snapshot source: bundled > cache > remote, ETag, retries, validation
  safety.mjs                    base URL guard (SSRF), id guard, path guard
  http.mjs                      Streamable HTTP on node:http with Host/Origin checks
  freshness.mjs, geo.mjs        date-aware freshness; miles, nearest point on a line
  lru.mjs, log.mjs              result cache; stderr logger with levels, no telemetry
src/snapshot/build.mjs          graph -> snapshot (runs in the data repository and on the site)
src/dogpolicies/                this server
  graph.mjs                     snapshot validation (zod), indexes, date-aware views
  server.mjs                    createRuntime(), createServer(): config + data + definitions + identity
  tools/*.mjs                   one tool per file; tools/index.mjs is the list (its order is the list order)
  tools/common.mjs, scope.mjs   shared schemas, summary line, location filter, town resolver, "where" scope
  resources.mjs, prompts.mjs    resource URIs and templates with completion; prompts with completion
  report.mjs                    the one write: POST a correction, rate-limited, timeout
  vendor/match.mjs              GENERATED copy of the data repository's hotel matcher
  stay.mjs                      the few constants the matcher and formatting need
  connect.mjs, cli.mjs          in-process client; demo and check commands
data/snapshot.json.gz           the dated data (~1.2 MB gzipped)
test/                           unit, contract, security, perf, HTTP, surface, eval, fuzz; test/e2e packs and runs the tarball
scripts/                        build (maintainer), prepack, contracts, docs, sync-public (maintainer)
docs/                           this folder; tools.md is generated
server.json                     MCP Registry metadata
```

## The runtime and the server

`createRuntime(options)` runs once per process: reads the configuration,
loads the snapshot, builds the indexes and returns `ctx`:

| Field                   | What it is                                                              |
| ----------------------- | ----------------------------------------------------------------------- |
| `ctx.graph`             | the hydrated snapshot (a getter: it swaps when a refresh lands)         |
| `ctx.today()`           | today as a Pacific date, pinnable with `DOGPOLICIES_TODAY`              |
| `ctx.citations`         | envelope, `line(date)`, footer builder for the brand                    |
| `ctx.report`            | the correction sender, or `null` offline                                |
| `ctx.source`            | the snapshot source: `refresh()`, `origin`                              |
| `ctx.stats()`           | calls, errors, cache hits, servers created (for `dogpolicies://status`) |
| `ctx.log`, `ctx.config` | logger; the resolved configuration                                      |

`createServer(ctx)` makes a fresh `McpServer` per connection (the SDK's
factory pattern for stdio and HTTP) from the definitions. A tool is a plain
object:

```js
export const myTool = (ctx) => ({
  name: "myserver_do_thing",     // snake_case, server-prefixed, never renamed
  title: "Do the thing",
  description: "...written for a model choosing between tools, with examples",
  inputSchema: z.strictObject({ ... }),   // strict: unknown fields are rejected
  outputSchema: z.looseObject({ ... }),   // loose: fields may be added later
  annotations: READ_ONLY,                 // or WRITE_ONCE
  cache: true,                            // memoize by (data version, args)
  since: "0.2.0",
  handler: async (args) => result(data, args.response_format, () => markdown),
});
```

The core wraps each handler: the SDK validates input against the zod schema
before the handler runs; a cached result is served when the data version and
arguments match; a thrown `ToolError` becomes `{ isError, code }`; any other
exception becomes `internal` with no stack in the result; the call is timed
to the debug log. A tool that finds nothing does not throw: it returns an
`answer()` (`core/errors.mjs`) whose `outcome` says what happened and whose
shape satisfies the tool's output schema, so the SDK's output validation
still runs on it and no directory counts it as an error. Resources (`{ uri | template, read }`) and prompts
(`{ argsSchema, build }`) are registered the same way, with cache hints on
the list methods and resource reads so 2026-07-28 clients can cache them.

## Contracts the core enforces

- **Citation first, attribution last.** Every markdown result begins with a
  citation sentence (each list item with its own) and ends with
  `DogPolicies, dogpolicies.com, CC BY 4.0, verified {date}`: the record's
  verified date for a single record, the data date for a list.
- **Structured and text, always.** `structuredContent` on every call; text
  in the requested format, markdown by default.
- **A character budget.** Lists halve until under 25,000 characters, with
  `has_more` and `next_offset`.
- **Deterministic output.** Tools are pure over `(snapshot, today, args)`;
  the LRU keys on exactly those; `tools/list` order is fixed.
- **Date-aware freshness, never stored.**
- **Errors with codes.** Added, never renamed.
- **Quotes are data.** `quoteBlock()` labels and indents source text.

## The data source

`createSnapshotSource`: bundled (always), a newer cached copy, then a
background conditional GET of the hosted snapshot (ETag, 5 s timeout, two
short retries on transient errors, 64 MB cap, `redirect: "error"`),
validated by the same zod schema, swapped in only when newer, cached
atomically. Never throws, never blocks a call. `DOGPOLICIES_OFFLINE=1`
disables it and the correction sender.

## Areas

The data has a Region > Area > City > Place structure. The snapshot carries
`areas` (id, name, kind, region, state, blurb, place count, centroid) and
`area`/`area_id` on every place; the gazetteer lists each area as a town of
kind `area`, resolved first by `resolveTown`, and `resolveScope` treats an
area as its member places rather than a radius. The location filter accepts
`area`, summaries carry `area`, and `dogpolicies://area/{id}` reads an area
with completion. No schema bump was needed: every field is additive.

## Building a second server on the core

1. Copy this repository; keep `src/core/` untouched, improve it in place
   when a need is general.
2. `src/config.mjs`: set `BRAND`, `SERVER_NAME`, `SERVER_TITLE`, the env
   prefix, `DEFAULT_BASE_URL`, `ALLOWED_HOSTS`, `SNAPSHOT_PATH`, limits.
3. Data: write `src/snapshot/build.mjs` for the new graph (no date-dependent
   field, stable ids, a `citation` per record, `schema` and `as_of` at the
   top) and `src/<name>/graph.mjs` with its zod schema and indexes.
4. Definitions: tools under `src/<name>/tools/`, listed in `tools/index.mjs`;
   resources and prompts beside them. Reuse `pageResult`, `result`, `fail`,
   `quoteBlock`, `READ_ONLY`/`WRITE_ONCE`, `resolveScope`-style helpers.
5. Runtime: `createRuntime` is thirty lines: `readConfig`,
   `createSnapshotSource`, `hydrate`, `createCitations`, the write-side
   client if any.
6. Tests: keep the core, security, perf, fuzz and e2e tests; write a tools
   test and an eval set; record the first contract.
7. Ship: `bin/`, `server.json`, README, the same workflows.
