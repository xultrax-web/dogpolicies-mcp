# Changelog

All notable changes to `dogpolicies-mcp`. The package follows semantic
versioning as described in `docs/versioning.md`: tool names, input fields
and output fields are only ever added in a minor release; a removal waits
for a major release and is announced one minor ahead with a deprecation
note in the tool's description.

The data inside the package has its own date (`as_of` in every result). A
new package version ships a new snapshot; the server also refreshes from the
site on its own when the network allows.

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
