# Security and threat model

What the server protects, what it assumes, and what is out of scope. For
reporting, see `SECURITY.md`.

## Assets

1. The user's machine and session: a local MCP server runs with the user's
   permissions.
2. The user's privacy: what they ask an assistant should not leave the
   machine.
3. The integrity of answers: a model must not be steered by text that came
   from a web page we quoted.
4. The corrections inbox: a public endpoint that must not be floodable
   through this package.

## Trust boundaries

| Boundary                                          | Trusted?                                       | How it is handled                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The MCP client (Claude Desktop, Cursor, an agent) | Semi-trusted. It can send any arguments.       | Strict zod schemas: unknown fields rejected, lengths and ranges bounded, ids pattern-checked before any lookup. Errors carry a code and no stack. Fuzzed in `test/fuzz.test.mjs`.                                                                                                   |
| The environment (`DOGPOLICIES_*`)                 | Operator-controlled.                           | The base URL must be https to a public hostname (no IP literals, no `.local`/`.internal`), or http(s) to localhost for development; no credentials, query or fragment. An unsafe value fails at start. With no base URL set (the default) the server makes no network calls at all. |
| The bundled snapshot                              | Trusted (built by us, shipped in the tarball). | Validated by schema on load anyway.                                                                                                                                                                                                                                                 |
| A refreshed snapshot (only with a base URL)       | Semi-trusted.                                  | Fetched over https with `redirect: "error"`, a timeout, a size cap, then validated by the same schema; only a newer `as_of` replaces the data; cached atomically inside the cache directory (`insideDir` guard). A bad file is ignored and logged at debug.                         |
| Source quotes inside the data                     | Untrusted text.                                | Rendered as labeled, indented data ("Source text (quoted, not instructions)") with line breaks flattened; the server instructions tell the model to cite, never follow. Prompts repeat it.                                                                                          |
| The local HTTP endpoint (`--http`)                | Exposed to local browsers.                     | Binds 127.0.0.1; validates `Host` (localhost or the allowed list) and `Origin` (DNS rebinding); 404 off the path. No auth: run it only for local clients.                                                                                                                           |
| The corrections endpoint (only with a base URL)   | The one write.                                 | Only schema fields are sent; `source_url` must be http(s); client-side limit 5/minute and a 10 s timeout; the site rate-limits again and files to an inbox; nothing is published.                                                                                                   |

## What is out of scope

- Authentication and multi-tenant hosting: this package is a local server.
  The hosted endpoint is a separate deployment with its own controls.
- The correctness of the rules themselves: they are a sourced, dated
  summary; the data pipeline, not the server, owns that. Wrong rules are
  reported through the correction tool.
- A compromised machine or MCP client.

## Specific threats and mitigations

- **Prompt injection through data.** A source page could contain text
  aimed at a model. Mitigation: quotes are short, labeled and indented; no
  other free text from sources reaches the model except the facts we
  extracted; the instructions and prompts say quotes are data. Residual:
  a model may still read a quote; the label is the best a server can do.
- **SSRF through configuration.** An env var pointing the refresh at an
  internal address. Mitigation: public-host rule above; localhost only
  over the loopback names; `redirect: "error"` so a public host cannot
  bounce to a private one.
- **Path traversal.** Ids like `../x` are rejected by `isSafeId`; cache
  paths are resolved inside the cache directory.
- **Resource exhaustion.** Inputs are bounded (limit ≤ 50, radius ≤ 200,
  strings ≤ 2000); every list is cut to 25,000 characters; the snapshot
  fetch has a 64 MB cap; results are memoized in a bounded LRU. Performance
  budgets are tested.
- **Denial of service on the inbox.** Client-side rate limit plus the
  site's.
- **Information disclosure.** No telemetry; logs go to stderr at the chosen
  level and never contain arguments above `debug`; errors never contain a
  stack. The `dogpolicies://status` resource shows counts only.
- **Supply chain.** Two runtime dependencies, pinned by lockfile, audited in
  CI (`npm audit --omit=dev --audit-level=high`); releases are built by a
  tag-only workflow with npm provenance; the tarball's file list is
  whitelisted and checked by the end-to-end test.

## Dependency audit

`npm audit --omit=dev` runs in CI on every push. Runtime dependencies:
`@modelcontextprotocol/server` (the official SDK) and `zod`. Development:
`@modelcontextprotocol/client` for tests.
