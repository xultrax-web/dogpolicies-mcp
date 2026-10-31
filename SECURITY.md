# Security

## Reporting a vulnerability

Email security@dogpolicies.com, or open a private security advisory on
GitHub (Security → Report a vulnerability). Please do not open a public issue
for a vulnerability. We aim to acknowledge within 3 business days and to fix
or publish guidance within 30 days.

Until the mailbox is live, use the GitHub advisory form.

## What this package does and does not do

- Runs locally with no credentials. It never asks for, stores or sends a key.
- Makes no network calls by default. With `DOGPOLICIES_BASE_URL` set, it
  makes two kinds of calls, both to that one host over https: a conditional
  GET for the data snapshot, and a POST of a correction the user chose to
  file. Nothing else, ever. No telemetry.
- Treats quoted source text as data: it is labeled and indented in every
  result, and the server instructions tell the model not to follow it.
- Validates every input against a strict schema; unknown fields are
  rejected. Ids are checked before any lookup; the configured base URL must
  be https to a public host (or localhost for development); cache files
  cannot escape the cache directory; the local HTTP server refuses foreign
  `Host` and `Origin` headers.

The threat model, with what is in and out of scope, is in
`docs/security.md`.

## Supported versions

The latest minor release receives fixes. Older versions: upgrade.
