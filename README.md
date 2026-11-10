# DogPolicies MCP server

**[dogpolicies.com](https://dogpolicies.com/)** · Verified dog rules for California and Nevada travel: hotel pet fees, trip plans, highway stops. [Install guide and example](https://dogpolicies.com/mcp/about/) · [Status](https://dogpolicies.com/status/)

DogPolicies answers dog-travel questions for California and Nevada, and every fact it returns carries its official source (an agency page or the business's own published policy) and the date it was checked; Nevada coverage is still thin. It does the work a web page cannot: the pet-fee arithmetic for a specific dog, day-by-day trip plans, highway stops in driving order with Caltrans conditions on I-5 right now, what changed since a date, and corrections a person checks.

**Listed in Claude's connector directory** since November 4, 2026: [add DogPolicies in Claude](https://claude.ai/directory/dogpolicies) with nothing to install. Also on npm and in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.xultrax-web/dogpolicies-mcp). DogPolicies is independent and not affiliated with Anthropic.

<!-- mcp-name: io.github.xultrax-web/dogpolicies-mcp -->

[![npm](https://img.shields.io/npm/v/dogpolicies-mcp)](https://www.npmjs.com/package/dogpolicies-mcp)
[![CI](https://github.com/xultrax-web/dogpolicies-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/xultrax-web/dogpolicies-mcp/actions/workflows/ci.yml)
[![license: MIT code, CC BY 4.0 data](https://img.shields.io/badge/license-MIT%20%2B%20CC%20BY%204.0-blue)](#license-and-attribution)
[![MCP 2026-07-28](https://img.shields.io/badge/MCP-2026--07--28-black)](https://modelcontextprotocol.io/specification/2026-07-28)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](#connect)

## Connect

The hosted server is `https://dogpolicies.com/mcp/`: Streamable HTTP, no key, no account, nothing to install.

- **Claude** (claude.ai or Claude Desktop): open [DogPolicies in Claude's connector directory](https://claude.ai/directory/dogpolicies), add it and turn it on in the chat's tools menu. By hand: Settings → Connectors → **Add custom connector**, name **DogPolicies**, URL `https://dogpolicies.com/mcp/`.
- **Claude Code:** `claude mcp add --transport http dogpolicies https://dogpolicies.com/mcp/`
- **Cursor and VS Code:** [![Add to Cursor](https://img.shields.io/badge/Cursor-Add_DogPolicies-000000?logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=dogpolicies&config=eyJ1cmwiOiJodHRwczovL2RvZ3BvbGljaWVzLmNvbS9tY3AvIn0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_DogPolicies-0098FF?logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22dogpolicies%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fdogpolicies.com%2Fmcp%2F%22%7D) Both add the hosted URL; the app asks you to confirm.
- **Any other client** that connects to a remote MCP server: give it the URL above.

To run it on your own machine over stdio instead (the data ships inside the package and works offline; Node.js 20.19 or newer):

```json
{
  "mcpServers": {
    "dogpolicies": { "command": "npx", "args": ["-y", "dogpolicies-mcp"] }
  }
}
```

On Windows write `"command": "cmd", "args": ["/c", "npx", "-y", "dogpolicies-mcp"]`, because clients start commands without a shell. Or let the installer write it:

```bash
npx dogpolicies-mcp install                      # Claude Desktop; --client cursor | vscode | windsurf | claude-code, or --all
npx dogpolicies-mcp install --hosted --dry-run   # the URL form instead, previewed without changing anything
claude mcp add dogpolicies -- npx -y dogpolicies-mcp   # Claude Code (Windows: -- cmd /c npx -y dogpolicies-mcp)
```

The installer finds the client's config on Windows, macOS and Linux, backs it up, merges one entry without touching other settings, refuses a file it cannot parse and prints the restart step. Claude Desktop also takes the one-click extension, `dogpolicies-mcp-<version>.mcpb`, from the [latest release](https://github.com/xultrax-web/dogpolicies-mcp/releases/latest). `npx dogpolicies-mcp --http --port 3737` serves Streamable HTTP at `http://127.0.0.1:3737/mcp`.

<details><summary>Config files, by hand</summary>

- Claude Desktop: Settings → Developer → Edit Config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), then fully quit and reopen it.
- Cursor: `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project; `{ "url": "https://dogpolicies.com/mcp/" }` for the hosted server.
- VS Code: `~/.copilot/mcp-config.json` with the same block, or `code --add-mcp '{"name":"dogpolicies","type":"stdio","command":"npx","args":["-y","dogpolicies-mcp"]}'`.
- Windsurf: `~/.codeium/windsurf/mcp_config.json`; `{ "serverUrl": "https://dogpolicies.com/mcp/" }` for the hosted server.

</details>

## What it does

The tools, by the job they do. Every one except `dogpolicies_report_correction` only reads.

### Fit and arithmetic

- `dogpolicies_find_hotels`: which hotels take this dog, by weight, number of dogs, nights and a pet-fee budget. Each hotel is a match, a possible (call to confirm) or excluded, with the arithmetic spelled out ("2 dogs x 3 nights x $25 per pet per night = $150, capped at $100 per stay = $100"). Amounts are pet fees, never room rates.
- `dogpolicies_plan_trip`: a whole stay in one call. Stays that fit, with the pet fee for every night worked out, then the plan day by day: the stay, a morning beach, trail or off-leash area, an afternoon park and a dinner patio, each a real record with its source and date; a slot the data cannot fill is left empty with the reason. `start_date` dates each day, `stay_id` builds the plan on a chosen stay, and `save: true` returns a `https://dogpolicies.com/trips/#v1.…` link that carries the whole plan inside the link, so nothing is stored. Near I-5 it adds the drive leg.
- `dogpolicies_get_brand_policy`: a hotel chain's published pet policy (Best Western, Extended Stay America, Kimpton, La Quinta, Motel 6, Red Roof), its listed exceptions and how many properties carry it.

### Routes and live state

- `dogpolicies_route_stops`: dog stops along a highway in driving order, each with its mile, side and distance off the road: I-5, US-101, Highway 1, I-15, I-80 and US-50 in California; I-15, I-80, US-50, US-95 and US-93 in Nevada. Rest areas with pet areas, travel stops with dog parks, hotels with the stay's pet fee, campgrounds, parks and beaches. On I-5 also family stops (restrooms and a pet area stated by the source) and paired exits.
- `dogpolicies_i5_corridor`: I-5 in California by named stretch (the Grapevine, the Westside, Shasta and the rest), a mile range or the next miles ahead of a point.
- `dogpolicies_i5_conditions`: Caltrans lane closures, chain controls, road weather and sign messages on I-5 right now, each placed on the road beside the nearest dog stop. Live state, not rules; it needs the network.

A rest area Caltrans reports closed right now carries `closed_now` (Caltrans' reason and end time) in `route_stops`, `i5_corridor` and `plan_trip`, and is never offered as the next stop.

- `dogpolicies_road_conditions`: Caltrans chain controls, lane and ramp closures, road weather and sign messages right now on I-80, US-50, I-15 and I-5 in California (Donner Summit, Echo Summit, Cajon Pass, the Grapevine), by route, town or named stretch, each at its route mile beside the nearest dog stop. Live state, not rules; Nevada roads are not covered; it needs the network.

### Change

- `dogpolicies_changes_since`: re-checks and rule changes since a date, newest first; on the hosted server also the corrections filed or decided since then, by ticket and status.
- `dogpolicies_changes_near`: the same around a town, region or point, for one place (`place_id`) or along a highway's stops (`route`, `from_mile`, `to_mile`), to re-check a trip before you go.
- `dogpolicies_subscribe_changes`: Atom and JSON Feed links that follow one place, a town or area, or a highway's stops for rule changes, with the last 90 days' counts and a sentence to hand to the traveler; it stores nothing and sends no email.

### Comparison and citation

- `dogpolicies_near`: everything dog-related near a town, neighborhood, region or airport, nearest first by kind; the usual first call. Names as people say them ("Van Nuys", "the Mission", "Lake Tahoe", "SFO", "LAX airport"); small spelling slips are corrected and labeled.
- `dogpolicies_search_places`: one named place, or a filtered list by type, county, region, area, dogs allowed or off leash. Free text such as "dog friendly hotels in Carmel" is read as the kind and the place.
- `dogpolicies_browse_answers`: ready-made answers to common questions ("Which California state parks allow dogs?").
- `dogpolicies_get_place`: one place in full: every fact with its source URL, publisher, quote and date checked, the rule ids, and what the source does not state.
- `dogpolicies_compare_places`: two to six places side by side (dogs allowed, leash, where dogs may go, pet fee, weight limit, pets per room), with a citation for each.
- `dogpolicies_get_rule`: one rule by its stable id, with the quote, source, confidence and verified date.

### Action

- `dogpolicies_report_correction`: files a correction for a person to check against the official source. The answer carries a ticket id and a public status page (`https://dogpolicies.com/corrections/status/<ticket>/`) that shows filed, then verified or rejected, with dates; what the traveler wrote is not shown. Nothing changes until it is verified. The only tool that writes.
- `dogpolicies_plan_trip` with `save: true`: a trip link to hand over (above).

## Every answer

- Starts with a citation sentence and ends with `DogPolicies, dogpolicies.com, CC BY 4.0, verified {date}`. Every record carries `confidence` (stated, inferred_from_agency, inherited_brand), `freshness` (fresh, due, stale, unreadable), `verified_at`, `url` and `source_urls`. A fact the source does not state is listed as not stated, never filled in.
- Plain words work as arguments: "hotel", "NB", "Motel 6" or "yes" are read as the value the schema wants and labeled `resolved_from`. An argument that still does not fit comes back as `outcome: "bad_input"` with what is accepted, not a protocol error; a question the data cannot answer is `no_match` with `did_you_mean`, `nearest` and `next`. `isError` means the server itself failed or refused a write (`rate_limited`).
- Markdown by default, structured JSON with `response_format: "json"`, and an output schema on every tool. The full reference, generated from the code: [docs/tools.md](docs/tools.md).
- Resources attach a record without a tool call: `dogpolicies://place/{id}`, `brand/{id}`, `answer/{slug}`, `route/{id}` and `area/{id}` (with completion), plus `dogpolicies://about`, `answers`, `status` and `corridor/i-5`. Prompts for the slash menu: `plan_dog_trip`, `check_hotel_for_dog`, `road_trip_with_dog`, `drive_i5_with_dog`, `what_can_my_dog_do_here`, `cite_a_rule`.

## Not using MCP?

The read-only tools are also plain GET operations at `https://dogpolicies.com/api/v1/ask/<operation>`, run by the same engine with the same answers. The operation is the tool name without `dogpolicies_`, with hyphens (`near`, `find-hotels`, `plan-trip`, `route-stops`); arguments go in the query string, a point as `near.lat=…&near.lon=…`. The OpenAPI 3.1 description: https://dogpolicies.com/api/v1/openapi.json

```bash
curl "https://dogpolicies.com/api/v1/ask/find-hotels?county=Monterey&dog_weight_lb=70&max_total_fee=50"
```

## Status and data

[dogpolicies.com/status](https://dogpolicies.com/status/) shows the hosted server's version and commit, the data date, the last re-check, open corrections and the call tally; `https://dogpolicies.com/api/v1/status.json` is the same as JSON. The package ships a dated snapshot (`as_of` in every result), serves it at once, then checks `https://dogpolicies.com/data/mcp-snapshot-v1.json` in the background and swaps in a newer one when it exists. `DOGPOLICIES_OFFLINE=1` (or `--offline`) never uses the network. All options: [docs/configuration.md](docs/configuration.md).

## Try it in the terminal

```bash
npx dogpolicies-mcp demo              # off-leash beaches near San Diego, with citations
npx dogpolicies-mcp demo "Monterey"   # hotels in Monterey for a 70 lb dog, 2 nights, fees worked out
npx dogpolicies-mcp check             # load the data and call every tool once
```

The `demo` output is the exact text an assistant receives:

```
- Coronado Dog Beach (Coronado, CA): Yes, with restrictions. Dogs may be off leash only on the
  designated Dog Beach area at 200 Ocean Boulevard and must be leashed at all points before
  reaching it. Source: City of Coronado, checked 2026-10-26. DogPolicies record:
  https://dogpolicies.com/places/coronado-dog-beach/ (CC BY 4.0; cite with link).
  `coronado-dog-beach` · Coronado, San Diego County, California · 3 mi · freshness fresh
```

## Troubleshooting

- **It does not show up.** Restart properly: fully quit Claude Desktop (tray icon or Claude menu → Quit; closing the window leaves it running); in Cursor toggle the server in Settings → MCP; in VS Code run MCP: List Servers → Start; in Windsurf press Refresh in the MCP panel.
- **Check the server itself.** `npx dogpolicies-mcp check` calls every tool; if it works, the problem is the client's config or restart. Logs: Claude Desktop `%APPDATA%\Claude\logs\mcp.log` and `mcp-server-dogpolicies.log` (Windows) or `~/Library/Logs/Claude/` (macOS); Cursor: Output → MCP Logs; VS Code: MCP: List Servers → Show Output; Claude Code: `claude mcp list`.
- **"spawn npx ENOENT" on Windows.** Use the `cmd /c npx` form above (the installer writes it) or the hosted URL.
- **Behind a proxy.** `npx` must reach registry.npmjs.org once (set `HTTPS_PROXY`); the hosted URL and the extension need no npm.
- **Still stuck?** Open an issue with the output of `npx dogpolicies-mcp check`, your OS and client: https://github.com/xultrax-web/dogpolicies-mcp/issues

## Privacy

- **Nothing is collected.** No telemetry, analytics or crash reporting; tool arguments are never logged above `debug` level (stderr, your terminal).
- **What leaves your machine** with the local package: one conditional GET for the data snapshot on start and, only when you file a correction, the text you typed plus an optional contact you chose to give. Both go to dogpolicies.com over https and nowhere else; `--offline` stops both. The hosted server counts calls by tool and client name, never questions or addresses. Threat model and controls: [docs/security.md](docs/security.md).

## License and attribution

- **Code:** MIT.
- **Data:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribute "DogPolicies" with a link to https://dogpolicies.com/ and cite each record with its URL and verified date; every result includes a ready-made citation line. Chain-hotel names and locations come from OpenStreetMap under the [ODbL](https://www.openstreetmap.org/copyright) and say so in `record_license`.
- The rules are a sourced, dated summary, not legal advice. Confirm with the agency or the business before you go, especially when a record says `stale`, `unreadable` or `inherited_brand`. Service animals are governed by the ADA, not these pet rules. Terms: https://dogpolicies.com/terms/

## For developers

```js
import { createRuntime, connectInProcess } from "dogpolicies-mcp";

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

Tests: `npm test` runs unit, contract, security, performance, surface, eval and fuzz tests; `npm run test:e2e` packs the tarball and runs it over stdio. CI runs on Linux, macOS and Windows with Node 20, 22 and 24.
