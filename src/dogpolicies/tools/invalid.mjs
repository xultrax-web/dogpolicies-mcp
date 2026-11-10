// Arguments that fail a tool's schema, answered instead of refused (decision
// 111, after 96). The registry runs the schema inside the handler; a failure
// comes here as the schema's issues, and leaves as a bad_input answer that
// names each argument, what was sent, and what is accepted, read from the very
// JSON Schema the client was shown, so the two cannot disagree. The answer
// satisfies the tool's output schema with empty lists and zero counts.

import { answer } from "./common.mjs";

// Enum values that claim nothing, preferred when an empty answer must fill an enum field.
const NEUTRAL_ENUM_VALUES = new Set(["unknown", "unspecified", "not_stated", "unstated", "none"]);

/** The value of an empty answer for a zod output schema: required fields only. */
export function emptyOf(schema) {
  const d = schema?._zod?.def;
  switch (d?.type) {
    case "string":
      return "";
    case "number":
    case "int":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "record":
    case "map":
      return {};
    case "object":
      return emptyObject(schema);
    case "nullable":
      return null;
    case "optional":
      return undefined;
    case "enum": {
      // A neutral value where the enum has one: an answer that matched nothing must
      // not read as status "yes" (release review MI-2).
      const values = Object.values(d.entries);
      return values.find((v) => NEUTRAL_ENUM_VALUES.has(v)) ?? values[0];
    }
    case "literal":
      return d.values[0];
    case "union":
      return emptyOf(d.options[0]);
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
      return emptyOf(d.innerType);
    case "pipe":
      return emptyOf(d.out);
    default:
      return null;
  }
}

function emptyObject(schema) {
  const out = {};
  for (const [key, field] of Object.entries(schema._zod.def.shape ?? {})) {
    if (field._zod.optout === "optional") continue;
    const v = emptyOf(field);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const keyName = (k) => (typeof k === "object" && k !== null ? k.key : k);

/** The JSON Schema a client sees for the property at `path`, or null. */
function propertyAt(root, path) {
  let node = root;
  for (const raw of path) {
    const key = keyName(raw);
    if (!node) return null;
    node = typeof key === "number" ? node.items : node.properties?.[key];
  }
  return node ?? null;
}

/** What a property accepts, in words a model can use. */
function acceptedOf(node) {
  if (!node) return null;
  const item = node.items ?? node;
  if (item.enum) return item.enum.map(String);
  if (item.type === "boolean") return ["true", "false"];
  if (item.pattern === "^\\d{4}-\\d{2}-\\d{2}$") return ["YYYY-MM-DD"];
  const range = [
    item.minimum != null && `at least ${item.minimum}`,
    item.maximum != null && `at most ${item.maximum}`,
  ].filter(Boolean);
  if (item.type === "number" || item.type === "integer")
    return [`a number${range.length ? ` ${range.join(", ")}` : ""}`];
  if (item.type === "string" && (item.minLength || item.maxLength))
    return [
      `text of ${item.minLength ?? 1} to ${item.maxLength ?? "many"} characters`,
    ];
  return null;
}

const show = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

/** The answer for a call whose arguments failed the schema. Built once per tool, used per call. */
export function invalidInput(ctx) {
  const schemas = new WeakMap();
  return (issues, args, tool) => {
    let json = schemas.get(tool);
    if (!json) {
      json = tool.inputSchema["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      });
      schemas.set(tool, json);
    }
    const known = Object.keys(json.properties ?? {});
    const accepted = {};
    const problems = [];
    const seen = new Set();
    for (const issue of issues) {
      if (issue.code === "unrecognized_keys") {
        for (const k of issue.keys ?? []) {
          if (seen.has(`?${k}`)) continue;
          seen.add(`?${k}`);
          problems.push(
            `"${show(k)}" is not an argument of this tool. Arguments: ${known.join(", ")}.`,
          );
        }
        continue;
      }
      const path = (issue.path ?? []).map(keyName);
      const field = path.find((k) => typeof k === "string") ?? "arguments";
      const node = propertyAt(json, issue.path ?? []);
      const list = acceptedOf(node);
      if (list && list.length > 1 && node.items?.enum) accepted[field] = list;
      else if (list && node?.enum) accepted[field] = list;
      let got = args;
      for (const k of path) got = got?.[k];
      const missing = got === undefined;
      const text = missing
        ? `${path.join(".") || field} is required.`
        : `${path.join(".")}: ${show(got)} cannot be used${list ? `; accepted: ${list.join(", ")}` : `. ${issue.message}`}.`;
      if (!seen.has(text)) {
        seen.add(text);
        problems.push(text);
      }
    }
    const message = `These arguments cannot be used as given: ${problems.join(" ")}`;
    const next = [
      ...Object.entries(accepted).map(
        ([k, v]) => `${k} takes: ${v.join(", ")}`,
      ),
      `Call ${tool.name} again with corrected arguments; nothing was searched`,
    ];
    const format = args?.response_format === "json" ? "json" : "markdown";
    return answer({
      outcome: "bad_input",
      code: "invalid",
      message,
      shape: {
        ...emptyOf(tool.outputSchema),
        ...(tool.invalidShape ?? {}),
        ...ctx.citations.envelope(ctx.graph.as_of),
        ...(Object.keys(accepted).length ? { accepted } : {}),
      },
      next,
      format,
      text: [
        "# Arguments not usable",
        "",
        ...problems.map((p) => `- ${p}`),
        "",
        ...next.map((n) => `- ${n}`),
      ].join("\n"),
    });
  };
}
