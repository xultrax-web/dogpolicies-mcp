// Runs `node --test` on an explicit list of files. Node 20 does not expand
// glob patterns in `node --test` arguments (Node 22 does), and Windows shells
// do not expand them either, so the list is built here.
//
//   node test/run.mjs          unit, contract, surface, eval and fuzz tests
//   node test/run.mjs e2e      the packed end-to-end test

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? "");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => join(dir, f));
if (!files.length) {
  console.error(`no *.test.mjs files in ${dir}`);
  process.exit(1);
}
const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(status ?? 1);
