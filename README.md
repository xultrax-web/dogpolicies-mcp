# DogPolicies MCP server

**[dogpolicies.com](https://dogpolicies.com/)** · Verified dog rules for California and Nevada travel, for AI assistants. [Install guide and example](https://dogpolicies.com/mcp/about/).

Ask Claude, Cursor or any MCP client "can my 70 lb dog stay at a Monterey hotel for under $50?", "what can my dog do in Carmel?" or "plan three nights in Tahoe with two dogs" and get an answer with the official source, the date it was checked and a link to the record. No API key, no account, no configuration: the data ships inside the package.

```bash
npx dogpolicies-mcp demo
```

<!-- mcp-name: io.github.xultrax-web/dogpolicies-mcp -->

[![npm](https://img.shields.io/npm/v/dogpolicies-mcp)](https://www.npmjs.com/package/dogpolicies-mcp)
[![CI](https://github.com/xultrax-web/dogpolicies-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/xultrax-web/dogpolicies-mcp/actions/workflows/ci.yml)
[![license: MIT code, CC BY 4.0 data](https://img.shields.io/badge/license-MIT%20%2B%20CC%20BY%204.0-blue)](#license-and-attribution)
[![MCP 2026-07-28](https://img.shields.io/badge/MCP-2026--07--28-black)](https://modelcontextprotocol.io/specification/2026-07-28)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](#install)

## What it answers

- Whether dogs are allowed at 2,400+ parks, beaches, trails, hotels, campgrounds, cabin resorts and restaurant patios, with leash rules, restrictions, weight limits and pet fees.
- Which hotel will take _your_ dog: weight, number of dogs, nights and a fee budget, with the fee arithmetic spelled out ("2 dogs x 3 nights x $25 per pet per night = $150, capped at $100 per stay").
- A whole trip in one call: where to stay with this dog, what to do, where to eat, near any town or county.
- Dog-friendly stops along I-5, US-101, Highway 1, I-15, I-80, US-50, US-95 and US-93, in driving order.
- Hotel chain pet policies (Motel 6, Red Roof, Kimpton and more) and which properties are exceptions.
- Side-by-side comparisons, and what changed since a date, everywhere or near a town.
- Areas the way travelers name them: East Bay, Lake Tahoe, Big Sur, Yosemite, Death Valley, the Mendocino Coast and the Bay Area's metros, as a filter, a place name in `near` and `plan_trip`, and a resource.

Every fact comes from an official source (an agency page or the business's own policy) with the date it was checked. Every result starts with a one-line citation and ends with `DogPolicies, dogpolicies.com, CC BY 4.0, verified {date}`. When a source does not state something, the record says "not stated" instead of guessing.

## Install

### Claude Code

```bash
claude mcp add dogpolicies -- npx -y dogpolicies-mcp
```

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "dogpolicies": {
      "command": "npx",
      "args": ["-y", "dogpolicies-mcp"]
    }
  }
}
```

### Cursor

Settings → MCP → Add new global MCP server (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "dogpolicies": {
      "command": "npx",
      "args": ["-y", "dogpolicies-mcp"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json` in a workspace, or **MCP: Add Server** from the command palette:

```json
{
  "servers": {
    "dogpolicies": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "dogpolicies-mcp"]
    }
  }
}
```

### Hosted (no install)

The same tools are served over Streamable HTTP at `https://dogpolicies.com/mcp/` for clients that connect by URL:

```bash
claude mcp add --transport http dogpolicies https://dogpolicies.com/mcp/
```

### Local HTTP

```bash
npx dogpolicies-mcp --http --port 3737     # http://127.0.0.1:3737/mcp
```

Requires Node.js 20.19 or newer.

## Try it in the terminal

```bash
npx dogpolicies-mcp demo              # off-leash beaches near San Diego, with citations
npx dogpolicies-mcp demo "Monterey"   # hotels in Monterey for a 70 lb dog, 2 nights, fees worked out
npx dogpolicies-mcp check             # load the data and call every tool once
```

The `demo` output is the exact text an assistant receives:

```
- Coronado Dog Beach (Coronado, CA): Yes, with restrictions. Dogs may be off leash only on the
  designated Dog Beach area at 200 Ocean Boulevard ... Source: City of Coronado, checked
  2026-10-26. Record: https://dogpolicies.com/places/coronado-dog-beach/ (CC BY 4.0; cite with link).
  `coronado-dog-beach` · Coronado, San Diego County, California · 3 mi · freshness fresh
```

## Tools

| Tool                            | What it does                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dogpolicies_search_places`     | Search by name, type (beach, park, trail, lodging, campground, cabins, restaurant), county, state, region or a point and radius; filter to dogs allowed or off-leash. |
| `dogpolicies_near`              | Everything dog-related near a town, county or point, grouped by kind and sorted by distance. Takes a town name; no coordinates needed.                                |
| `dogpolicies_get_place`         | Full record for one place: every fact, its source with URL, date and quote, rule ids, and what the source does not state.                                             |
| `dogpolicies_compare_places`    | Two to six places side by side: dogs allowed, leash, fee, weight limit, pets per room, freshness, who confirmed.                                                      |
| `dogpolicies_plan_trip`         | A stay in a town with this dog: stays that fit (fee for the whole stay worked out), beaches, parks, trails and patios nearby.                                         |
| `dogpolicies_find_hotels`       | Hotels that take a specific dog: weight, number of dogs, nights, fee budget. Verdicts (match, possible, excluded), cheapest first, fee arithmetic shown.              |
| `dogpolicies_get_brand_policy`  | A chain's published pet policy, its listed exceptions and property counts.                                                                                            |
| `dogpolicies_browse_answers`    | Ready-made answers to common questions ("Which California state parks allow dogs?").                                                                                  |
| `dogpolicies_route_stops`       | Dog stops along a highway by mile and direction: rest areas with pet areas, hotels, campgrounds, parks, beaches.                                                      |
| `dogpolicies_get_rule`          | One rule by its stable id, with source, quote, confidence, verified date and freshness.                                                                               |
| `dogpolicies_changes_since`     | Verification events and rule changes since a date, newest first.                                                                                                      |
| `dogpolicies_changes_near`      | The same, limited to a radius around a town or point.                                                                                                                 |
| `dogpolicies_report_correction` | Files a correction for a person to verify. Nothing is published automatically. The only tool that writes.                                                             |

Every tool returns readable markdown by default and structured JSON (`response_format: "json"`), with an output schema. Every record carries `confidence` (stated, inferred_from_agency, inherited_brand), `freshness` (fresh, due, stale, unreadable, computed for today), `verified_at`, `url` and `source_urls`. Errors set `isError` with a code: `not_found`, `invalid`, `rate_limited`, `unavailable`, `offline`. The full reference, generated from the code, is [docs/tools.md](docs/tools.md).

### Resources and prompts

Resources let a client attach a record without a tool call: `dogpolicies://place/{id}`, `dogpolicies://brand/{id}`, `dogpolicies://answer/{slug}`, `dogpolicies://route/{id}`, `dogpolicies://area/{id}` (all with completion), plus `dogpolicies://about`, `dogpolicies://answers` and `dogpolicies://status`. Prompts give a client's slash menu the common trips: `plan_dog_trip`, `check_hotel_for_dog`, `road_trip_with_dog`, `what_can_my_dog_do_here`, `cite_a_rule`, with town-name completion.

## How the data stays current

The package ships a dated snapshot (`as_of` in every result). On start it serves that snapshot immediately, then checks `https://dogpolicies.com/data/mcp-snapshot-v1.json` in the background and, when a newer one exists, swaps it in and caches it for next time. Until the site is deployed there, that check fails fast and silently and the bundled data serves on its own. Set `DOGPOLICIES_OFFLINE=1` (or pass `--offline`) to never use the network. All options: [docs/configuration.md](docs/configuration.md).

## Privacy

- **Nothing is collected.** No telemetry, analytics or crash reporting; tool arguments are never logged above `debug` level (stderr, your terminal).
- **What leaves your machine:** one conditional GET for the data snapshot on start, and, only when you use `dogpolicies_report_correction`, the correction text you typed plus an optional contact you chose to give. Both go to dogpolicies.com over https and nowhere else. `--offline` stops both.
- Threat model and controls: [docs/security.md](docs/security.md).

## License and attribution

- **Code:** MIT.
- **Data:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribute "DogPolicies" with a link to https://dogpolicies.com/ and cite each record with its URL and verified date; every result includes a ready-made citation line. Chain-hotel names and locations come from OpenStreetMap under the [ODbL](https://www.openstreetmap.org/copyright) and say so in `record_license`.
- The rules are a sourced, dated summary, not legal advice. Confirm with the agency or the business before you go, especially when a record says `stale`, `unreadable` or `inherited_brand`. Service animals are governed by the ADA, not these pet rules. Terms: https://dogpolicies.com/terms/

## Report a wrong rule

Tell your assistant "that rule is wrong" and it can file a correction with `dogpolicies_report_correction`, or use the form on any record page. A person re-reads the official source, usually within a week; the record's verification history shows the result.

## For developers

```js
import { createRuntime, createServer, connectInProcess } from "dogpolicies-mcp";

const ctx = createRuntime({ overrides: { offline: true } });
const { client, close } = await connectInProcess(ctx);
const r = await client.callTool({
  name: "dogpolicies_plan_trip",
  arguments: { place: "Monterey", dog_weight_lb: 70, nights: 3 },
});
console.log(r.content[0].text);
await close();
```

`createServer(ctx)` returns an `McpServer` from the official `@modelcontextprotocol/server` SDK for any transport. The reusable, dog-free core (`dogpolicies-mcp/core`) and how to build another server on it: [docs/architecture.md](docs/architecture.md). Versioning and deprecation: [docs/versioning.md](docs/versioning.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

Tests: `npm test` runs unit, contract, security, performance, surface, eval (33 real questions scored for tool selection and answer facts) and fuzz tests; `npm run test:e2e` packs the tarball and runs it over stdio. CI runs on Linux, macOS and Windows with Node 20, 22 and 24.
