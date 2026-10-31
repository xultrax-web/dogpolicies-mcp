// Backward compatibility: a tool, an input field or an output field that a
// client could rely on in the committed contract must still exist, with the
// same annotations and the same required inputs. Additions pass; removals
// fail until the contract file is regenerated on purpose (a major release).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contractOf } from "./contract.mjs";

const committed = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "contracts", "tools.json"),
    "utf8",
  ),
);

test("every committed tool still exists with its contract intact", () => {
  const live = contractOf();
  for (const [name, c] of Object.entries(committed)) {
    const l = live[name];
    assert.ok(
      l,
      `tool ${name} was removed; deprecate first, remove in a major release`,
    );
    assert.deepEqual(
      l.annotations,
      c.annotations,
      `${name} annotations changed`,
    );
    for (const f of c.input.properties)
      assert.ok(l.input.properties.includes(f), `${name} lost input ${f}`);
    assert.deepEqual(
      l.input.required,
      c.input.required,
      `${name} required inputs changed`,
    );
    if (c.output)
      for (const f of c.output.properties)
        assert.ok(
          l.output.properties.includes(f),
          `${name} lost output field ${f}`,
        );
    if (c.output)
      for (const f of c.output.required)
        assert.ok(
          l.output.required.includes(f),
          `${name} output ${f} is no longer required`,
        );
  }
});

test("a new tool or field is recorded in the contract file", () => {
  const live = contractOf();
  const missing = [];
  for (const [name, l] of Object.entries(live)) {
    const c = committed[name];
    if (!c) missing.push(`tool ${name}`);
    else {
      for (const f of l.input.properties)
        if (!c.input.properties.includes(f)) missing.push(`${name} input ${f}`);
      if (l.output)
        for (const f of l.output.properties)
          if (!c.output?.properties.includes(f))
            missing.push(`${name} output ${f}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "run `node scripts/contracts.mjs` and review the diff",
  );
});
