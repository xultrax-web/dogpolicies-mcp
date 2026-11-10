# Changelog

All notable changes to `dogpolicies-mcp`. The package follows semantic
versioning as described in `docs/versioning.md`: tool names, input fields
and output fields are only ever added in a minor release; a removal waits
for a major release and is announced one minor ahead with a deprecation
note in the tool's description.

The data inside the package has its own date (`as_of` in every result). A
new package version ships a new snapshot; the server also refreshes from the
site on its own when the network allows.

## 0.5.1 - 2026-11-10

The connector icon is the close-up face of the homepage dog on its dark-green tile, the same picture as the
website's app icon and the Claude directory listing. One icon replaces the light and dark transparent heads; it carries
its own background. No tool, input or output changed (decision 127).

## 0.5.0 - 2026-11-10

The Thanksgiving release (`docs/ROADMAP.md` in the data repository: R-04, R-05, R-11 to R-15, R-26, and slices of
R-20 and R-21). Plans an assistant can hand over, answers instead of refusals for the words people use, and the I-5
drive for the holiday.

Added

- `dogpolicies_plan_trip` returns the plan itself: `days` (for each night the stay, a morning beach, trail or
  off-leash area, an afternoon park and a dinner patio, each a record with its rule, quote, source and verified date;
  a slot the data cannot fill is null with the reason), `plan_stay` (the pet fee per night and in total with the
  arithmetic, and whether the dog's weight and number fit), `plan_notes`, and with `save: true` a `trip_url` to a
  page on dogpolicies.com that carries the whole plan in the link (nothing is stored). New inputs `start_date`,
  `stay_id` and `save`.
- `dogpolicies_report_correction` answers with a public `ticket` and a `status_url`, and takes an optional `fact`
  (which kind of fact is wrong). The ticket's status (filed, then verified or rejected) is public; what the reporter
  wrote is not.
- `dogpolicies_changes_since` and `dogpolicies_changes_near` add `corrections`, `corrections_total` and
  `corrections_note` (live on the hosted server; the stdio server answers an empty list with a note). Both are no
  longer memoized.
- `dogpolicies_route_stops` and `dogpolicies_i5_corridor`: an I-5 rest area Caltrans reports fully closed carries
  `closed_now` (reason, until, source, fetched_at), and the text names the first open stop.
  `dogpolicies_plan_trip`'s I-5 leg skips closed rest areas and lists them as `closed_now_stops`.
- Airports as places: eighteen California and Nevada airports resolve by code, "<code> airport", name and common
  names in `near`, `plan_trip`, `changes_near` and a `find_hotels` query, with a 5-mile default radius.
- `resolved_from` on any answer where a word was read as a canonical value ("hotel" as lodging, "NB" as north), and
  `query_read` and `matched_terms` on `dogpolicies_search_places`.
- `dogpolicies_road_conditions`: chain controls, closures, road weather and sign text right now on I-80, US-50, I-15
  or I-5 in California, by route, mile range, town or named stretch, with the nearest dog stop. Caltrans feed data,
  not rules; stale after two hours, `unavailable` without a document.
- `dogpolicies_subscribe_changes`: Atom and JSON Feed links that follow a place, a town or a highway's stops for rule
  changes, with 90-day counts and a sentence to hand over; nothing is stored. `dogpolicies_changes_near` takes
  `place_id`, `route`, `from_mile` and `to_mile`, and adds `rule_changes`, `scope_kind` and `page_url`.
- `today` on place answers for places with seasonal rules (plover seasons, summer beach hours): what applies on the
  server's date, until when, what starts within 14 days, with the source; while a seasonal rule applies it leads
  `answer` and `citation`.
- `createRestApi`, `restOpenApi`, `operationSlug`, `parseQuery` and `wrapToolHandler`: the read-only tools as HTTP
  operations with their OpenAPI 3.1 fragment, generated from the tool schemas, through the same wrapper every tool
  call uses. `trustSnapshot`: an optional trusted-snapshot path for hosts that build their own data.

Changed

- Tool descriptions and the server instructions are rewritten around the question a traveler asks, when to call
  each tool and when not to, the accepted input forms and what the answer carries; the prompts and the `about`
  resource follow. Names and schemas are unchanged.
- Tools accept natural words for enums, booleans, lists, routes, brands, areas, points and dates. Arguments that
  still fail the schema return `outcome: "bad_input"` with the `accepted` values instead of a protocol error. A
  `limit` above the maximum is capped.
- `dogpolicies_search_places` reads a free-text query ("dog friendly hotels in Carmel") as kind words plus a place,
  and falls back to a labeled partial match. `type` also accepts `rest_area` and `stop`.
- `dogpolicies_i5_conditions`: when the live read fails, it answers from the last reading, marked stale with its
  age; `unavailable` only when there has never been one.
- A town name with hyphens ("Carmel-by-the-Sea") resolves.
- Text queries in `find_hotels` and `search_places` match words from their start: "Reno" no longer finds Moreno
  Valley, while "carm" still finds Carmel.
- Answers that read live data (`route_stops`, `i5_corridor`, `plan_trip`) are cached five minutes (`cacheTtlMs`).
- A place outside California and Nevada answers `no_match` with code `out_of_coverage`, naming it, with the closest
  covered towns near the state line; off-topic questions (flights, car rentals, weather) answer code `off_topic` with
  two example questions.
- `changes_since` and `changes_near`: the corrections read has a two-second deadline.
- Closures: an end time no date can hold reads "end not set" instead of failing the call.
- Prompt argument completion offers "Carson City, NV", never "Carson City County, NV".
- A correction for a place the data does not hold gets no public ticket.

Hosted server (dogpolicies.com/mcp/)

- Answers no longer wait for the usage tally; a cold start skips a full snapshot validation. Per-tool latency (p50
  and p95 from fixed buckets) is in the private operations summary.
- The read-only tools are also GET operations at `/api/v1/ask/<operation>`, described in `/api/v1/openapi.json`.
- `/status/` and `/api/v1/status.json`: the deployed version and commit, the data date, the I-5 conditions age, the
  last re-check, open corrections and the 7-day call tally. The `about` resource links them.
- Correction tickets at `/corrections/status/<ticket>/` and `/api/v1/corrections.json`.
- Requests with `?probe=desk-eval` count as our own test traffic.
- The door: a wildcard, missing or other-case `Accept` gets the full one (was 406); a JSON body sent as `text/plain`,
  with no Content-Type or as `application/json-rpc` is answered (was 415); a client that accepts only JSON gets
  `application/json`; `DELETE /mcp/` (a client ending its session) is a 204 (was 405).
- Rate limits: Anthropic's published outbound addresses get their own, larger allowance, so Claude users behind the
  proxy no longer share one; a 429 echoes the request id.
- A call in flight when the engine's Durable Object resets is retried once; a failure is a JSON-RPC 503 with CORS.
- Change feeds at `/feeds/changes/place|near|route/<scope>.atom` and `.json`, computed per request.
- Conditions documents for I-80, US-50 and I-15 beside I-5 (`/api/v1/conditions/<route>.json`), from one pass over
  the Caltrans district feeds.

Data in this release: four I-5 answer pages for the Thanksgiving drive, four for I-15, I-80 and US-50, an airport
pet relief areas page, and new verified records (I-5 dog parks, independent I-5 hotels, airport relief areas,
restaurants that welcome dogs on the patio).

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
  facts, a fuzz test, a CI matrix (Linux, macOS, Windows Ã— Node 20, 22,
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
