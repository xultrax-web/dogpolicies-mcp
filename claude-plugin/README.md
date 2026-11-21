# DogPolicies for Claude

A Claude plugin that bundles the DogPolicies connector with one skill, `dog-travel`, which tells Claude when to use
DogPolicies and which of its 18 tools answers which question.

DogPolicies answers dog and pet travel questions for California and Nevada: whether a park, beach, trail, campground,
hotel or patio allows dogs, pet fees and weight limits, hotels for a dog of a given size, dog stops on I-5, I-80,
US-50, I-15 and US-395, chain controls and closures on those roads, the nearest emergency vet on a drive, and trip
plans. Every answer carries its official source, the quote and the date it was checked, with a link to the record on
dogpolicies.com. It is not for service-animal law, places outside California and Nevada, or live room rates and
booking.

## What is in the plugin

```
claude-plugin/
  .claude-plugin/plugin.json     manifest (name, version, listing links, icon)
  .mcp.json                      the connector: https://dogpolicies.com/mcp/ (http, no sign-in, no credentials)
  skills/dog-travel/SKILL.md     when to use DogPolicies, when not to, which tool, how to cite, trip card and link
  assets/                        the listing icon (named in plugin.json)
  LICENSE                        MIT
  README.md                      this file
```

The connector URL is the remote in `packages/mcp/server.json`. `packages/mcp/test/claude-plugin.test.mjs` fails if the
two differ, if the manifest or the skill frontmatter stops being valid, or if the skill names a tool the server does
not have (or leaves one out).

## Privacy and what it sends

The plugin runs no code and no scripts. The only network call is the connector's, to dogpolicies.com, and it sends the
arguments of a tool call (a place name, a date, a route). DogPolicies keeps no account, asks for no sign-in and stores no
question or address. The server only reads public rules.

## What Anthropic's documentation says (read 2026-11-21)

Pages read in full on 2026-11-21, with what each gave:

- https://claude.com/docs/extend/overview.md: a plugin packages skills, MCP connectors, commands and agents. "When a
  plugin exists for a product you use, it bundles that product's connector with the skills that use it." Anyone on a paid
  Claude plan can submit to the directory, with no partner program.
- https://claude.com/docs/directory/publish.md: the two-step wording is confirmed (it was unverified before). "For your
  own product, make two submissions: the server as an MCP connector, then the plugin bundle whose skills teach Claude
  how to use it. Point the bundle's MCP server configuration at the same URL, so people who have both see one set of
  tools rather than two." Skills are not a submission type; put them in a plugin bundle. Free accounts cannot submit
  (Pro, Max, Ultra, Team, Enterprise can; on Team and Enterprise an Owner submits).
- https://claude.com/docs/plugins/submit.md: submit from a GitHub repository in the developer portal at
  https://claude.ai/directory/manage. The repository may be private while validating and submitting, and must be public
  before the listing goes live. One submission per plugin folder; "Plugin path" names the folder that holds
  `.claude-plugin/plugin.json` if it is not the repository root.
- https://claude.com/docs/plugins/pre-submission-checklist.md: what Validate checks. The ones that apply here: `name`
  lowercase letters, digits and hyphens, not a reserved word, no "official", not confusable with a known brand;
  `description`, `author` and `version` set; a README of at least 40 words outside code blocks; a `LICENSE` file or a
  `license` field; only text files, SVG and complete PNG/JPEG/GIF/WebP images (any other binary is held for a reviewer);
  every non-image file under 256 KiB, 512 files at most; a remote MCP server needs `type` of `http`, `sse` or `ws` and
  an absolute `https://` URL; no credentials in any file; front matter in `SKILL.md` valid YAML with a single-text
  `description`.
- https://claude.com/docs/connectors/building/submission.md: the connector is submitted separately as "MCP connector"
  (an https URL, a title and a read-only annotation on every tool, a no-sign-in connector is allowed for public data,
  listing fields, a Test & launch confirmation, seven compliance acknowledgments).
- https://code.claude.com/docs/en/plugins-reference (plugin manifest reference): `.claude-plugin/plugin.json`
  with `name` the only required field; `skills/<name>/SKILL.md` and `.mcp.json` at the plugin root are found by their
  default locations; the directory reads `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl` and
  `termsOfServiceUrl` from `plugin.json`; `claude plugin validate ./<folder>` checks the files.
- https://code.claude.com/docs/en/mcp.md (first 100,000 of 158,539 characters): a plugin's `.mcp.json` uses the
  `mcpServers` wrapper and `"type": "http"` for a remote server (`streamable-http` is accepted as an alias; an entry with
  a `url` and no `type` is read as a local server and skipped). Its tools are named
  `mcp__plugin_<plugin>_<server>__<tool>`.
- https://agentskills.io/specification: `SKILL.md` needs YAML frontmatter with `name` (1 to 64 characters, lowercase
  letters, digits and single hyphens, equal to the folder name) and `description` (1 to 1024 characters, what it does and
  when to use it). Keep the body under 500 lines.

Unverified or not read: the exact review time (the docs give none); whether the Claude directory shows plugin
installs and connector use on separate dashboards beyond what publish.md says; the rest of the MCP page; how Claude
chooses between a plugin skill and a tool description on a given prompt. `claude plugin validate ./claude-plugin` was run with Claude Code 2.1.329 on 2026-11-21 and passed with no
findings; its only advice is a README install line, which needs the final `<owner>/<repo>` of the public repository
(add `/plugin install dogpolicies --marketplace <owner>/<repo>` once it exists). The portal's Validate, the security
scan and the policy review run more checks than that command and have not been run.

## Submission steps for the owner

Nothing here has been submitted. In this order, per
https://claude.com/docs/directory/publish.md#submit-your-plugin-and-your-mcp-server-as-a-connector:

1. Confirm the Claude account is on a paid plan (Pro, Max, Ultra, Team or Enterprise) and is the organization that
   should own the listing long term. A plugin folder can be held by only one organization.
2. Update the connector listing first, at https://claude.ai/directory/manage (the listing from 2026-11-04 showed 13
   tools; the server has 18). Open the existing connector submission, re-sync the tools, edit the text (the coordinator
   owns the texts in `docs/listings/`), and publish the update. If there is no connector listing in the portal,
   choose **Submit new**, then **MCP connector**, and follow https://claude.com/docs/connectors/building/submission.md.
3. Put the plugin folder in a GitHub repository, public before it goes live. The existing public repo
   `xultrax-web/dogpolicies-mcp` is exported from `packages/mcp` only (`packages/mcp/scripts/sync-public.mjs`), so
   `packages/claude-plugin` is not in it today. Either (a) create a small public repository for the plugin and copy the
   folder to its root (simplest; the Plugin path stays empty), or (b) extend the sync so the folder lands in the public
   repo and give its path (for example `claude-plugin`) in step 5. This is a decision, not done here.
4. On a machine with Claude Code, from the folder that contains the plugin folder, run
   `claude plugin validate ./claude-plugin` and fix anything it prints.
5. Open https://claude.ai/directory/manage, select **Submit new**, then **Plugin bundle**. On **Source**, enter the
   repository (`owner/repo`), the plugin path if it is not the root, leave the branch empty to follow the default
   branch, and select **Validate**. Fix every finding marked Blocking in the repository, push, and select **Re-validate**.
6. Check **Listing details** (read from `plugin.json` and the README). Answer **Data handling** from the facts in
   "Privacy and what it sends" above (the portal's exact questions were not seen). Complete **Compliance** (contact email, all four acknowledgements).
7. On **Review and submit**, keep **GitHub push webhook** for updates, and select **Submit for review**. Follow the
   status on the plugin's page. After a version passes, select **Publish** (by default an Anthropic reviewer
   publishes it).
8. If the portal offers it, pair the plugin with the connector listing from the same organization.
9. Releases afterward: merge to the tracked branch and raise `version` in `plugin.json` each time. Usage shows on the
   plugin's **Usage** tab.

Anthropic's pages name mcp-review@anthropic.com for connector escalations and directory@anthropic.com for a plugin
folder another organization already holds; https://claude.com/docs/directory/submission-status.md has the channel for a
stuck submission (not read).

## Try it without the directory

In Claude Code, from this folder's parent: `claude --plugin-dir ./claude-plugin`, then ask "Can I bring my dog to Point
Lobos?". A Claude Code user can also add a marketplace from a GitHub repository without review.
