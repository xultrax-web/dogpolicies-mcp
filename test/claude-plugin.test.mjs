// The Claude plugin (packages/claude-plugin, decision 136): its manifest, skill and connector config agree with this
// server, and a first call that arrives without what the tool needs gets an answer with an example.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call, text, withClient } from "./helpers.mjs";
import { EXAMPLES } from "../src/dogpolicies/tools/examples.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, "..", "..", "claude-plugin");
const json = (...p) => JSON.parse(readFileSync(join(...p), "utf8"));
const serverJson = json(here, "..", "server.json");

/** The frontmatter of a SKILL.md as {key: value} (single-line values) and its body. */
function readSkill(file) {
  const raw = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  assert.ok(m, `${file} starts with YAML frontmatter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z-]+):\s*(.+)$/.exec(line);
    assert.ok(kv, `frontmatter line is key: value: ${line}`);
    meta[kv[1]] = kv[2];
  }
  return { meta, body: m[2] };
}

const files = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    statSync(p).isDirectory() ? files(p, out) : out.push(p);
  }
  return out;
};

test("plugin manifest parses and carries what the directory reads", () => {
  const m = json(PLUGIN, ".claude-plugin", "plugin.json");
  assert.match(m.name, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.doesNotMatch(m.name, /claude|anthropic|official/);
  for (const k of [
    "description",
    "version",
    "license",
    "homepage",
    "repository",
  ])
    assert.ok(m[k], `${k} is set`);
  assert.ok(m.author?.name, "author.name is set");
  for (const k of [
    "documentationUrl",
    "supportUrl",
    "privacyPolicyUrl",
    "termsOfServiceUrl",
  ])
    assert.match(m[k], /^https:\/\//, k);
  assert.ok(existsSync(join(PLUGIN, m.icon)), "the icon file exists");
  assert.ok(
    existsSync(join(PLUGIN, "LICENSE")),
    "LICENSE is in the plugin folder",
  );
  const readme = readFileSync(join(PLUGIN, "README.md"), "utf8").replace(
    /```[\s\S]*?```/g,
    "",
  );
  assert.ok(
    readme.split(/\s+/).filter(Boolean).length >= 40,
    "README has at least 40 words outside code",
  );
});

test("the connector config is the server's remote URL, over http, with no credentials", () => {
  const mcp = json(PLUGIN, ".mcp.json");
  const servers = Object.values(mcp.mcpServers);
  assert.equal(servers.length, 1);
  const [s] = servers;
  assert.equal(s.type, "http");
  assert.equal(s.url, serverJson.remotes[0].url);
  assert.deepEqual(
    Object.keys(s).sort(),
    ["type", "url"],
    "no headers, no env",
  );
});

test("the skill has valid frontmatter and a body under 500 lines", () => {
  const dir = join(PLUGIN, "skills");
  const names = readdirSync(dir);
  assert.deepEqual(names, ["dog-travel"]);
  const { meta, body } = readSkill(join(dir, names[0], "SKILL.md"));
  assert.equal(meta.name, names[0], "name matches the folder");
  assert.match(meta.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(meta.name.length <= 64);
  assert.ok(
    meta.description.length > 100 && meta.description.length <= 1024,
    `description is ${meta.description.length} characters`,
  );
  assert.ok(body.split("\n").length < 500);
  for (const when of [
    "I-5",
    "I-80",
    "US-50",
    "I-15",
    "US-395",
    "California and Nevada",
  ])
    assert.ok(meta.description.includes(when), `the description names ${when}`);
  assert.match(body, /service animals?/i);
  assert.match(body, /trip_url/);
  assert.match(body, /verified|date/i);
  assert.doesNotMatch(body, /\bcozy\b|scratch-made/i);
});

test("every tool the skill names exists, and the skill names every tool", () =>
  withClient(async (client) => {
    const { tools } = await client.listTools();
    const have = new Set(tools.map((t) => t.name));
    const { body } = readSkill(
      join(PLUGIN, "skills", "dog-travel", "SKILL.md"),
    );
    const named = new Set(body.match(/dogpolicies_[a-z0-9_]+/g));
    for (const n of named)
      assert.ok(have.has(n), `${n} is not a tool of this server`);
    for (const n of have) assert.ok(named.has(n), `${n} is not in the skill`);
  }));

test("the plugin holds only text files and one PNG, none large", () => {
  for (const f of files(PLUGIN)) {
    const size = statSync(f).size;
    if (f.endsWith(".png")) assert.ok(size < 5 * 1024 * 1024, f);
    else assert.ok(size < 256 * 1024, `${f} is ${size} bytes`);
    assert.ok(!/\.(ico|pdf|zip|exe|dll|mcpb|dxt)$/i.test(f), f);
  }
});

test("an example exists for every tool and works through the tool's own schema", () =>
  withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      Object.keys(EXAMPLES).sort(),
      tools.map((t) => t.name).sort(),
    );
    for (const t of tools) {
      const r = await call(client, t.name, EXAMPLES[t.name]);
      assert.ok(!r.isError, `${t.name} example is not an error`);
      assert.notEqual(
        r.structuredContent?.outcome,
        "bad_input",
        `${t.name} example is usable: ${text(r).slice(0, 160)}`,
      );
    }
  }));

test("a call with no arguments, or none at all, is an answer: never isError, and a bad_input answer carries an example", () =>
  withClient(async (client) => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      for (const args of [undefined, {}]) {
        const r = await client.callTool({ name: t.name, arguments: args });
        assert.ok(
          !r.isError,
          `${t.name} ${JSON.stringify(args)} is not an error`,
        );
        assert.ok(r.structuredContent, `${t.name} has a structured answer`);
        if (r.structuredContent.outcome === "bad_input") {
          const said = text(r);
          assert.match(
            said,
            /Example: dogpolicies_|place="|route="/,
            `${t.name} shows how to call it`,
          );
          assert.ok(
            (r.structuredContent.next ?? []).length > 0,
            `${t.name} has next`,
          );
        }
      }
    }
  }));

test("search_places and find_hotels with nothing to look for say what they need; limit alone or any filter is a search", () =>
  withClient(async (client) => {
    for (const name of [
      "dogpolicies_search_places",
      "dogpolicies_find_hotels",
    ]) {
      const empty = await call(client, name, {});
      assert.equal(empty.structuredContent.outcome, "bad_input", name);
      assert.match(text(empty), /Example: /);
    }
    const paged = await call(client, "dogpolicies_search_places", { limit: 5 });
    assert.notEqual(
      paged.structuredContent.outcome,
      "bad_input",
      "limit alone still lists",
    );
    const some = await call(client, "dogpolicies_search_places", {
      query: "Point Lobos",
    });
    assert.notEqual(some.structuredContent.outcome, "bad_input");
    const hotels = await call(client, "dogpolicies_find_hotels", {
      dog_weight_lb: 70,
    });
    assert.notEqual(hotels.structuredContent.outcome, "bad_input");
  }));
