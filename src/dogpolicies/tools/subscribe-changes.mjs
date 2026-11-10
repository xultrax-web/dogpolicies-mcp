import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import {
  Envelope,
  OutcomeFields,
  answer,
  noMatchText,
  pageSchema,
} from "./common.mjs";
import { changesNear } from "./changes-near.mjs";
import { resolveRoute, resolvePlace } from "./change-scope.mjs";
import { resolveScope } from "./scope.mjs";
import { daysBefore, feedUrls, townSlug } from "../feed-urls.mjs";

const num = () => z.coerce.number();
export const WINDOW_DAYS = 90;

export const subscribeChanges = (ctx) => ({
  name: "dogpolicies_subscribe_changes",
  title: "Follow rule changes in a feed",
  since: "0.5.0",
  // Not memoized: the counts include live corrections.
  description: `Can you tell me if the dog rules change at Carmel Beach before our trip? Can I follow changes near Lake Tahoe, or along I-5?
For hearing about changes later, without asking again: it answers with a feed link (Atom and JSON Feed) for one place, a town, county, area or neighborhood with a radius, or a highway's stops, which any feed reader can follow. It computes the links and counts only; it signs nobody up, stores nothing and sends no email.
Inputs: one of place (a place id from any answer, e.g. "carmel-beach"), near (a town, county, area, region or neighborhood, e.g. "Lake Tahoe", "Monterey", "Van Nuys") with radius_miles, or route (i-5, us-101, highway-1, i-15, i-80, us-50, or a Nevada route ending in -nevada) with from_mile and to_mile.
Returns atom_url and json_url, how many verification events, rule changes and corrections the scope had in the last 90 days, the page for the scope, and share_text: a sentence with the link, written for the traveler. An unknown name is an answer with did_you_mean.

Examples:
  - "Tell me if the rules change at Carmel Beach" -> place="carmel-beach"
  - "Can I get alerts for dog rule changes around Lake Tahoe?" -> near="Lake Tahoe"
  - "Follow changes on the Grapevine stretch of I-5" -> route="i-5", from_mile=170, to_mile=222`,
  inputSchema: z.strictObject({
    place: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .describe(
        'One place by its id from any answer, e.g. "carmel-beach" (a close name is matched and labeled)',
      ),
    near: z
      .string()
      .min(2)
      .max(80)
      .optional()
      .describe(
        'A city, county, area, region or neighborhood in California or Nevada, e.g. "Lake Tahoe", "Monterey", "Washoe County, NV", "Van Nuys"',
      ),
    radius_miles: num()
      .min(1)
      .max(100)
      .default(15)
      .describe(
        "With near: miles around the town (an area or region is its own boundary; the radius is ignored)",
      ),
    route: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe('A highway, e.g. "i-5", "us-101", "highway-1", "i-80-nevada"'),
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
    response_format: pageSchema.response_format,
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    ...OutcomeFields,
    scope: z
      .looseObject({ kind: z.string(), id: z.string(), label: z.string() })
      .nullable()
      .describe(
        "What the feed follows: place, near or route, its id and label",
      ),
    atom_url: z.string().nullable().describe("The Atom 1.0 feed for the scope"),
    json_url: z
      .string()
      .nullable()
      .describe("The JSON Feed 1.1 feed for the scope"),
    page_url: z
      .string()
      .nullable()
      .describe(
        "The page for the scope (the place's record or the road-trip guide), when there is one",
      ),
    last_90_days: z
      .looseObject({
        since: z.string(),
        verification_events: z.number(),
        rule_changes: z.number(),
        corrections: z.number(),
      })
      .nullable()
      .describe(
        "Activity in the scope over the last 90 days: verification events (re-checks included), rule changes (events whose outcome is changed, plus the rule-change log) and correction tickets (the hosted server only)",
      ),
    share_text: z
      .string()
      .nullable()
      .describe("A sentence with the feed link, written for the traveler"),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const g = ctx.graph;
    const envelope = ctx.citations.envelope(g.as_of);
    const empty = {
      ...envelope,
      scope: null,
      atom_url: null,
      json_url: null,
      page_url: null,
      last_90_days: null,
      share_text: null,
    };
    const given = ["place", "near", "route"].filter((k) => args[k] != null);
    if (given.length !== 1) {
      const message =
        given.length === 0
          ? "Give one of place (a place id), near (a town, county, area or region) or route (a highway)."
          : `Give one of place, near or route; this call gave ${given.join(" and ")}.`;
      const next = [
        'place="carmel-beach" to follow one place',
        'near="Lake Tahoe" (radius_miles for a town) to follow an area',
        'route="i-5" with from_mile and to_mile to follow a stretch of highway',
      ];
      return answer({
        outcome: "bad_input",
        code: "invalid",
        message,
        shape: empty,
        did_you_mean: [],
        next,
        format: args.response_format,
        text: noMatchText(ctx, {
          title: "Which changes to follow",
          message,
          next,
        }),
      });
    }
    // The scope in the feed's terms, resolved by the same functions changes_near uses.
    let scope = null;
    let changeArgs = null;
    if (args.place != null) {
      const hit = resolvePlace(g, args.place);
      if (hit) {
        scope = { kind: "place", id: hit.place.id };
        changeArgs = { place_id: hit.place.id };
      } else changeArgs = { place_id: args.place };
    } else if (args.route != null) {
      const id = resolveRoute(g, args.route);
      changeArgs = {
        route: id ?? args.route,
        ...(args.from_mile != null ? { from_mile: args.from_mile } : {}),
        ...(args.to_mile != null ? { to_mile: args.to_mile } : {}),
      };
      if (id)
        scope = {
          kind: "route",
          id,
          from: args.from_mile ?? null,
          to: args.to_mile ?? null,
        };
    } else {
      const town = resolveScope(ctx, { place: args.near }).town ?? null;
      const isArea = town?.kind === "area" || town?.kind === "region";
      changeArgs = { place: args.near, radius_miles: args.radius_miles };
      if (town)
        scope = {
          kind: "near",
          id: townSlug(town),
          radius: isArea ? null : args.radius_miles,
        };
    }
    // The counts are the changes_near answer for the scope over 90 days.
    const tool = changesNear(ctx);
    const since = daysBefore(ctx.today(), WINDOW_DAYS);
    const out = (
      await tool.handler(
        tool.inputSchema.parse({
          ...changeArgs,
          since,
          limit: 1,
          response_format: "json",
        }),
      )
    ).structuredContent;
    if (out.outcome || !scope) {
      const message = out.message ?? "That scope is not in the data.";
      return answer({
        outcome: out.outcome ?? "no_match",
        code: out.code ?? "not_found",
        message,
        shape: empty,
        did_you_mean: out.did_you_mean ?? [],
        next: out.next ?? [],
        format: args.response_format,
        text: noMatchText(ctx, {
          title: "No feed for that scope",
          message,
          did_you_mean: out.did_you_mean ?? [],
          next: out.next ?? [],
        }),
      });
    }
    const urls = feedUrls(g.site.url, scope);
    const changed =
      (await changedCount(tool, changeArgs, since)) +
      (out.rule_changes ?? []).length;
    const last = {
      since,
      verification_events: out.total ?? 0,
      rule_changes: changed,
      corrections: out.corrections_total ?? 0,
    };
    // The label without the "(closest match to …)" note, which goes in its own field.
    const note = out.label.match(/ \(closest match to "(.*)"\)$/);
    const label = note ? out.label.slice(0, note.index) : out.label;
    const where =
      scope.kind === "place"
        ? `at ${label}`
        : scope.kind === "route"
          ? `along ${label}`
          : out.scope_kind === "area"
            ? `in ${label}`
            : `near ${label}`;
    const share_text = `Add this link to any feed reader to hear when a dog rule changes ${where}: ${urls.atom}`;
    const data = {
      ...envelope,
      scope: {
        kind: scope.kind,
        id: scope.id,
        label,
        ...(note ? { corrected_from: note[1] } : {}),
        ...(scope.kind === "near" && scope.radius != null
          ? { radius_miles: scope.radius }
          : {}),
        ...(scope.kind === "route"
          ? { from_mile: scope.from, to_mile: scope.to }
          : {}),
      },
      atom_url: urls.atom,
      json_url: urls.json,
      page_url: out.page_url ?? null,
      last_90_days: last,
      share_text,
      ...(out.corrections_note
        ? { corrections_note: out.corrections_note }
        : {}),
    };
    const lines = [
      `# Follow dog rule changes ${where}`,
      "",
      ...(note ? [`(The closest match to "${note[1]}".)`, ""] : []),
      share_text,
      "",
      `- Atom: ${urls.atom}`,
      `- JSON Feed: ${urls.json}`,
      ...(data.page_url ? [`- Page: ${data.page_url}`] : []),
      "",
      `Last 90 days (since ${since}): ${last.verification_events} verification event${last.verification_events === 1 ? "" : "s"}, ${last.rule_changes} rule change${last.rule_changes === 1 ? "" : "s"}, ${out.corrections_note ? "corrections listed on the hosted server only" : `${last.corrections} correction${last.corrections === 1 ? "" : "s"}`}.`,
      "",
      "The feed is computed each time a reader asks for it, from the official-source records; nothing about the reader is stored, and there is no account or email.",
      "",
      ctx.citations.licenseLine,
    ];
    return result(data, args.response_format, () => lines.join("\n"));
  },
});

/** Events whose outcome is "changed" in the window: one more call of the same handler. */
async function changedCount(tool, changeArgs, since) {
  const out = (
    await tool.handler(
      tool.inputSchema.parse({
        ...changeArgs,
        since,
        outcome: "changed",
        limit: 1,
        response_format: "json",
      }),
    )
  ).structuredContent;
  return out.total ?? 0;
}
