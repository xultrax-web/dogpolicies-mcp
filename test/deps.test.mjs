// Every package the shipped code imports must be in `dependencies`. A
// devDependency resolves fine inside this repository but is missing for
// anyone who installs from npm (0.2.0 shipped that way and did not start).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The package name a bare specifier names: "@scope/name/sub" -> "@scope/name". */
const packageOf = (spec) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

test("every import in shipped code is a dependency, a node: builtin or a relative path", () => {
  const shipped = ["src", "bin"].flatMap((d) => walk(join(PKG, d)));
  const missing = new Set();
  for (const file of shipped.filter((f) => /\.(mjs|js)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
    )) {
      const spec = m[1] ?? m[2];
      if (!spec || spec.startsWith(".") || spec.startsWith("node:")) continue;
      if (!(packageOf(spec) in (pkg.dependencies ?? {})))
        missing.add(`${packageOf(spec)} (${file.slice(PKG.length + 1)})`);
    }
  }
  assert.deepEqual([...missing], [], "imported but not in dependencies");
});
