# Configuration

No configuration is needed. Everything below is optional.

## Command line

```
dogpolicies-mcp                      stdio (the default for AI clients)
dogpolicies-mcp --http [--port N] [--host H]   Streamable HTTP on localhost (default 3737, 127.0.0.1)
dogpolicies-mcp demo [town]          one cited answer in the terminal
dogpolicies-mcp check                load the data and call every tool once
dogpolicies-mcp --offline            never use the network
dogpolicies-mcp --base-url <url>     the site to refresh from and file corrections to
dogpolicies-mcp --log <level>        silent | error | warn | info | debug
dogpolicies-mcp --version | --help
```

## Environment

| Variable                | Default                   | Meaning                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DOGPOLICIES_OFFLINE`   | unset                     | `1`: no network at all. Data stays as bundled; corrections return the record's web form URL instead of being sent.                                                                                                                                                 |
| `DOGPOLICIES_BASE_URL`  | `https://dogpolicies.com` | Where the newest snapshot is fetched from (`/data/mcp-snapshot-v1.json`) and corrections are posted (`/corrections/submit`). Must be https to `dogpolicies.com` or `www.dogpolicies.com`, or http(s) to localhost for development. Anything else refuses to start. |
| `DOGPOLICIES_LOG`       | `info`                    | Log level on stderr. Tool arguments are never logged above `debug`.                                                                                                                                                                                                |
| `DOGPOLICIES_CACHE_DIR` | OS cache dir              | Where a refreshed snapshot is kept between runs (`%LOCALAPPDATA%\dogpolicies-mcp`, `~/Library/Caches/dogpolicies-mcp`, `~/.cache/dogpolicies-mcp`).                                                                                                                |
| `DOGPOLICIES_SNAPSHOT`  | bundled file              | Path to a snapshot file (`.json` or `.json.gz`) to serve instead, for development.                                                                                                                                                                                 |
| `DOGPOLICIES_TODAY`     | today (Pacific)           | Pin the date (`YYYY-MM-DD`) so freshness is reproducible, for tests.                                                                                                                                                                                               |

## How the data refresh behaves

On start the server serves the bundled snapshot at once, then in the
background does one conditional GET of the hosted snapshot (ETag, 5 s
timeout, two short retries only on transient errors, 64 MB cap). A newer,
valid snapshot is swapped in and cached; anything else is ignored and logged
at `debug`. Until the site is deployed at dogpolicies.com the request fails
fast and silently; the bundled data is complete on its own.

## Client configuration

See the README for Claude Code, Claude Desktop, Cursor and VS Code. To pass
an option, add it to `args`, for example `["-y", "dogpolicies-mcp", "--offline"]`,
or set the variable in the client's `env` block.
