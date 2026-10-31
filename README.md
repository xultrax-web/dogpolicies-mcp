# Dog Rulebook MCP server

**[dogrulebook.com](https://dogrulebook.com/)** · Verified dog rules for California and Nevada travel, for AI assistants.

Ask Claude, Cursor or any MCP client "can my 70 lb dog stay at a Monterey hotel for under $50?" or "where can dogs run off leash near San Diego?" and get an answer with the official source, the date it was checked and a link to the record. No API key, no account, no configuration: the data ships inside the package and refreshes itself.

```bash
npx dogrulebook-mcp demo
```

<!-- mcp-name: io.github.xultrax-web/dogrulebook -->

[![npm](https://img.shields.io/npm/v/dogrulebook-mcp)](https://www.npmjs.com/package/dogrulebook-mcp)
[![license: MIT code, CC BY 4.0 data](https://img.shields.io/badge/license-MIT%20%2B%20CC%20BY%204.0-blue)](#license-and-attribution)
[![MCP 2026-07-28](https://img.shields.io/badge/MCP-2026--07--28-black)](https://modelcontextprotocol.io/specification/2026-07-28)

## What it answers

- Whether dogs are allowed at 2,400+ parks, beaches, trails, hotels, campgrounds and cabin resorts, with leash rules, restrictions, weight limits and pet fees.
- Which hotel will take _your_ dog: weight, number of dogs, nights and a fee budget, with the fee arithmetic spelled out ("2 dogs x 3 nights x $25 per pet per night = $150, capped at $100 per stay").
- Dog-friendly stops along I-5, US-101, Highway 1, I-15, I-80, US-50, US-95 and US-93, in driving order.
- Hotel chain pet policies (Motel 6, Red Roof, Kimpton and more) and which properties are exceptions.
- What changed since a date, so an agent can poll instead of re-reading everything.

Every fact comes from an official source (an agency page or the business's own policy) with the date it was checked. Every result starts with a one-line citation and ends with the license. When a source does not state something, the record says "not stated" instead of guessing.

## Install

### Claude Code

```bash
claude mcp add dogrulebook -- npx -y dogrulebook-mcp
```

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "dogrulebook": {
      "command": "npx",
      "args": ["-y", "dogrulebook-mcp"]
    }
  }
}
```

### Cursor

Settings → MCP → Add new global MCP server (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "dogrulebook": {
      "command": "npx",
      "args": ["-y", "dogrulebook-mcp"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json` in a workspace, or **MCP: Add Server** from the command palette:

```json
{
  "servers": {
    "dogrulebook": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "dogrulebook-mcp"]
    }
  }
}
```

### Hosted (no install)

The same tools are served remotely over Streamable HTTP at `https://dogrulebook.com/mcp/` for clients that connect by URL (Claude.ai connectors, ChatGPT, Cursor's URL servers):

```bash
claude mcp add --transport http dogrulebook https://dogrulebook.com/mcp/
```

### Local HTTP

```bash
npx dogrulebook-mcp --http --port 3737     # http://127.0.0.1:3737/mcp
```

Requires Node.js 20.19 or newer.

## Try it in the terminal

```bash
npx dogrulebook-mcp demo              # off-leash beaches near San Diego, with citations
npx dogrulebook-mcp demo "Monterey"   # hotels in Monterey for a 70 lb dog, 2 nights, fees worked out
npx dogrulebook-mcp check             # load the data and call every tool once
```

The `demo` output is the exact text an assistant receives:

```
- Coronado Dog Beach (Coronado, CA): Yes, with restrictions. Dogs may be off leash only on the
  designated Dog Beach area at 200 Ocean Boulevard ... Source: City of Coronado, checked
  2026-10-26. Dog Rulebook record: https://dogrulebook.com/places/coronado-dog-beach/
  (CC BY 4.0; cite with link).
  `coronado-dog-beach` · Coronado, San Diego County, California · 3 mi · freshness fresh
```

## Tools

| Tool                            | What it does                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dogrulebook_search_places`     | Search by name, type (beach, park, trail, lodging, campground, cabins), county, state, region or a point and radius; filter to dogs allowed or off-leash. |
| `dogrulebook_get_place`         | Full record for one place: every fact, its source with URL, date and quote, rule ids, and what the source does not state.                                 |
| `dogrulebook_find_hotels`       | Hotels that take a specific dog: weight, number of dogs, nights, fee budget. Verdicts (match, possible, excluded), cheapest first, fee arithmetic shown.  |
| `dogrulebook_get_brand_policy`  | A chain's published pet policy, its listed exceptions and property counts.                                                                                |
| `dogrulebook_browse_answers`    | Ready-made answers to common questions ("Which California state parks allow dogs?").                                                                      |
| `dogrulebook_route_stops`       | Dog stops along a highway by mile and direction: rest areas with pet areas, hotels, campgrounds, parks, beaches.                                          |
| `dogrulebook_get_rule`          | One rule by its stable id, with source, quote, confidence, verified date and freshness.                                                                   |
| `dogrulebook_changes_since`     | Verification events and rule changes since a date, newest first.                                                                                          |
| `dogrulebook_report_correction` | Files a correction for a person to verify. Nothing is published automatically. The only tool that writes.                                                 |

Every tool returns readable markdown by default and structured JSON (`response_format: "json"`), with an output schema. Every record carries `confidence` (stated, inferred_from_agency, inherited_brand), `freshness` (fresh, due, stale, unreadable, computed for today), `verified_at`, `url` and `source_urls`. Errors set `isError` with a code: `not_found`, `invalid`, `rate_limited`, `unavailable`, `offline`.

## How the data stays current

The package ships a dated snapshot (`as_of` in every result). On start it serves that snapshot immediately, then checks `https://dogrulebook.com/data/mcp-snapshot-v1.json` in the background and, when a newer one exists, swaps it in and caches it for next time. No network means no refresh and nothing else changes. Set `DOGRULEBOOK_OFFLINE=1` (or pass `--offline`) to never use the network.

| Variable                | Meaning                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DOGRULEBOOK_OFFLINE=1` | Never use the network. Corrections return the web form URL instead of being sent.                                        |
| `DOGRULEBOOK_BASE_URL`  | The site to refresh from and file corrections to. Must be https to dogrulebook.com, or http://localhost for development. |
| `DOGRULEBOOK_LOG`       | `silent`, `error`, `warn`, `info` (default) or `debug`, on stderr.                                                       |
| `DOGRULEBOOK_CACHE_DIR` | Where the refreshed snapshot is cached (default: the OS cache directory).                                                |

## Privacy

- **Nothing is collected.** The package has no telemetry, analytics or crash reporting, and never logs tool arguments above `debug` level (stderr, your terminal).
- **What leaves your machine:** a GET for the data snapshot on start (conditional, with an ETag), and, only when you use `dogrulebook_report_correction`, the correction text you typed plus an optional contact you chose to give. That is all.
- The hosted server at dogrulebook.com counts tool calls by tool name and client name; it stores no arguments, results or addresses.

## License and attribution

- **Code:** MIT.
- **Data:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribute "Dog Rulebook" with a link to https://dogrulebook.com/ and cite each record with its URL and verified date; every result includes a ready-made citation line. Chain-hotel names and locations come from OpenStreetMap under the [ODbL](https://www.openstreetmap.org/copyright) and say so in `record_license`.
- The rules are a sourced, dated summary, not legal advice. Confirm with the agency or the business before you go, especially when a record says `stale`, `unreadable` or `inherited_brand`. Service animals are governed by the ADA, not these pet rules. Terms: https://dogrulebook.com/terms/

## Report a wrong rule

Tell your assistant "that rule is wrong" and it can file a correction with `dogrulebook_report_correction`, or use the form on any record page. A person re-reads the official source, usually within a week; the record's verification history shows the result.

## For developers

```js
import { createRuntime, createServer, connectInProcess } from "dogrulebook-mcp";

const ctx = createRuntime({ overrides: { offline: true } });
const { client, close } = await connectInProcess(ctx);
const r = await client.callTool({
  name: "dogrulebook_find_hotels",
  arguments: { county: "Monterey", dog_weight_lb: 70 },
});
console.log(r.content[0].text);
await close();
```

`createServer(ctx)` returns an `McpServer` from the official `@modelcontextprotocol/server` SDK for any transport. The reusable core (`dogrulebook-mcp/core`) is documented in the repository's `docs/mcp-architecture.md`. Protocol: MCP 2026-07-28 with backward compatibility for 2025-11-25 and earlier clients.

Source, issues and the data pipeline: https://github.com/xultrax-web/dogrulebook (package in `packages/mcp`).
