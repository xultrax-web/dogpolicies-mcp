import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import { evaluateHotel, feeLine } from "../vendor/match.mjs";
import { isStay } from "../stay.mjs";
import { feeArithmetic, forMatcher } from "./find-hotels.mjs";
import {
  Envelope,
  OSM_ATTRIBUTION,
  PlaceItem,
  stayCriteriaSchema,
  summary,
  summaryLine,
} from "./common.mjs";
import { resolveScope, scopeSchema } from "./scope.mjs";

const OUTINGS = [
  ["beach", "Beaches"],
  ["park", "Parks"],
  ["trail", "Trails"],
  ["restaurant", "Places to eat and drink"],
];

export const planTrip = (ctx) => ({
  name: "dogpolicies_plan_trip",
  title: "Plan a trip with a dog",
  since: "0.2.0",
  cache: true,
  description: `Plan a stay in a California or Nevada town with a dog, in one call: where to stay (hotels, campgrounds and cabins that will take this dog, with the pet fee for the whole stay worked out), what to do (beaches, parks and trails that allow dogs, nearest first) and where to eat (patios that take dogs), every item with its citation.

Inputs: the town or county and the dog: weight, how many dogs, nights, and the most the user will pay in pet fees.

Examples:
  - "Three nights in Monterey with our 70 lb Lab, pet fees under $100" -> place="Monterey", dog_weight_lb=70, nights=3, max_total_fee=100
  - "A weekend in South Lake Tahoe with two small dogs" -> place="South Lake Tahoe", dogs=2, nights=2
  - "Camping near Mammoth Lakes with a dog" -> place="Mono County", stay_types=["campground","cabins"]`,
  inputSchema: z.strictObject({
    ...scopeSchema,
    ...stayCriteriaSchema,
    stay_types: z
      .array(z.enum(["lodging", "campground", "cabins"]))
      .min(1)
      .default(["lodging", "campground", "cabins"])
      .describe("Kinds of stay to consider"),
    include_possible: z
      .boolean()
      .default(true)
      .describe("Include stays that need a call to confirm"),
    per_section: z
      .number()
      .int()
      .min(1)
      .max(15)
      .default(5)
      .describe("Results per section"),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("'markdown' for readable text, 'json' for structured data"),
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    label: z.string(),
    radius_miles: z.number(),
    asked: z.looseObject({ dogs: z.number(), nights: z.number() }),
    stays: z.array(PlaceItem),
    stay_counts: z.record(z.string(), z.number()),
    outings: z.array(
      z.looseObject({
        type: z.string(),
        label: z.string(),
        total: z.number(),
        places: z.array(PlaceItem),
      }),
    ),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = resolveScope(ctx, args);
    if (scope.error) return scope.error;
    const today = ctx.today();
    const { dog_weight_lb, dogs, nights, max_total_fee } = args;
    const criteria = {
      weightLb: dog_weight_lb,
      dogs,
      nights,
      maxTotalFee: max_total_fee,
    };
    const found = scope.within(ctx.graph.places);
    const counts = { match: 0, possible: 0, excluded: 0 };
    const rank = { match: 0, possible: 1 };
    const stays = found
      .filter((x) => isStay(x.place) && args.stay_types.includes(x.place.type))
      .map((x) => ({ ...x, r: evaluateHotel(forMatcher(x.place), criteria) }))
      .filter((x) => {
        counts[x.r.verdict]++;
        return (
          x.r.verdict === "match" ||
          (args.include_possible && x.r.verdict === "possible")
        );
      })
      .sort(
        (a, b) =>
          rank[a.r.verdict] - rank[b.r.verdict] ||
          (a.r.fee?.known ? a.r.fee.amount : Infinity) -
            (b.r.fee?.known ? b.r.fee.amount : Infinity) ||
          a.distance - b.distance,
      )
      .slice(0, args.per_section)
      .map((x) =>
        summary(x.place, today, {
          verdict: x.r.verdict,
          fee: feeLine(x.r.fee, { nights }),
          fee_estimate: feeArithmetic(x.place, x.r.fee, { dogs, nights }),
          fee_amount: x.r.fee?.known ? x.r.fee.amount : null,
          reasons: x.r.reasons,
          distance_miles: x.distance,
        }),
      );
    const outings = OUTINGS.map(([type, label]) => {
      const all = found.filter(
        (x) => x.place.type === type && x.place.status !== "no",
      );
      return {
        type,
        label,
        total: all.length,
        places: all
          .slice(0, args.per_section)
          .map((x) => summary(x.place, today, { distance_miles: x.distance })),
      };
    }).filter((g) => g.total > 0);
    const shown = [...stays, ...outings.flatMap((g) => g.places)];
    const askedWords = [
      dog_weight_lb && `${dog_weight_lb} lb dog`,
      dogs > 1 && `${dogs} dogs`,
      `${nights} night${nights > 1 ? "s" : ""}`,
      max_total_fee != null && `pet fees up to $${max_total_fee}`,
    ].filter(Boolean);
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      label: scope.label,
      center: scope.center,
      radius_miles: scope.radius,
      asked: {
        dog_weight_lb: dog_weight_lb ?? null,
        dogs,
        nights,
        max_total_fee: max_total_fee ?? null,
      },
      stays,
      stay_counts: counts,
      outings,
      ...(shown.some((s) => s.osm) ? { attribution: OSM_ATTRIBUTION } : {}),
    };
    return result(data, args.response_format, () => {
      const lines = [
        `# A trip to ${scope.label} with a dog (${askedWords.join(", ")}; within ${scope.radius} miles)`,
        "",
        `## Where to stay: ${counts.match} match, ${counts.possible} possible, ${counts.excluded} excluded`,
        "",
        ...(stays.length
          ? stays.map(summaryLine)
          : ["No stays in the data fit; widen radius_miles or drop a filter."]),
      ];
      for (const g of outings) {
        lines.push(
          "",
          `## ${g.label} (${g.total})`,
          "",
          ...g.places.map(summaryLine),
        );
      }
      if (!outings.length)
        lines.push(
          "",
          "No beaches, parks, trails or patios with dog rules in the data near here yet.",
        );
      lines.push(...ctx.citations.footer(shown, { osmLine: OSM_ATTRIBUTION }));
      const text = lines.join("\n");
      return text.length <= LIMITS.resultCharacters
        ? text
        : text.slice(0, LIMITS.resultCharacters - 80) +
            "\n\n(Trimmed; ask for a smaller per_section.)";
    });
  },
});
