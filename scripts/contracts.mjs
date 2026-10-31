#!/usr/bin/env node
// Writes the tool contract file the contract test compares against: every
// tool's name, annotations, input fields (with required ones) and output
// fields. Run it when a tool contract changes on purpose, then review the
// diff: a removed field or tool is a breaking change (major release).
//
//   node scripts/contracts.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contractOf } from "../test/contract.mjs";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "contracts",
  "tools.json",
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(contractOf(), null, 2) + "\n");
console.log(`wrote ${out}`);
