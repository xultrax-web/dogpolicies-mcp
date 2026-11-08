# Changelog

All notable changes to `dogpolicies-mcp`. The package follows semantic
versioning as described in `docs/versioning.md`: tool names, input fields
and output fields are only ever added in a minor release; a removal waits
for a major release and is announced one minor ahead with a deprecation
note in the tool's description.

The data inside the package has its own date (`as_of` in every result). A
new package version ships a new snapshot; the server also refreshes from the
site on its own when the network allows.

## 0.4.1 - 2026-11-08

The first roadmap release (`docs/ROADMAP.md` in the data repository: R-01,
R-02, R-03). The misses log and the directory's numbers said where the first
week leaked; this closes those leaks.

Added

- Forty-eight more neighborhoods as search centers for `dogpolicies_near`,
  `dogpolicies_plan_trip` and every tool that takes a place: the rest of the
  San Fernando Valley and the Westside, Koreatown, Downtown Los Angeles, Echo
  Park, Los Feliz, Highland Park, San Francisco's districts (the Mission, the
  Castro, Noe Valley, the Marina, the Richmond and Sunset districts,
  Haight-Ashbury, SoMa, North Beach and more), Rockridge and Temescal, Midtown
  Sacramento, Willow Glen, La Jolla, Pacific Beach, Mission Beach, Hillcrest,
  North Park, Point Loma, the Gaslamp Quarter, the Las Vegas Strip, Summerlin
  and Downtown Las Vegas; and the names people say for them ("Venice Beach",
  "DTLA", "K-town", "the Mission", "SoMa", "the Strip", "Fremont Street").
- `createServer(ctx, { build })`: an optional build id, reported after the
  package version as semver build metadata (`0.4.1+6a974ec`). The hosted
  server sets it to the deployed commit so a deploy can recognize its own code;
  the stdio server reports the bare version as before.

Hosted server (dogpolicies.com/mcp/)

- A POST whose `Accept` header lists only `application/json`, or nothing, is
  answered instead of refused with 406; a CORS preflight is answered; a person
  who opens the address in a browser sees how to connect instead of a 405.
- After `initialize` the server hands out an `mcp-session-id` that carries the
  client's own name and version as a label (no state behind it; the transport
  stays stateless), so the usage tally names clients on every protocol
  version, not only the newest. A request without one is named by a
  User-Agent that identifies an assistant.

## 0.4.0 - 2026-11-07

Answers, not errors. A question the data cannot answer now comes back as a
normal answer that says so and helps, never as a dead end, and `isError` is
reserved for the server itself failing. Directories that score a server by
its `isError` rate (Claude's does) had been counting "Van Nuys is not a town
we cover" against us; what they count now is what a person would call an
error.

Changed

- `not_found`, `invalid`, `unavailable` and `offline` results are no longer
  `isError`. They are answers with `outcome` (`no_match`, `bad_input`,
  `partial` or `unavailable`), `code`, `message`, and whichever of
  `did_you_mean` (close matches: towns, places, slugs, brands), `nearest` (the
  nearest records anyway, with distance), `missing` and `next` (what to call)
  apply. Every such answer still satisfies the tool's output schema: list
  fields are empty, counts are zero, and a field with nothing honest to hold
  is `null` (`near.center`, `get_rule.rule` and `.place`,
  `i5_conditions.fetched_at`, `get_place.freshness` in a no-match answer).
  A client that branched on `isError` for these codes should read `outcome`.
  `isError` remains for `internal` and `rate_limited`.
- `dogpolicies_near` widens its radius on its own (30, 60, then 100 miles,
  reported as `radius_widened_from`) when nothing sits inside the one asked
  for, and when the data has nothing within 100 miles it lists the five
  nearest records and the nearest towns with records.
- `dogpolicies_get_place` and `dogpolicies_compare_places` resolve a near
  miss (a misspelled id, a name a word off) to the one clear match, labeled
  `resolved_from`; `compare_places` compares what it found and lists the
  rest under `missing` (`outcome: partial`).
- `dogpolicies_get_rule` with a rule id whose place exists but has no such
  rule answers with that place and its recorded rule ids.
- `dogpolicies_browse_answers` with an unknown slug answers with the closest
  slugs and the whole list; `dogpolicies_get_brand_policy` with an unknown
  brand lists the covered brands nearest in spelling and how to check that
  chain's hotels one by one.
- `dogpolicies_report_correction` with an unknown place answers
  `bad_input` with close matches and files nothing; an unreachable inbox is
  `unavailable` with the form's address.
- `dogpolicies_i5_conditions` reads the conditions document in-process on
  the hosted server (it had been answering `offline` there since 0.3.0), marks
  a reading older than two hours `stale`, and when no document can be read
  answers `unavailable` with the live page's address. A point too far from
  I-5 (also in `dogpolicies_i5_corridor`) answers `bad_input` with
  `nearest_i5`: the nearest mile and how far it is.
- Numeric inputs accept numbers written as strings; `dogs` up to 10, `nights`
  up to 90, `dog_weight_lb` up to 300, `max_total_fee` up to 10,000.
- The server instructions tell the model there are no dead ends and how to
  use `outcome`, `did_you_mean`, `nearest` and `next`.

Fixed

- On I-5, `dogpolicies_route_stops`, `dogpolicies_i5_corridor` and the
  drive leg of `dogpolicies_plan_trip` left out every park, hotel, campground
  and patio on the far bank of the freeway: 195 of 422 stops northbound, 199
  southbound (since 0.3.0). The geometric side of the road is now wording
  only; a stop is one-way only when Caltrans lists it for one direction (a
  rest area).
- The site's in-process server (`npm run preview`, stdio) now carries the
  I-5 axis like the hosted Worker, so the three servers answer alike.

Added

- Output fields on every tool: `outcome`, `code`, `message`, `did_you_mean`,
  `nearest`, `next` (all optional); `near.radius_widened_from` and `.nearest`;
  `get_place.resolved_from`; `compare_places.missing`;
  `i5_conditions.stale` and `.nearest_i5`; `i5_corridor.nearest_i5`;
  `report_correction.form_url`.

## 0.3.0 - 2026-11-04

The I-5 axis: every I-5 stop in California carries its position on the I-5
centerline (s meters from San Ysidro, the same number the corridor JSON and
the simulator use) beside its Caltrans mile.

Added

- `dogpolicies_route_stops`: `ahead_miles` (a window from the start in the
  direction of travel), `family` (only stops whose official source states
  restrooms and a pet area or dog park) and `paired` (exits with people-stops
  nearby, counted from OpenStreetMap and never named, matched to the nearest
  dog-legal place). On I-5 every stop returns `s_m`, `miles_ahead`, `side`,
  `off_miles`, `elevation_m`, `strip`, `restrooms`, `water`, `pet_area`,
  `dog_park`, `hours` (with its source) and `family_stop`.
- `dogpolicies_i5_corridor`: the eleven stretches of I-5 in California with
  their s and mile ranges, and the stops in a stretch, a mile range or a
  window ahead of a point.
- `dogpolicies_i5_conditions`: Caltrans lane closures, road-weather readings,
  message-sign text and chain-control status on I-5, fetched within the last
  15 minutes and placed on the axis; conditions, not rules. Needs the network.
- `dogpolicies_get_place` returns `axis` and, for the dog side of a pairing,
  `paired_stop`. `dogpolicies_plan_trip` returns `i5` (the drive leg's family
  stops and paired stops) when the town is within 10 miles of I-5.
- Resource `dogpolicies://corridor/i-5`; prompt `drive_i5_with_dog`.
- The `hours` fact, in the source's own words.
- The snapshot carries the I-5 calibration table, strips and paired stops.

## 0.2.10 - 2026-11-04

- Listed in Claude's connector directory: the README and the install guide
  link the listing, with adding it by URL kept as the alternative.
- Tool servers take an `onToolResult` hook (tool name, arguments, result and
  time) after each call, beside `onToolCall`; the hosted server uses it to
  count failures by code and names asked for that are not in the data.
- Fresh data snapshot.

## 0.2.9 - 2026-11-01

Data release: the snapshot now carries data round 5.

Changed

- 4,192 places, up from 4,146: Madera and Turlock now have full town
  coverage, plus Hanford dog parks and Stanislaus County community parks
  (Modesto, Keyes, Salida). Two Santa Clara County dog parks now cite
  readable official sources.
- The site serves the refresh snapshot compressed (same URL, same JSON);
  nothing changes for clients.

## 0.2.8 - 2026-11-01

Data release: the snapshot now carries data round 4.

Changed

- 4,146 places, up from 3,484: 662 newly verified places. New coverage
  includes the Central Valley (Stockton, Lodi, Modesto, Turlock), the North
  State (Chico, Redding area, Eureka, Arcata, Fort Bragg), Bay Area towns
  (Hayward, Concord, Napa, Dublin, Cupertino), Southern California towns
  (Pasadena, Thousand Oaks, Camarillo, Santa Clarita, Murrieta), the San
  Diego coast (Coronado, Carlsbad, Encinitas, Solana Beach), the Central
  Coast (San Luis Obispo, Pismo Beach, Cambria, Hollister), the Eastern
  Sierra and Nevada (Mammoth Lakes, Bishop, Mesquite), plus 42 cemeteries,
  87 winery tasting rooms and 5 California missions.

## 0.2.7 - 2026-11-01

Data release: the snapshot now carries data round 3.

Changed

- 3,484 places, up from 2,669: 815 newly verified parks, dog parks, trails,
  beaches, hotels, wineries and restaurants. New coverage includes Las Vegas,
  Reno and Sparks, Orange County, Santa Barbara, Santa Cruz, Mill Valley and
  Marin, Golden Gate National Recreation Area, San Bernardino and Inyo
  National Forest trails, Yosemite and Sequoia, Fresno and Sacramento.

## 0.2.6 - 2026-11-01

Data release: the snapshot now carries data round 2.

Changed

- 2,669 places, up from 2,534: 135 newly verified parks, dog parks, trails,
  beaches, hotels and restaurants, among them Sonoma County parks,
  Midpeninsula preserves, Truckee, Healdsburg, Big Sur, June Lake, Morro Bay
  and Palm Springs.

## 0.2.5 - 2026-11-01

The install experience, after a hand install into Claude Desktop on Windows
needed finding the config file, adding a missing `mcpServers` key, merging,
backing up and a full quit from the tray.

Added

- `npx dogpolicies-mcp install` with `--client claude-desktop | cursor |
vscode | windsurf | claude-code`, `--all`, `--hosted`, `--dry-run` and
  `--uninstall`: finds the client's config on Windows, macOS and Linux,
  creates the file or the `mcpServers` key when missing, merges one entry
  without touching other settings, writes a timestamped backup, is
  idempotent, refuses (and explains) a file it cannot parse, needs no admin
  rights, and prints the exact restart step and log location. On Windows it
  writes `cmd /c npx -y dogpolicies-mcp`, the form clients can start.
  Claude Code goes through the official `claude mcp add`.
- A one-click Claude Desktop extension (`dogpolicies-mcp-<version>.mcpb`,
  official MCPB format, manifest 0.3, built with the official CLI) attached
  to every GitHub release by the publish workflow. `npm run mcpb` builds it.
- Add to Cursor and Install in VS Code buttons (hosted server), and an
  install order that puts the no-install connector first.
- A troubleshooting section: restarting properly, `check`, where each
  client's logs are, Node version, the Windows npx note, corporate proxies.

## 0.2.4 - 2026-10-31

- The registry listing names the hosted server, https://dogpolicies.com/mcp/, now that the site is live on Cloudflare.

- Bundler-friendly for other runtimes: `package.json` is read with a static JSON import and the bundled snapshot
  path is only resolved when `import.meta.url` exists. No change for npm users; the site's Cloudflare Worker now
  runs this package inside a Durable Object.

## 0.2.3 - 2026-10-31

- Smaller, cleaner install: the MCP client SDK is no longer a dependency. `demo`, `check` and `connectInProcess` use a small built-in client over the in-memory transport. The client SDK pulled in process-spawning and other code a server never runs, which supply-chain scanners flag.

## 0.2.2 - 2026-10-31

- Tests run on Node 20 again: `npm test` builds the file list itself instead of relying on `node --test` glob support (Node 22+). No change to the server.

## 0.2.1 - 2026-10-31

- Fix: `@modelcontextprotocol/client` is a runtime dependency (the CLI's demo and check commands and the in-process connector import it). 0.2.0 failed to start when installed from npm.
- A test now checks that every package the shipped code imports is listed in `dependencies`.

## 0.2.0 - 2026-10-31

Renamed from `dogrulebook-mcp` (never published) to `dogpolicies-mcp`; the
brand is DogPolicies, tool names start with `dogpolicies_`, environment
variables with `DOGPOLICIES_`.

Added

- Four tools: `dogpolicies_near` (everything near a town or point, grouped
  by kind), `dogpolicies_plan_trip` (stays that fit the dog plus outings
  and patios, one call), `dogpolicies_compare_places` (side-by-side table),
  `dogpolicies_changes_near` (events within a radius).
- A town gazetteer so tools take "Monterey" or "Washoe County, NV" instead
  of coordinates.
- The `restaurant` place type (dogs on the patio, by the owner's published
  policy) in search and route stops.
- Resources: `dogpolicies://about`, `dogpolicies://status`,
  `dogpolicies://answers`, and templates for place, brand, answer and route
  with completion.
- Prompts with argument completion: `plan_dog_trip`,
  `check_hotel_for_dog`, `road_trip_with_dog`, `what_can_my_dog_do_here`,
  `cite_a_rule`.
- Cache hints on list methods and resource reads (MCP 2026-07-28).
- Areas (Region > Area > City > Place): `area` and `area_id` on every
  place, an `area` filter on search, hotels and route tools, area names in
  the gazetteer so `near`, `plan_trip` and `changes_near` take "East Bay" or
  "Lake Tahoe" (an area is its own boundary, not a radius), a
  `dogpolicies://area/{id}` resource with completion, and area questions in
  the eval set.
- The hosted server at dogpolicies.com/mcp/ is this package running over the
  site's own data (same thirteen tools, resources and prompts); it keeps the
  old `dogrulebook_*` tool names as aliases.
- An eval set of 33 real questions scored for tool selection and answer
  facts, a fuzz test, a CI matrix (Linux, macOS, Windows × Node 20, 22,
  24), a dependency audit, a generated tool reference (`docs/tools.md`),
  a threat model (`docs/security.md`) and a versioning policy.
- Release from a public repository with npm trusted publishing and
  provenance; a sync script exports the package from the private data
  repository and refuses on any private leak.

Changed

- The attribution line on every result is now exactly
  `DogPolicies, dogpolicies.com, CC BY 4.0, verified {date}`.
- Network: refresh and corrections go to `https://dogpolicies.com` by
  default; until the site is deployed there the refresh fails fast and
  silently. The base URL must be our domain or localhost.
- The fetch timeout is 5 s (was 8 s).

## 0.1.0 - not published

First build, as `dogrulebook-mcp`.

- Nine tools: search_places, get_place, find_hotels, get_brand_policy,
  browse_answers, route_stops, get_rule, changes_since and
  report_correction.
- Bundled, dated data snapshot: works offline and on first run with no
  configuration; refreshes from the site in the background and caches the
  newer copy.
- stdio by default; `--http` serves Streamable HTTP on localhost.
- `demo` and `check` commands for the terminal.
- No telemetry.
