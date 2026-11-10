import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { Envelope, OutcomeFields, pageSchema } from "./common.mjs";
import {
  CorrectionsFields,
  correctionLines,
  loadCorrections,
} from "./corrections.mjs";
import { scopeAnswer, scopeSchema } from "./scope.mjs";
import { OUTCOME_SYNONYMS, choice, dateInput } from "./tolerant.mjs";
import { resolveChangeScope, ruleChangesIn } from "./change-scope.mjs";

const num = () => z.coerce.number();

export const changesNear = (ctx) => ({
  name: "dogpolicies_changes_near",
  title: "What changed near a town",
  since: "0.2.0",
  // Not memoized: the corrections it lists are live.
  description: `Has anything changed around where I am going since my last trip or since a date: a fee, a leash rule, a closure?
Re-checks a saved itinerary or a destination: one area, one place or one stretch of highway.
Inputs: place (city, county, neighborhood, area or region: "Tahoe", "Alameda", "Monterey") or near={lat, lon}, with radius_miles; or place_id for one place; or route (i-5, us-101, highway-1 ...) with from_mile and to_mile for the listed stops on that stretch. since as YYYY-MM-DD; optional outcome (confirmed, changed, source_gone, blocked, disputed).
Returns verification events for places in scope, newest first, each with the place, outcome, date and record link, the rule-change log entries for them, and on the hosted server a separate corrections list (corrections filed for those places or decided since the date, by ticket id and status). An empty list means nothing was re-checked or changed in that window; an unknown name is an answer with did_you_mean.

Example: "What changed near Monterey since September?" -> place="Monterey", since="2026-09-01"`,
  inputSchema: z.strictObject({
    ...scopeSchema,
    place_id: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .describe(
        'One place by its id from any answer, e.g. "carmel-beach": changes for that place alone',
      ),
    route: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        'A highway, e.g. "i-5", "us-101", "highway-1" or "i-80-nevada": changes at the listed stops on that highway',
      ),
    from_mile: num()
      .min(0)
      .max(1000)
      .optional()
      .describe("With route: start of the stretch, in route miles"),
    to_mile: num()
      .min(0)
      .max(1000)
      .optional()
      .describe("With route: end of the stretch, in route miles"),
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
    ...OutcomeFields,
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
    rule_changes: z
      .array(
        z.looseObject({ date: z.string(), name: z.string(), kind: z.string() }),
      )
      .optional()
      .describe(
        "The rule-change log for places in scope (and the chain of a hotel in scope) since the date",
      ),
    scope_kind: z
      .enum(["town", "area", "point", "place", "route"])
      .optional()
      .describe(
        "What the scope is: a town or county with a radius, an area's own places, a point, one place, or a highway's stops",
      ),
    page_url: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The page for the scope: the place's record or the road-trip guide",
      ),
    ...CorrectionsFields,
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = await resolveChangeScope(ctx, args);
    if (scope.noMatch)
      return scopeAnswer(ctx, scope.noMatch, {
        format: args.response_format,
        shape: {
          label: args.place_id ?? args.route ?? args.place ?? "",
          radius_miles: args.radius_miles ?? 15,
          since: args.since,
          total: 0,
          count: 0,
          offset: args.offset,
          has_more: false,
          events: [],
        },
      });
    const members = scope.members;
    // place id -> distance in miles, for the corrections list (as before)
    const nearby = new Map(
      [...members].map(([id, m]) => [
        id,
        m.distance_miles ?? m.off_route_miles ?? 0,
      ]),
    );
    let events = ctx.graph.events.filter(
      (e) => e.at >= args.since && members.has(e.placeId),
    );
    if (args.outcome) events = events.filter((e) => e.outcome === args.outcome);
    events = events.map((e) => ({ ...e, ...members.get(e.placeId) }));
    const ruleChanges = ruleChangesIn(ctx, members, args.since);
    const page = events.slice(args.offset, args.offset + args.limit);
    const hasMore = events.length > args.offset + page.length;
    const corr = await loadCorrections(ctx, {
      since: args.since,
      placeIds: nearby,
    });
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      label: scope.label,
      center: scope.center,
      radius_miles: scope.radius,
      scope_kind: scope.kind,
      ...(scope.kind === "place" ? { place_id: scope.place.id } : {}),
      ...(scope.kind === "route"
        ? {
            route: scope.route,
            from_mile: scope.from_mile,
            to_mile: scope.to_mile,
          }
        : {}),
      page_url: scope.page_url,
      since: args.since,
      total: events.length,
      count: page.length,
      offset: args.offset,
      has_more: hasMore,
      ...(hasMore ? { next_offset: args.offset + page.length } : {}),
      events: page,
      rule_changes: ruleChanges,
      ...corr,
    };
    const where =
      scope.kind === "place"
        ? `at ${scope.label}`
        : scope.kind === "route"
          ? `at the stops on ${scope.label}`
          : `within ${scope.radius} miles of ${scope.label}`;
    const off = (e) =>
      e.mile != null
        ? ` (mile ${e.mile})`
        : e.distance_miles != null && scope.kind !== "place"
          ? ` (${e.distance_miles} mi)`
          : "";
    const lines = [
      `# ${events.length} verification event${events.length === 1 ? "" : "s"} since ${args.since} ${where}${args.outcome ? ` (${args.outcome})` : ""}`,
      "",
      ...(page.length
        ? page.map(
            (e) =>
              `- ${e.at} ${e.name}${off(e)}: ${e.outcome.replaceAll("_", " ")} by ${e.by}${e.facts ? ` (${e.facts.join(", ")})` : ""}${e.note ? ` — ${e.note}` : ""} · ${e.url}`,
          )
        : [
            "No events in this area since that date: the records there were not re-checked or changed.",
          ]),
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
    return result(data, args.response_format, () => lines.join("\n"));
  },
});
