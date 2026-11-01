#!/usr/bin/env node
// Builds the Claude Desktop extension: dist/dogpolicies-mcp-<version>.mcpb.
//
// Stages the published files plus production node_modules and the manifest,
// then packs with the official CLI (@anthropic-ai/mcpb). The CLI is fetched
// with npx, so packing needs the network; `--manifest-only` writes the
// staging folder and manifest without packing (used by the test).
//
//   node scripts/mcpb.mjs [--manifest-only] [--out <dir>]

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRuntime } from "../src/dogpolicies/server.mjs";
import { buildManifest } from "../src/dogpolicies/mcpb-manifest.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const manifestOnly = args.includes("--manifest-only");
const outDir = resolve(
  args.includes("--out") ? args[args.indexOf("--out") + 1] : join(PKG, "dist"),
);
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const stage = join(outDir, "mcpb");
const bundle = join(outDir, `${pkg.name}-${pkg.version}.mcpb`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 1. The files npm publishes (the same whitelist), minus docs, plus the icon.
for (const entry of pkg.files) {
  if (entry === "docs/") continue;
  const from = join(PKG, entry);
  if (existsSync(from)) cpSync(from, join(stage, entry), { recursive: true });
}
cpSync(join(PKG, "assets", "icon.png"), join(stage, "icon.png"));
// A trimmed package.json: the extension is not published from this copy.
const { scripts, devDependencies, publishConfig, ...rest } = pkg;
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({ ...rest, private: true }, null, 2) + "\n",
);

// 2. The manifest, from the live server.
const ctx = createRuntime({
  env: {},
  overrides: { offline: true, logLevel: "silent" },
});
const manifest = buildManifest(ctx);
writeFileSync(
  join(stage, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  join(stage, ".mcpbignore"),
  ["*.map", "*.md", "!README.md", ".DS_Store"].join("\n") + "\n",
);
console.log(
  `staged ${stage}: ${manifest.tools.length} tools, ${manifest.prompts.length} prompts, version ${manifest.version}`,
);
if (manifestOnly) process.exit(0);

// 3. Production dependencies inside the bundle (Claude Desktop runs it with its own Node).
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawnSync(
  npm,
  [
    "install",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--no-package-lock",
  ],
  {
    cwd: stage,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
if (install.status !== 0) process.exit(install.status ?? 1);

// 4. Validate and pack with the official CLI.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (cliArgs) =>
  spawnSync(npx, ["--yes", "@anthropic-ai/mcpb@2", ...cliArgs], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
if (run(["validate", join(stage, "manifest.json")]).status !== 0)
  process.exit(1);
rmSync(bundle, { force: true });
if (run(["pack", stage, bundle]).status !== 0) process.exit(1);
console.log(`built ${bundle}`);
