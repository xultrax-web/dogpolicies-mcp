import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { Envelope, pageSchema, result } from "./common.mjs";
import {
  CorrectionsFields,
  correctionLines,
  loadCorrections,
} from "./corrections.mjs";
import { OUTCOME_SYNONYMS, choice, dateInput } from "./tolerant.mjs";

export const changesSince = (ctx) => ({
  name: "dogpolicies_changes_since",
  title: "Changes since a date",
  since: "0.1.0",
  // Not memoized: the corrections it lists are live.
  description: `What changed in the dog rules anywhere since a date: which fees, leash rules or closures were updated or found gone?
A cheap poll for new changes across all the data, without re-reading records.
Input: since as YYYY-MM-DD; optional outcome (confirmed, changed, source_gone, blocked, disputed), for example "changed" for only real rule changes.
Returns events newest first, each naming the place, what happened, who checked, the date and a link to the record. On the hosted server a separate corrections list shows corrections people filed or whose status changed since the date: ticket id, place, kind of fact, status (filed, verified, rejected), dates and a status_url; what the reporter wrote is never included.`,
  inputSchema: z.strictObject({
    since: z
      .preprocess(dateInput, z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .describe("Date, YYYY-MM-DD"),
    outcome: choice(
      ["confirmed", "changed", "source_gone", "blocked", "disputed"],
      OUTCOME_SYNONYMS,
    )
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
    ...CorrectionsFields,
  }),
  annotations: READ_ONLY,
  handler: async ({ since, outcome, limit, offset, response_format }) => {
    let events = ctx.graph.events.filter((e) => e.at >= since);
    if (outcome) events = events.filter((e) => e.outcome === outcome);
    const page = events.slice(offset, offset + limit);
    const ruleChanges = ctx.graph.changes.filter((c) => c.date >= since);
    const hasMore = events.length > offset + page.length;
    const corr = await loadCorrections(ctx, { since });
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
      ...corr,
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
      ...correctionLines(corr),
      ...(hasMore
        ? ["", `More: call again with offset=${data.next_offset}.`]
        : []),
      "",
      ctx.citations.licenseLine,
    ];
    return result(data, response_format, () => lines.join("\n"));
  },
});
