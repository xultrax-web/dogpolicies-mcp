// End to end: pack the tarball exactly as `npm publish` would, unpack it in a
// temporary directory, start it over stdio like an AI client and call every
// tool. The tarball's own files are what runs; its dependencies come from
// this repository's node_modules through a link (set E2E_INSTALL=1 to run a
// real `npm install` instead, which needs the network).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = resolve(PKG, "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

test("npm pack -> unpack -> run over stdio -> every tool answers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drb-e2e-"));
  run(npm, ["pack", "--pack-destination", dir, "--silent"], PKG);
  const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  assert.ok(tarball, "a tarball was produced");
  run("tar", ["-xzf", tarball], dir);
  const unpacked = join(dir, "package");
  for (const f of [
    "bin/dogpolicies-mcp.mjs",
    "data/snapshot.json.gz",
    "src/dogpolicies/vendor/match.mjs",
    "server.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "types/index.d.ts",
  ])
    assert.ok(existsSync(join(unpacked, f)), `${f} is in the tarball`);
  assert.ok(!existsSync(join(unpacked, "test")), "tests are not shipped");
  assert.ok(
    !existsSync(join(unpacked, "scripts")),
    "build scripts are not shipped",
  );

  if (process.env.E2E_INSTALL === "1")
    run(
      npm,
      ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"],
      unpacked,
    );
  else {
    const modules = existsSync(
      join(PKG, "node_modules", "@modelcontextprotocol"),
    )
      ? join(PKG, "node_modules")
      : join(ROOT, "node_modules");
    symlinkSync(modules, join(unpacked, "node_modules"), "junction");
  }

  const client = new Client({ name: "e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(unpacked, "bin", "dogpolicies-mcp.mjs"),
      "--offline",
      "--log",
      "silent",
    ],
    env: { ...getDefaultEnvironment(), DOGPOLICIES_TODAY: "2026-10-31" },
    cwd: dir,
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 13);
    const calls = [
      ["dogpolicies_search_places", { query: "Carmel", limit: 3 }],
      ["dogpolicies_get_place", { id: "carmel-beach" }],
      [
        "dogpolicies_find_hotels",
        { county: "Monterey", dog_weight_lb: 70, limit: 3 },
      ],
      ["dogpolicies_get_brand_policy", { brand: "motel-6" }],
      ["dogpolicies_browse_answers", { limit: 3 }],
      ["dogpolicies_route_stops", { from_mile: 170, to_mile: 222, limit: 3 }],
      ["dogpolicies_changes_since", { since: "2026-01-01", limit: 3 }],
      [
        "dogpolicies_report_correction",
        {
          place_id: "carmel-beach",
          message: "A test report that goes nowhere.",
        },
      ],
    ];
    for (const [name, args] of calls) {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
      assert.ok(r.content[0].text.length > 20);
    }
    const detail = await client.callTool({
      name: "dogpolicies_get_place",
      arguments: { id: "carmel-beach", response_format: "json" },
    });
    const rule = await client.callTool({
      name: "dogpolicies_get_rule",
      arguments: { id: detail.structuredContent.rule_records[0].id },
    });
    assert.ok(!rule.isError);
    // The offline report never leaves the machine.
    const report = await client.callTool({
      name: "dogpolicies_report_correction",
      arguments: { place_id: "carmel-beach", message: "Another test report." },
    });
    assert.equal(report.structuredContent.status, "not_sent");
  } finally {
    await client.close();
  }
});

test("the CLI answers --version, --help, check and demo from the packed layout", () => {
  const out = (args) =>
    execFileSync(
      process.execPath,
      [join(PKG, "bin", "dogpolicies-mcp.mjs"), ...args],
      { encoding: "utf8", env: { ...process.env, DOGPOLICIES_LOG: "silent" } },
    );
  assert.match(out(["--version"]), /^\d+\.\d+\.\d+/);
  assert.match(out(["--help"]), /Usage/);
  assert.match(out(["check", "--offline"]), /all tools answered/);
  assert.match(out(["demo", "--offline"]), /cite with link/);
  assert.match(out(["demo", "Monterey", "--offline"]), /Pet fee|match/);
});
