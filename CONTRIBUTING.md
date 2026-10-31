# Contributing

Thank you for looking. This repository holds the DogPolicies MCP server; the
data it serves is built elsewhere and shipped here as a dated snapshot.

## What you can change here

- The server: tools, resources, prompts, the reusable core, docs, tests.
- Tool descriptions and the eval set (`test/eval/questions.json`): if a
  model picks the wrong tool for a real question, add the question and fix
  the description.

## What you cannot change here

- **The data.** A wrong rule is reported, not edited: use the
  `dogpolicies_report_correction` tool or the form on the record's page. A
  person re-reads the official source before anything changes. The snapshot
  in `data/` is generated; pull requests that edit it are closed.

## Setup

```bash
git clone https://github.com/xultrax-web/dogpolicies-mcp
cd dogpolicies-mcp
npm install
npm test            # unit, contract, security, performance, eval, fuzz
npm run test:e2e    # packs the tarball and runs it over stdio
npm run check       # every tool once
npm run demo        # one cited answer
```

Node 20.19 or newer. Two runtime dependencies (`@modelcontextprotocol/server`
and `zod`); please do not add more without a reason in the pull request.

## Rules of the road

- A tool, input field or output field is never removed or renamed in a minor
  release. `test/contracts/tools.json` enforces it; regenerate it with
  `node scripts/contracts.mjs` only for an intended change and explain the
  change in `CHANGELOG.md`. See `docs/versioning.md`.
- Every text result starts with a citation and ends with the attribution
  line. Every record keeps its URL, verified date and source URLs.
- No telemetry, no network calls beyond the documented data refresh and the
  correction report. See `docs/security.md`.
- US spelling. Plain words.
- Run `npx prettier --write .` before committing.

## Pull requests

One change per pull request, with a test. CI runs on Linux, macOS and
Windows with Node 20, 22 and 24; all of it must pass.
