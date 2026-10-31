// The contract of every tool, derived from its live definition: what a
// client can rely on. Used by scripts/contracts.mjs to write the committed
// file and by contracts.test.mjs to compare against it.

import * as z from "zod/v4";
import { toolDefinitions } from "../src/dogrulebook/server.mjs";
import { testRuntime } from "./helpers.mjs";

const fields = (schema) => {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return {
    required: [...(json.required ?? [])].sort(),
    properties: Object.keys(json.properties ?? {}).sort(),
  };
};

export function contractOf(ctx = testRuntime()) {
  const out = {};
  for (const t of toolDefinitions(ctx)) {
    out[t.name] = {
      title: t.title,
      annotations: t.annotations,
      input: fields(t.inputSchema),
      output: t.outputSchema ? fields(t.outputSchema) : null,
      since: t.since ?? null,
      deprecated: t.deprecated ?? null,
    };
  }
  return out;
}
