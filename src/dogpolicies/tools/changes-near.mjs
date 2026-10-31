import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { Envelope, pageSchema } from "./common.mjs";
import { resolveScope, scopeSchema } from "./scope.mjs";

export const changesNear = (ctx) => ({
  name: "dogpolicies_changes_near",
  title: "What changed near a town",
  since: "0.2.0",
  cache: true,
  description: `Verification events (confirmed, changed, source gone, blocked, disputed) since a date for places within a radius of a town, county or point, newest first. The way to answer "has anything changed around Tahoe since my last trip?" or to re-check a saved itinerary. Use dogpolicies_changes_since for everything everywhere.

Example: "What changed near Monterey since September?" -> place="Monterey", since="2026-09-01"`,
  inputSchema: z.strictObject({
    ...scopeSchema,
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
    label: z.string(),
    radius_miles: z.number(),
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
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = resolveScope(ctx, args);
    if (scope.error) return scope.error;
    const nearby = new Map(
      scope.within(ctx.graph.places).map((x) => [x.place.id, x.distance]),
    );
    let events = ctx.graph.events.filter(
      (e) => e.at >= args.since && nearby.has(e.placeId),
    );
    if (args.outcome) events = events.filter((e) => e.outcome === args.outcome);
    events = events.map((e) => ({
      ...e,
      distance_miles: nearby.get(e.placeId),
    }));
    const page = events.slice(args.offset, args.offset + args.limit);
    const hasMore = events.length > args.offset + page.length;
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      label: scope.label,
      center: scope.center,
      radius_miles: scope.radius,
      since: args.since,
      total: events.length,
      count: page.length,
      offset: args.offset,
      has_more: hasMore,
      ...(hasMore ? { next_offset: args.offset + page.length } : {}),
      events: page,
    };
    const lines = [
      `# ${events.length} verification event${events.length === 1 ? "" : "s"} since ${args.since} within ${scope.radius} miles of ${scope.label}${args.outcome ? ` (${args.outcome})` : ""}`,
      "",
      ...(page.length
        ? page.map(
            (e) =>
              `- ${e.at} ${e.name} (${e.distance_miles} mi): ${e.outcome.replaceAll("_", " ")} by ${e.by}${e.facts ? ` (${e.facts.join(", ")})` : ""}${e.note ? ` — ${e.note}` : ""} · ${e.url}`,
          )
        : [
            "No events in this area since that date: the records there were not re-checked or changed.",
          ]),
      ...(hasMore
        ? ["", `More: call again with offset=${data.next_offset}.`]
        : []),
      "",
      ctx.citations.licenseLine,
    ];
    return result(data, args.response_format, () => lines.join("\n"));
  },
});
