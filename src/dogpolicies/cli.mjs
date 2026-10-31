// The terminal commands: `demo` prints one real, cited answer so a person
// sees what the server gives a model; `check` calls every tool once and
// exits non-zero if any fails, for a quick health check after install.

import { connectInProcess } from "./connect.mjs";

const print = (s) => process.stdout.write(s + "\n");

/** Example calls, one per tool, with arguments that return results today. */
export const EXAMPLE_CALLS = [
  ["dogpolicies_search_places", { query: "Carmel", limit: 3 }],
  ["dogpolicies_get_place", { id: "carmel-beach" }],
  [
    "dogpolicies_find_hotels",
    { county: "Monterey", dog_weight_lb: 70, nights: 2, limit: 3 },
  ],
  ["dogpolicies_get_brand_policy", { brand: "motel-6" }],
  ["dogpolicies_browse_answers", { limit: 5 }],
  [
    "dogpolicies_route_stops",
    { route: "i-5", from_mile: 170, to_mile: 222, limit: 5 },
  ],
  ["dogpolicies_changes_since", { since: "2026-01-01", limit: 3 }],
];

export async function runCheck(ctx) {
  const { client, close } = await connectInProcess(ctx);
  let failed = 0;
  try {
    const { tools } = await client.listTools();
    print(
      `${tools.length} tools; ${ctx.graph.places.length} places; data of ${ctx.graph.as_of} (${ctx.source.origin})`,
    );
    for (const [name, args] of EXAMPLE_CALLS) {
      const started = performance.now();
      const r = await client.callTool({ name, arguments: args });
      const ms = (performance.now() - started).toFixed(0);
      const ok = !r.isError;
      if (!ok) failed++;
      print(
        `${ok ? "ok  " : "FAIL"} ${name} ${ms} ms${ok ? "" : `: ${r.content?.[0]?.text}`}`,
      );
    }
    // The rule lookup needs an id from a record; take one from the detail call.
    const detail = await client.callTool({
      name: "dogpolicies_get_place",
      arguments: { id: "carmel-beach", response_format: "json" },
    });
    const ruleId = detail.structuredContent?.rule_records?.[0]?.id;
    const rule = await client.callTool({
      name: "dogpolicies_get_rule",
      arguments: { id: ruleId ?? "rul_x_y" },
    });
    if (rule.isError) failed++;
    print(`${rule.isError ? "FAIL" : "ok  "} dogpolicies_get_rule (${ruleId})`);
    print(
      `dogpolicies_report_correction: ${ctx.report ? "would post to " + ctx.config.baseUrl : "no site configured or offline, returns the web form URL"} (not called)`,
    );
  } finally {
    await close();
  }
  print(failed ? `${failed} failed` : "all tools answered");
  return failed ? 1 : 0;
}

export async function runDemo(ctx, query) {
  const { client, close } = await connectInProcess(ctx);
  try {
    const q = query?.trim() || "";
    print(
      q
        ? `Question: can my 70 lb dog stay at a hotel in or near "${q}", and what will it cost for 2 nights?`
        : "Question: where can my dog go off leash on a beach near San Diego?",
    );
    print("");
    const r = q
      ? await client.callTool({
          name: "dogpolicies_find_hotels",
          arguments: { query: q, dog_weight_lb: 70, nights: 2, limit: 5 },
        })
      : await client.callTool({
          name: "dogpolicies_search_places",
          arguments: {
            type: "beach",
            off_leash: true,
            near: { lat: 32.72, lon: -117.16, radius_miles: 25 },
            limit: 5,
          },
        });
    print(r.content[0].text);
    print("");
    print(
      `That is the exact text an AI assistant receives. ${ctx.graph.places.length} places, data of ${ctx.graph.as_of}.`,
    );
  } finally {
    await close();
  }
  return 0;
}
