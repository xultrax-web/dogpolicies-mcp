// The eval set: realistic user questions, the tool a model should pick, the
// arguments it should pass, and the facts the answer must contain.
//
// Two scores, both model-free so they run in CI:
//   selection  a bag-of-words router over the tool titles and descriptions
//              picks a tool for each question; the share that matches the
//              expected tool measures how well the descriptions tell the
//              tools apart (a model does better, never worse, than this).
//   answers    the expected tool is called with the expected arguments and
//              every fact must appear in the text; the share that passes.
//
// Both are printed; the thresholds fail the build when descriptions or
// answers regress. `node --test test/eval.test.mjs` prints the table.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolDefinitions } from "../src/dogpolicies/server.mjs";
import { call, sharedRuntime, text, withClient } from "./helpers.mjs";

const QUESTIONS = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "eval", "questions.json"),
    "utf8",
  ),
);
const THRESHOLD = { selection: 0.7, top2: 0.85, answers: 0.95 };

const STOP = new Set(
  "a an and are as at be by can do for from i in is it me my of on or our the this to we what where which with will your there any them these two".split(
    " ",
  ),
);
const words = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9$ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

/** TF-IDF-style router: words rare across tools weigh more; the examples in a description count. */
export function router(tools) {
  const docs = tools.map((t) => ({
    name: t.name,
    words: words(`${t.title} ${t.title} ${t.description}`),
  }));
  const df = new Map();
  for (const d of docs)
    for (const w of new Set(d.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log((docs.length + 1) / ((df.get(w) ?? 0) + 1)) + 0.1;
  return (question) => {
    const q = words(question);
    const scored = docs.map((d) => {
      const tf = new Map();
      for (const w of d.words) tf.set(w, (tf.get(w) ?? 0) + 1);
      const score = q.reduce(
        (s, w) => s + (tf.has(w) ? (1 + Math.log(tf.get(w))) * idf(w) : 0),
        0,
      );
      return { name: d.name, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  };
}

test(`eval: tool selection from descriptions (threshold ${THRESHOLD.selection})`, () => {
  const tools = toolDefinitions(sharedRuntime());
  const pick = router(tools);
  const rows = QUESTIONS.map((x) => {
    const ranked = pick(x.q);
    return {
      q: x.q,
      expected: x.tool,
      got: ranked[0].name,
      rank: ranked.findIndex((r) => r.name === x.tool) + 1,
    };
  });
  const top1 = rows.filter((r) => r.got === r.expected).length / rows.length;
  const top2 =
    rows.filter((r) => r.rank > 0 && r.rank <= 2).length / rows.length;
  console.log(
    `\nselection: top-1 ${(top1 * 100).toFixed(0)}%, top-2 ${(top2 * 100).toFixed(0)}% over ${rows.length} questions`,
  );
  for (const r of rows.filter((r) => r.got !== r.expected))
    console.log(
      `  miss: "${r.q}" -> ${r.got} (expected ${r.expected}, rank ${r.rank || "none"})`,
    );
  assert.ok(
    top1 >= THRESHOLD.selection,
    `top-1 selection ${top1} below ${THRESHOLD.selection}`,
  );
  assert.ok(
    top2 >= THRESHOLD.top2,
    `top-2 selection ${top2} below ${THRESHOLD.top2}`,
  );
});

test(`eval: answers contain the expected facts (threshold ${THRESHOLD.answers})`, () =>
  withClient(async (client) => {
    const failures = [];
    for (const x of QUESTIONS) {
      const r = await call(client, x.tool, x.args);
      const out = r.isError ? `ERROR ${text(r)}` : text(r);
      const missing = x.facts.filter((f) => !new RegExp(f, "m").test(out));
      if (r.isError && x.tool !== "dogpolicies_report_correction")
        failures.push(`${x.q}: ${out.slice(0, 120)}`);
      else if (missing.length)
        failures.push(`${x.q}: missing ${missing.join(", ")}`);
    }
    const score = 1 - failures.length / QUESTIONS.length;
    console.log(
      `answers: ${(score * 100).toFixed(0)}% of ${QUESTIONS.length} questions carry every expected fact`,
    );
    for (const f of failures) console.log(`  fail: ${f}`);
    assert.ok(
      score >= THRESHOLD.answers,
      `answer score ${score} below ${THRESHOLD.answers}`,
    );
  }));
