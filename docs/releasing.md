# Releasing

How a version of `dogpolicies-mcp` reaches npm and the MCP Registry. The
data snapshot is built in the private data repository and synced here; the
release itself happens from this public repository, so npm provenance,
trusted publishing and the directories all point at code anyone can read.

## Where things live

|                                     | Private data repository (`xultrax-web/dogpolicies`, `packages/mcp`) | This repository (`xultrax-web/dogpolicies-mcp`) |
| ----------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Source of truth for the server code | yes                                                                 | mirror, one commit per sync                     |
| Data snapshot                       | built by `scripts/build.mjs` from the data                          | shipped prebuilt in `data/snapshot.json.gz`     |
| Tests                               | run                                                                 | run (CI matrix)                                 |
| Publishing to npm                   | never                                                               | tag `vX.Y.Z` → `.github/workflows/publish.yml`  |
| MCP Registry                        | never                                                               | `mcp-publisher publish` from the root           |

`scripts/build.mjs` and `scripts/sync-public.mjs` are maintainer-only; run
from this repository they print a message and exit 0.

## One-time setup (Wes)

1. npm account with 2FA ("Authorization and publishing").
2. First publish from a terminal (below), then on npmjs.com → package →
   Settings → Trusted Publisher → GitHub Actions: organization
   `xultrax-web`, repository `dogpolicies-mcp`, workflow `publish.yml`;
   allow `npm publish`. Then Publishing access → "Require two-factor
   authentication and disallow tokens". Provenance is automatic because the
   repository is public.
   Fallback until then: a granular `NPM_TOKEN` (publish rights on this
   package only) as a repository secret; the workflow reads it.
3. Protect the `v*` tags in GitHub (Settings → Tags).
4. Install `mcp-publisher` (`brew install mcp-publisher`, or the Windows
   release binary from github.com/modelcontextprotocol/registry/releases).

## Every release

In the private data repository:

```powershell
cd <the private data repository>
git checkout main; git pull
node packages\mcp\scripts\build.mjs          # fresh snapshot + vendored matcher
cd packages\mcp
# bump "version" in package.json and both version fields in server.json;
# turn "## X.Y.Z - unreleased" in CHANGELOG.md into the date
node scripts\contracts.mjs; node scripts\docs.mjs
npm test; npm run test:e2e; npm run check
cd ..\..; git add -A; git commit -m "Release dogpolicies-mcp X.Y.Z"; git push
node packages\mcp\scripts\sync-public.mjs --push     # refuses on any private leak
```

In this repository:

```powershell
cd <this repository>
git pull
git tag vX.Y.Z; git push origin vX.Y.Z              # CI tests, then publishes
mcp-publisher validate
mcp-publisher login github                           # device code
mcp-publisher publish                                # registry metadata
```

Check: https://www.npmjs.com/package/dogpolicies-mcp shows the version and
the provenance badge; `npx -y dogpolicies-mcp@latest demo` answers;
`curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.xultrax-web/dogpolicies-mcp"`
lists it.

## First publish (manual, once)

```powershell
cd <this repository>
npm ci; npm test; npm run test:e2e
npm pack --dry-run                 # file list and size
npm login                          # browser, 2FA
npm publish --access public        # prepack checks refuse stale contents
```

## Rollback

`npm deprecate dogpolicies-mcp@X.Y.Z "Use X.Y.Z+1"`; `npm unpublish` only
within 72 hours. `mcp-publisher status` can mark a registry version
deprecated.
