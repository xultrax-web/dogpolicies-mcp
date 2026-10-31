#!/usr/bin/env node
// Maintainer-only. Exports this package from the private data repository to
// the public release repository as one ordinary commit: the committed files
// of packages/mcp become the public repository's root. Private history,
// private docs and anything outside the package never leave.
//
//   node packages/mcp/scripts/sync-public.mjs [--to <dir>] [--push] [--dry-run]
//
// Refuses to sync when any file would carry a secret pattern or a reference
// to a private path, when a file outside the package would be included, or
// when the public clone has uncommitted changes. Never force-pushes.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..", "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const TO = resolve(
  opt(
    "--to",
    process.env.DOGPOLICIES_PUBLIC_REPO ??
      resolve(ROOT, "..", "dogpolicies-mcp"),
  ),
);
const git = (cwd, ...a) =>
  execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

if (!existsSync(join(ROOT, "src", "lib", "data.mjs"))) {
  console.log(
    "sync-public: maintainer-only; run it from the private data repository (packages/mcp inside it).",
  );
  process.exit(0);
}
if (!existsSync(join(TO, ".git"))) {
  console.error(
    `sync-public: ${TO} is not a git clone of the public repository (use --to <dir>).`,
  );
  process.exit(2);
}

// 1. Only committed files of the package, never the working tree.
const files = git(ROOT, "ls-files", "--", "packages/mcp")
  .split("\n")
  .filter(Boolean);
const outside = files.filter((f) => !f.startsWith("packages/mcp/"));
if (outside.length)
  refuse(
    `files outside the package would be included:\n  ${outside.join("\n  ")}`,
  );
if (!files.length) refuse("no committed files under packages/mcp");

// 2. Nothing a public repository must not carry.
const SECRETS = [
  /ghp_[A-Za-z0-9]{20,}/, // GitHub token
  /github_pat_[A-Za-z0-9_]{20,}/,
  /npm_[A-Za-z0-9]{30,}/, // npm token
  /sk_(live|test)_[A-Za-z0-9]{10,}/, // Stripe
  /AKIA[0-9A-Z]{16}/, // AWS
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[abp]-[A-Za-z0-9-]{10,}/, // Slack
  /(UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9]{8,}/,
  /Bearer [A-Za-z0-9._-]{30,}/,
];
const PRIVATE = [
  /C:\\Dev\\|C:\/Dev\//, // local machine paths
  /forbidden-island/i,
  /dogrulebook-review/,
  /strategy-memo/,
  /docs\/STRATEGY\.md|docs\/API-KEYS-PLAN\.md|docs\/TERMS-DRAFT\.md|BUILD-LOG\.md/,
  /peachandmadison|peach & madison/i,
  /(?<![a-zA-Z.])\.env(\.local)?\b/, // a dotenv file, not process.env
  /Users[\\/][a-z]+[\\/]/i, // a home directory
];
const problems = [];
for (const f of files) {
  const path = join(ROOT, f);
  // The checker itself names the patterns it looks for.
  if (f.endsWith("sync-public.mjs")) continue;
  if (f.endsWith(".gz") || f.endsWith(".png")) continue;
  const text = readFileSync(path, "utf8");
  for (const re of SECRETS)
    if (re.test(text)) problems.push(`${f}: matches secret pattern ${re}`);
  for (const re of PRIVATE) {
    const m = text.match(re);
    if (m) problems.push(`${f}: private reference "${m[0]}"`);
  }
}
if (problems.length)
  refuse(`private content would leak:\n  ${problems.join("\n  ")}`);

// 3. The public clone must be clean and on main.
if (git(TO, "status", "--porcelain")) refuse(`${TO} has uncommitted changes`);
const branch = git(TO, "rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") refuse(`${TO} is on ${branch}, not main`);

const sha = git(ROOT, "rev-parse", "--short", "HEAD");
const dirty = git(ROOT, "status", "--porcelain", "--", "packages/mcp")
  ? " (with uncommitted changes NOT included)"
  : "";
console.log(`sync-public: ${files.length} files from ${sha}${dirty} -> ${TO}`);
if (flag("--dry-run")) process.exit(0);

// 4. Mirror: remove everything except .git, copy the committed files in.
for (const entry of readdirSync(TO)) {
  if (entry === ".git") continue;
  rmSync(join(TO, entry), { recursive: true, force: true });
}
for (const f of files) {
  const rel = relative("packages/mcp", f).split("/").join(sep);
  const dest = join(TO, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(ROOT, f), dest);
}
git(TO, "add", "-A");
if (!git(TO, "status", "--porcelain")) {
  console.log(
    "sync-public: public repository already matches; nothing to commit",
  );
  process.exit(0);
}
const version = JSON.parse(
  readFileSync(join(PKG, "package.json"), "utf8"),
).version;
git(
  TO,
  "commit",
  "-q",
  "-m",
  `Sync dogpolicies-mcp ${version} from the data repository (${sha})`,
);
console.log(
  `sync-public: committed ${git(TO, "rev-parse", "--short", "HEAD")} on main`,
);
if (flag("--push")) {
  console.log(git(TO, "push", "origin", "main"));
} else console.log("sync-public: not pushed (add --push)");

function refuse(why) {
  console.error(`sync-public refused: ${why}`);
  process.exit(1);
}
