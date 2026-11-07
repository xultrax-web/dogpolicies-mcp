# Versioning and deprecation policy

## The package

Semantic versioning, strictly:

- **Patch** (0.2.1): a newer data snapshot, a bug fix, a wording change in a
  description, a documentation change.
- **Minor** (0.3.0): a new tool, resource, prompt, input field or output
  field; a new optional behavior. Nothing existing changes meaning.
- **Major** (1.0.0): a tool, field or URI removed or renamed; a field's
  meaning or type changed; a default changed in a way a client would
  notice; a Node version dropped.

Until 1.0, the same rules apply (we treat 0.x minors as majors would be
treated elsewhere, so nothing breaks in a 0.x minor either).

## What a client may rely on

- Tool names, their input fields and required inputs, their annotations.
- Output fields named in each tool's `outputSchema`, and the shape of the
  envelope (`as_of`, `license`, `attribution_text`, `attribution_url`,
  `total`, `count`, `offset`, `has_more`, `next_offset`).
- Outcomes and codes: an answer's `outcome` (`ok`, `partial`, `no_match`,
  `bad_input`, `unavailable`) and `code` (`not_found`, `invalid`,
  `unavailable`); the error codes `internal` and `rate_limited`, the only
  ones that set `isError` (since 0.4.0).
- Resource URIs and prompt names.
- The first line of every markdown result being a citation and the last the
  attribution line.

All of that is recorded in `test/contracts/tools.json` and enforced by
`test/contracts.test.mjs`: a removal fails the build until the file is
regenerated on purpose (`node scripts/contracts.mjs`) in a major release
whose CHANGELOG entry explains it.

## Deprecating a tool or field

1. Set `deprecated: "Use X instead"` on the tool definition. The server
   prefixes its description with `DEPRECATED:`; the tool keeps working.
2. Say so in CHANGELOG.md under the minor release that deprecates it.
3. Keep it for at least one minor release and 90 days.
4. Remove it in the next major; regenerate the contract file; say so in
   CHANGELOG.md with the replacement.

Fields follow the same path: keep returning them, note the replacement in
the field's description, remove in a major.

## The data

Every result carries `as_of`, the date the snapshot was built. The snapshot
format has its own integer `schema`; a change that removes or redefines a
field bumps it, the validator refuses any other value, and the hosted file
path carries the version (`/data/mcp-snapshot-v1.json`), so an old package
never misreads a new file.

## The protocol

The package follows the official SDK (`@modelcontextprotocol/server` 2.x),
which serves the current MCP revision (2026-07-28) and the handshake-based
revisions before it. A protocol revision that drops something we use is a
major release of this package.

## Node

Supported: 20.19 and newer (tested on 20, 22 and 24 across Linux, macOS and
Windows). Dropping a version is a major release.
