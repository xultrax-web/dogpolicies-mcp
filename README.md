# DogPolicies MCP server

**[dogpolicies.com](https://dogpolicies.com/)** · Verified dog rules for California and Nevada travel, for AI assistants. [Install guide and example](https://dogpolicies.com/mcp/about/).

**Listed in Claude's connector directory** since November 4, 2026: [add DogPolicies in Claude](https://claude.ai/directory/dogpolicies) with nothing to install. DogPolicies is independent and not affiliated with Anthropic.

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
- Dog-friendly stops along I-5, US-101, Highway 1, I-15, I-80, US-50, US-95 and US-93, in driving order. On I-5 in California, every stop sits on the I-5 centerline (s meters from San Ysidro) with its side, elevation and stretch; the next family stop (restrooms and a pet area stated by the source) in N miles; paired exits; and Caltrans conditions right now.
- Hotel chain pet policies (Motel 6, Red Roof, Kimpton and more) and which properties are exceptions.
- Side-by-side comparisons, and what changed since a date, everywhere or near a town.
- Areas the way travelers name them: East Bay, Lake Tahoe, Big Sur, Yosemite, Death Valley, the Mendocino Coast and the Bay Area's metros, as a filter, a place name in `near` and `plan_trip`, and a resource.

Every fact comes from an official source (an agency page or the business's own policy) with the date it was checked. Every result starts with a one-line citation and ends with `DogPolicies, dogpolicies.com, CC BY 4.0, verified {date}`. When a source does not state something, the record says "not stated" instead of guessing.

## Install

Pick the first one that fits; they all give the same server.

### 1. Claude (claude.ai or Claude Desktop): add the hosted connector, nothing to install

Open [DogPolicies in Claude's connector directory](https://claude.ai/directory/dogpolicies) and add it, then turn it on in the chat's tools menu. Or by hand: Settings → Connectors → **Add custom connector** → name **DogPolicies**, URL `https://dogpolicies.com/mcp/` → Add. No Node.js, no file editing; works on every plan that has connectors.

### 2. Claude Desktop: one-click extension

Download **dogpolicies-mcp-<version>.mcpb** from the [latest release](https://github.com/xultrax-web/dogpolicies-mcp/releases/latest) and open it (double-click, or Claude Desktop → Settings → Extensions → Install Extension). The data is inside; nothing else to install.

### 3. One command, any client

```bash
npx dogpolicies-mcp install                      # Claude Desktop (default)
npx dogpolicies-mcp install --client cursor      # or vscode | windsurf | claude-code, or --all
npx dogpolicies-mcp install --hosted             # the remote URL form instead of a local server
npx dogpolicies-mcp install --dry-run            # show what would change, change nothing
```

It finds the client's config on Windows, macOS and Linux, creates the file or the `mcpServers` key if missing, merges one entry without touching other settings, writes a timestamped backup first, refuses (and explains) a file it cannot parse, does nothing the second time, needs no admin rights, and prints the exact restart step. On Windows it writes the form that works (`cmd /c npx ...`). Requires Node.js 20.19 or newer.

### 4. One-click buttons (hosted server, no Node.js)

[![Add to Cursor](https://img.shields.io/badge/Cursor-Add_DogPolicies-000000?logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=dogpolicies&config=eyJ1cmwiOiJodHRwczovL2RvZ3BvbGljaWVzLmNvbS9tY3AvIn0=)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_DogPolicies-0098FF?logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22dogpolicies%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fdogpolicies.com%2Fmcp%2F%22%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_DogPolicies-24bfa5?logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22dogpolicies%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fdogpolicies.com%2Fmcp%2F%22%7D)

Both buttons add the hosted server at `https://dogpolicies.com/mcp/`; the client asks you to confirm.

### 5. Claude Code

```bash
claude mcp add dogpolicies -- npx -y dogpolicies-mcp                      # macOS, Linux
claude mcp add dogpolicies -- cmd /c npx -y dogpolicies-mcp               # Windows
claude mcp add --transport http dogpolicies https://dogpolicies.com/mcp/   # hosted, any OS
```

### 6. By hand

<details><summary>Claude Desktop</summary>

Settings → Developer → Edit Config (the file is `%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS). If the file has no `mcpServers` key yet, add one:

```json
{
  "mcpServers": {
    "dogpolicies": { "command": "npx", "args": ["-y", "dogpolicies-mcp"] }
  }
}
```

On Windows use `"command": "cmd", "args": ["/c", "npx", "-y", "dogpolicies-mcp"]`. Then fully quit Claude Desktop (tray icon → Quit on Windows, Cmd+Q on macOS) and reopen it.

</details>

<details><summary>Cursor</summary>

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in a project, same `mcpServers` block as above (Windows: the `cmd /c` form), or `{ "url": "https://dogpolicies.com/mcp/" }` for the hosted server.

</details>

<details><summary>VS Code</summary>

`~/.copilot/mcp-config.json` (what the guided flow calls Global → Copilot Global) with the same `mcpServers` block, or from a terminal:

```bash
code --add-mcp '{"name":"dogpolicies","type":"stdio","command":"npx","args":["-y","dogpolicies-mcp"]}'
```

</details>

<details><summary>Windsurf</summary>

`~/.codeium/windsurf/mcp_config.json`, same `mcpServers` block, or `{ "serverUrl": "https://dogpolicies.com/mcp/" }`.

</details>

### Local HTTP

```bash
npx dogpolicies-mcp --http --port 3737     # http://127.0.0.1:3737/mcp
```

## Troubleshooting

- **It does not show up after installing.** Restart properly. Claude Desktop must be fully quit: right-click the tray icon (Windows) or Claude menu → Quit (macOS); closing the window leaves it running. Cursor: toggle the server in Settings → MCP. VS Code: MCP: List Servers → Start. Windsurf: Refresh in the MCP panel.
- **Check the server itself.** `npx dogpolicies-mcp check` loads the data and calls every tool; `npx dogpolicies-mcp demo` prints a real answer. If these work, the problem is the client's config or restart.
- **Where the client's logs are.** Claude Desktop: `%APPDATA%\Claude\logs\mcp.log` and `mcp-server-dogpolicies.log` (Windows), `~/Library/Logs/Claude/` (macOS). Cursor: Output panel → MCP Logs. VS Code: MCP: List Servers → Show Output. Claude Code: `claude mcp list`, or `--mcp-debug`.
- **"spawn npx ENOENT" on Windows.** The client starts commands without a shell and `npx` is a `.cmd` file. Use `"command": "cmd", "args": ["/c", "npx", "-y", "dogpolicies-mcp"]` (the installer writes this), or the hosted connector.
- **Node version.** `node --version` must be 20.19 or newer (`npx` comes with Node). The hosted connector and the Claude Desktop extension need no Node at all (the extension uses Claude Desktop's own).
- **Behind a corporate proxy.** `npx` needs to reach registry.npmjs.org once to fetch the package; set `HTTPS_PROXY` (npm reads `npm config set proxy` too) or use the extension or the hosted connector, which need no npm. The server itself makes one background request to dogpolicies.com for newer data and works offline without it; set `DOGPOLICIES_OFFLINE=1` to never try.
- **Still stuck?** Open an issue with the output of `npx dogpolicies-mcp check`, your OS and client: https://github.com/xultrax-web/dogpolicies-mcp/issues

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
| `dogpolicies_route_stops`       | Dog stops along a highway by mile and direction: rest areas with pet areas, hotels, campgrounds, parks, beaches. On I-5 in California: s meters from San Ysidro, side, elevation, family stops (restrooms and a pet area stated) and paired exits. |
| `dogpolicies_i5_corridor`       | I-5 in California as eleven stretches on the I-5 centerline, and the stops in a stretch, a mile range or a window ahead of a point.                                  |
| `dogpolicies_i5_conditions`     | Caltrans closures, road weather, sign text and chain controls on I-5 right now, placed on the same axis; conditions, not rules. Needs the network.                   |
| `dogpolicies_get_rule`          | One rule by its stable id, with source, quote, confidence, verified date and freshness.                                                                               |
| `dogpolicies_changes_since`     | Verification events and rule changes since a date, newest first.                                                                                                      |
| `dogpolicies_changes_near`      | The same, limited to a radius around a town or point.                                                                                                                 |
| `dogpolicies_report_correction` | Files a correction for a person to verify. Nothing is published automatically. The only tool that writes.                                                             |

Every tool returns readable markdown by default and structured JSON (`response_format: "json"`), with an output schema. Every record carries `confidence` (stated, inferred_from_agency, inherited_brand), `freshness` (fresh, due, stale, unreadable, computed for today), `verified_at`, `url` and `source_urls`. Errors set `isError` with a code: `not_found`, `invalid`, `rate_limited`, `unavailable`, `offline`. The full reference, generated from the code, is [docs/tools.md](docs/tools.md).

### Resources and prompts

Resources let a client attach a record without a tool call: `dogpolicies://place/{id}`, `dogpolicies://brand/{id}`, `dogpolicies://answer/{slug}`, `dogpolicies://route/{id}`, `dogpolicies://area/{id}` (all with completion), plus `dogpolicies://about`, `dogpolicies://answers`, `dogpolicies://status` and `dogpolicies://corridor/i-5` (the I-5 stretches and every stop by s). Prompts give a client's slash menu the common trips: `plan_dog_trip`, `check_hotel_for_dog`, `road_trip_with_dog`, `drive_i5_with_dog`, `what_can_my_dog_do_here`, `cite_a_rule`, with town-name completion.

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
