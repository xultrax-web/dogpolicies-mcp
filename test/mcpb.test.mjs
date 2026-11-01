// The Claude Desktop extension manifest: required fields per the MCPB spec
// (manifest_version 0.3), the tool list equal to the live server's, the
// version equal to the package's, the icon present, and the staging step
// producing a runnable layout.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildManifest,
  MANIFEST_VERSION,
} from "../src/dogpolicies/mcpb-manifest.mjs";
import { toolDefinitions } from "../src/dogpolicies/server.mjs";
import { sharedRuntime } from "./helpers.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

test("manifest has the required fields, matches the package and the live tools", () => {
  const ctx = sharedRuntime();
  const m = buildManifest(ctx);
  assert.equal(m.manifest_version, MANIFEST_VERSION);
  for (const f of ["name", "version", "description", "author", "server"])
    assert.ok(m[f], `required field ${f}`);
  assert.equal(m.name, pkg.name);
  assert.equal(m.version, pkg.version);
  assert.ok(m.author.name);
  assert.equal(m.server.type, "node");
  assert.ok(existsSync(join(PKG, m.server.entry_point)), "entry point exists");
  assert.equal(m.server.mcp_config.command, "node");
  assert.ok(m.server.mcp_config.args[0].startsWith("${__dirname}/"));
  assert.deepEqual(
    m.tools.map((t) => t.name),
    toolDefinitions(ctx).map((t) => t.name),
  );
  assert.ok(
    m.tools.every(
      (t) => t.description.length > 10 && !t.description.includes("\n"),
    ),
  );
  assert.ok(m.prompts.length >= 5 && m.prompts.every((p) => p.name && p.text));
  assert.equal(m.license, "MIT");
  assert.ok(m.privacy_policies[0].startsWith("https://"));
  assert.deepEqual(m.compatibility.platforms, ["darwin", "win32", "linux"]);
  assert.ok(existsSync(join(PKG, "assets", m.icon)), "icon.png exists");
  const png = readFileSync(join(PKG, "assets", "icon.png"));
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(m.long_description.length > 200 && m.description.length <= 200);
});

test("staging (manifest only) lays out a runnable extension", () => {
  const out = mkdtempSync(join(tmpdir(), "dp-mcpb-"));
  execFileSync(
    process.execPath,
    [join(PKG, "scripts", "mcpb.mjs"), "--manifest-only", "--out", out],
    { encoding: "utf8" },
  );
  const stage = join(out, "mcpb");
  for (const f of [
    "manifest.json",
    "icon.png",
    "package.json",
    "bin/dogpolicies-mcp.mjs",
    "data/snapshot.json.gz",
    "src/index.mjs",
    "LICENSE",
  ])
    assert.ok(existsSync(join(stage, f)), f);
  const staged = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
  assert.equal(staged.version, pkg.version);
  const stagedPkg = JSON.parse(
    readFileSync(join(stage, "package.json"), "utf8"),
  );
  assert.equal(stagedPkg.private, true);
  assert.ok(stagedPkg.dependencies["@modelcontextprotocol/server"]);
  assert.equal(stagedPkg.scripts, undefined);
});
