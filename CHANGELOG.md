# Changelog

All notable changes to `dogrulebook-mcp`. The package follows semantic
versioning: tool names, input fields and output fields are only ever added in
a minor release; a removal or a change of meaning waits for a major release
and is announced one minor ahead with a deprecation note in the tool's
description.

The data inside the package has its own date (`as_of` in every result). A new
package version ships a new snapshot; the server also refreshes from the site
on its own when the network allows.

## 0.1.0 - unreleased

First release.

- Nine tools: `dogrulebook_search_places`, `dogrulebook_get_place`,
  `dogrulebook_find_hotels`, `dogrulebook_get_brand_policy`,
  `dogrulebook_browse_answers`, `dogrulebook_route_stops`,
  `dogrulebook_get_rule`, `dogrulebook_changes_since` and
  `dogrulebook_report_correction`.
- Bundled, dated data snapshot: works offline and on first run with no
  configuration; refreshes from dogrulebook.com in the background and caches
  the newer copy.
- stdio by default; `--http` serves Streamable HTTP on localhost.
- `demo` and `check` commands for the terminal.
- No telemetry.
