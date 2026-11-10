#!/usr/bin/env node
// Routing check: for each question in test/eval/questions.json, ask a model
// which tool it would call FIRST, shown the real tools/list (name,
// description, input schema) and the server instructions, with no execution.
// Compares the descriptions in git (default origin/main) with the working tree
// and reports how many questions route to the expected tool before and after.
//
// Needs ANTHROPIC_API_KEY (never printed or stored); without one it prints a
// skip message and exits 0. It is not part of `npm test`: it calls a paid API.
//
//   ANTHROPIC_API_KEY=... node scripts/route-check.mjs [--base origin/main] [--model claude-haiku-5-5] [--limit N] [--verbose]

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "route-check skipped: ANTHROPIC_API_KEY is not set (it calls the Claude Messages API, so it never runs in npm test).",
  );
  process.exit(0);
}

const BASE = arg("base", "origin/main");
const MODEL = arg("model", "claude-haiku-5-5");
const LIMIT = Number(arg("limit", "0")) || Infinity;
const QUESTIONS = JSON.parse(
  readFileSync(join(PKG, "test", "eval", "questions.json"), "utf8"),
).slice(0, LIMIT);

/** The real tools/list and initialize instructions of the package at `root`. */
async function listTools(root) {
  const base = pathToFileURL(root + "/").href;
  const { createRuntime } = await import(`${base}src/dogpolicies/server.mjs`);
  const { connectInProcess } = await import(
    `${base}src/dogpolicies/connect.mjs`
  );
  const ctx = createRuntime({
    env: {},
    overrides: { offline: true, logLevel: "silent" },
  });
  const { client, close } = await connectInProcess(ctx);
  try {
    const { tools } = await client.listTools();
    return {
      instructions: client.initialize?.instructions ?? "",
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    };
  } finally {
    await close();
  }
}

async function firstTool(set, question) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: set.instructions || undefined,
        tools: set.tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: question }],
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Messages API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const use = json.content?.find((b) => b.type === "tool_use");
    return use ? use.name : "(no tool)";
  }
  throw new Error("Messages API kept failing (rate limit or overload)");
}

async function score(label, set) {
  const rows = [];
  for (let i = 0; i < QUESTIONS.length; i += 4) {
    const batch = QUESTIONS.slice(i, i + 4);
    const got = await Promise.all(batch.map((x) => firstTool(set, x.q)));
    batch.forEach((x, j) => rows.push({ q: x.q, want: x.tool, got: got[j] }));
  }
  const ok = rows.filter((r) => r.got === r.want).length;
  console.log(`${label}: ${ok} of ${rows.length} route to the expected tool`);
  return rows;
}

const OLD_DIR = join(PKG, ".route-check-old");
let before;
try {
  rmSync(OLD_DIR, { recursive: true, force: true });
  mkdirSync(OLD_DIR, { recursive: true });
  // the package as it was at BASE, unpacked inside this package so its
  // dependencies resolve from the same node_modules (cwd, not -C: a Windows
  // drive letter reads as a remote host to tar)
  const tar = execFileSync("git", ["archive", BASE, "--", "packages/mcp"], {
    cwd: join(PKG, "..", ".."),
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x"], { input: tar, cwd: OLD_DIR });
  before = await listTools(join(OLD_DIR, "packages", "mcp"));
} finally {
  rmSync(OLD_DIR, { recursive: true, force: true });
}
const after = await listTools(PKG);
const a = await score(`before (${BASE})`, before);
const b = await score("after (working tree)", after);
const mark = (r) => (r.got === r.want ? "ok  " : "miss");
for (let i = 0; i < a.length; i++) {
  if (a[i].got === b[i].got) continue;
  console.log(
    `  changed: "${a[i].q}"
    before ${mark(a[i])} ${a[i].got}
    after  ${mark(b[i])} ${b[i].got} (expected ${a[i].want})`,
  );
}
for (const r of b.filter((r) => r.got !== r.want))
  console.log(`  still off: "${r.q}" -> ${r.got} (expected ${r.want})`);
