import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { Envelope, pageSchema, result } from "./common.mjs";

export const changesSince = (ctx) => ({
  name: "dogpolicies_changes_since",
  title: "Changes since a date",
  since: "0.1.0",
  cache: true,
  description: `Everything that changed in the whole data set since a date: verification events and rule changes everywhere, newest first, so an agent can poll cheaply instead of re-reading every record. Each entry names the place, what happened (confirmed, changed, source_gone, blocked, disputed), who checked, and links the record.`,
  inputSchema: z.strictObject({
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Date, YYYY-MM-DD"),
    outcome: z
      .enum(["confirmed", "changed", "source_gone", "blocked", "disputed"])
      .optional()
      .describe("Only events with this outcome"),
    limit: pageSchema.limit,
    offset: pageSchema.offset,
    response_format: pageSchema.response_format,
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    total: z.number(),
    count: z.number(),
    has_more: z.boolean(),
    events: z.array(
      z.looseObject({
        at: z.string(),
        placeId: z.string(),
        outcome: z.string(),
        url: z.string(),
      }),
    ),
    rule_changes: z.array(
      z.looseObject({ date: z.string(), name: z.string(), kind: z.string() }),
    ),
  }),
  annotations: READ_ONLY,
  handler: async ({ since, outcome, limit, offset, response_format }) => {
    let events = ctx.graph.events.filter((e) => e.at >= since);
    if (outcome) events = events.filter((e) => e.outcome === outcome);
    const page = events.slice(offset, offset + limit);
    const ruleChanges = ctx.graph.changes.filter((c) => c.date >= since);
    const hasMore = events.length > offset + page.length;
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      since,
      total: events.length,
      count: page.length,
      offset,
      has_more: hasMore,
      ...(hasMore ? { next_offset: offset + page.length } : {}),
      events: page,
      rule_changes: ruleChanges,
    };
    const lines = [
      `# ${events.length} verification events since ${since}${outcome ? ` (${outcome})` : ""}, ${ruleChanges.length} rule changes`,
      "",
      ...page.map(
        (e) =>
          `- ${e.at} ${e.name}: ${e.outcome.replaceAll("_", " ")} by ${e.by}${e.facts ? ` (${e.facts.join(", ")})` : ""}${e.note ? ` — ${e.note}` : ""} · ${e.url}`,
      ),
      ...(ruleChanges.length
        ? [
            "",
            "Rule changes:",
            ...ruleChanges.map(
              (c) =>
                `- ${c.date} ${c.name}: ${c.kind}${c.field ? ` ${c.field}: "${c.from ?? ""}" -> "${c.to ?? ""}"` : ""}`,
            ),
          ]
        : []),
      ...(hasMore
        ? ["", `More: call again with offset=${data.next_offset}.`]
        : []),
      "",
      ctx.citations.licenseLine,
    ];
    return result(data, response_format, () => lines.join("\n"));
  },
});
