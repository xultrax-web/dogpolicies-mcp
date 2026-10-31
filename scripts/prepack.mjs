#!/usr/bin/env node
// Runs before `npm pack` / `npm publish`: refuses to pack a tarball whose
// snapshot or vendored matcher is missing or out of date, and checks that
// package.json, server.json and the registry name agree. No network.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshotFile } from "../src/core/source.mjs";
import { validateSnapshot } from "../src/dogpolicies/graph.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const snapshotPath = join(PKG, "data", "snapshot.json.gz");
if (!existsSync(snapshotPath))
  problems.push("data/snapshot.json.gz is missing: run `npm run build`");
else {
  try {
    const s = validateSnapshot(readSnapshotFile(snapshotPath));
    const age = (Date.now() - Date.parse(s.as_of)) / 86_400_000;
    if (age > 45)
      problems.push(
        `snapshot is ${Math.round(age)} days old (${s.as_of}): run \`npm run build\` before publishing`,
      );
  } catch (error) {
    problems.push(`snapshot invalid: ${error.message}`);
  }
}

const vendored = join(PKG, "src", "dogpolicies", "vendor", "match.mjs");
const source = resolve(PKG, "..", "..", "src", "lib", "match.mjs");
if (!existsSync(vendored))
  problems.push("vendor/match.mjs is missing: run `npm run build`");
else if (existsSync(source)) {
  const a = readFileSync(source, "utf8").replace(
    'import { STAY } from "./format.mjs";',
    'import { STAY } from "../stay.mjs";',
  );
  const b = readFileSync(vendored, "utf8").split("\n").slice(1).join("\n");
  if (a !== b)
    problems.push(
      "vendor/match.mjs differs from src/lib/match.mjs: run `npm run build`",
    );
}

const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const serverJson = JSON.parse(readFileSync(join(PKG, "server.json"), "utf8"));
if (serverJson.name !== pkg.mcpName)
  problems.push(
    `server.json name ${serverJson.name} != package.json mcpName ${pkg.mcpName}`,
  );
if (serverJson.version !== pkg.version)
  problems.push(
    `server.json version ${serverJson.version} != package.json version ${pkg.version}`,
  );
for (const p of serverJson.packages ?? []) {
  if (p.identifier !== pkg.name)
    problems.push(
      `server.json package identifier ${p.identifier} != ${pkg.name}`,
    );
  if (p.version !== pkg.version)
    problems.push(`server.json package version ${p.version} != ${pkg.version}`);
}
const changelog = readFileSync(join(PKG, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## ${pkg.version}`))
  problems.push(`CHANGELOG.md has no "## ${pkg.version}" section`);

if (problems.length) {
  console.error("prepack refused:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`prepack ok: ${pkg.name}@${pkg.version} (${pkg.mcpName})`);
