import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import {
  evaluateHotel,
  feeArithmetic as feeMath,
  feeLine,
} from "../vendor/match.mjs";
import {
  ListOutput,
  airportPoint,
  filterByLocation,
  listResponse,
  locationSchema,
  matchesText,
  pageSchema,
  stayCriteriaSchema,
  summary,
} from "./common.mjs";
import { flag, idChoice } from "./tolerant.mjs";
import { parseQuery } from "./query-words.mjs";
import {
  offTopic,
  offTopicFields,
  outsideCoverage,
  outsideFields,
} from "./coverage.mjs";
import { answer, noMatchText } from "./common.mjs";

/** The fee estimate with its arithmetic spelled out, or why it cannot be. */
export const feeArithmetic = (p, est, { dogs, nights }) =>
  feeMath(p.facts.fee?.value, est, { dogs, nights });

/** The shape the vendored matcher reads: answer.status and facts. */
export const forMatcher = (p) => ({
  type: p.type,
  answer: { status: p.status },
  facts: p.facts,
});

export const findHotels = (ctx) => ({
  name: "dogpolicies_find_hotels",
  title: "Find hotels for a dog",
  since: "0.1.0",
  cache: true,
  description: `Will a hotel take my dog, and what will the pet fee come to: a 70 lb Lab under $50, two dogs for three nights near Palm Springs, the Motel 6 in Fresno?
Does the weight, dog-count and fee arithmetic for the stay, hotel by hotel, against each hotel's published pet policy.
Inputs: query (hotel name, city or brand), brand, county without "County", state "CA" or "NV", area (lake-tahoe, big-sur, east-bay), region, or near={lat, lon}; dog_weight_lb, dogs, nights, max_total_fee.
Each hotel is a match, a possible (needs a call: case by case, weight unstated, "up to" fee) or excluded, with the arithmetic spelled out, the source URL and verified date. Amounts are pet fees, never room rates: there are no room prices here.

Examples:
  - "Will a Monterey hotel take my 70 lb Lab for under $50?" -> county="Monterey", dog_weight_lb=70, max_total_fee=50
  - "Two dogs, three nights near Palm Springs" -> near={lat:33.83, lon:-116.55}, dogs=2, nights=3
  - "Is the Motel 6 in Fresno dog friendly?" -> query="Motel 6 Fresno"
  - "A hotel near LAX for my dog" -> query="LAX" (an airport code or name searches 5 miles around the airport)
  - "A Las Vegas hotel for my 60 lb dog" -> county="Clark", state="NV", dog_weight_lb=60`,
  inputSchema: z.strictObject({
    query: z
      .string()
      .min(2)
      .max(100)
      .optional()
      .describe(
        'Words in the hotel name, city or brand; or an airport code or name ("LAX", "Harry Reid") for hotels within 5 miles of it',
      ),
    brand: idChoice(
      ctx.graph.brandIds,
      Object.fromEntries(
        ctx.graph.brands.map((b) => [
          b.id,
          [b.name, b.name.replace(/ by .*$/, "")],
        ]),
      ),
    )
      .optional()
      .describe("Only this hotel brand"),
    ...stayCriteriaSchema,
    include_possible: flag(true).describe(
      "Include hotels that need a call to confirm",
    ),
    ...locationSchema(ctx.graph),
    ...pageSchema,
  }),
  outputSchema: ListOutput("hotels", {
    counts: z.record(z.string(), z.number()),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const {
      query,
      brand,
      dog_weight_lb,
      dogs,
      nights,
      max_total_fee,
      include_possible,
      limit,
      offset,
      response_format,
    } = args;
    const today = ctx.today();
    // a query that is exactly an airport ("LAX", "Harry Reid") is a place: hotels within its radius
    const airport = !args.near && query ? airportPoint(query) : null;
    let hotels = ctx.graph.places.filter(
      (p) => p.type === "lodging" && (airport || matchesText(p, query)),
    );
    if (brand) hotels = hotels.filter((p) => p.brand_id === brand);
    const located = filterByLocation(
      hotels,
      airport ? { ...args, near: airport } : args,
    );
    const criteria = {
      weightLb: dog_weight_lb,
      dogs,
      nights,
      maxTotalFee: max_total_fee,
    };
    const counts = { match: 0, possible: 0, excluded: 0 };
    const rank = { match: 0, possible: 1 };
    const evaluated = located
      .map(({ place, distance }) => ({
        p: place,
        distance,
        r: evaluateHotel(forMatcher(place), criteria),
      }))
      .filter(({ r }) => {
        counts[r.verdict]++;
        return (
          r.verdict === "match" ||
          (include_possible && r.verdict === "possible")
        );
      })
      .sort(
        (a, b) =>
          rank[a.r.verdict] - rank[b.r.verdict] ||
          (a.r.fee?.known ? a.r.fee.amount : Infinity) -
            (b.r.fee?.known ? b.r.fee.amount : Infinity) ||
          (a.distance ?? 0) - (b.distance ?? 0) ||
          a.p.name.localeCompare(b.p.name),
      );
    const page = evaluated
      .slice(offset, offset + limit)
      .map(({ p, r, distance }) =>
        summary(p, today, {
          verdict: r.verdict,
          fee: feeLine(r.fee, { nights }),
          fee_estimate: feeArithmetic(p, r.fee, { dogs, nights }),
          fee_amount: r.fee?.known ? r.fee.amount : null,
          fee_is_maximum: Boolean(r.fee?.upTo),
          reasons: r.reasons,
          ...(distance != null ? { distance_miles: distance } : {}),
        }),
      );
    // No hotel: a query about somewhere outside California and Nevada, or about
    // something other than dogs, is said so.
    if (!located.length) {
      const where = [query && parseQuery(query).name, query, args.county, args.area]
        .filter((t) => typeof t === "string" && t);
      const outside =
        where.map((t) => outsideCoverage(ctx.graph, t)).find(Boolean) ?? null;
      const topic = query ? offTopic(query) : null;
      const fields = topic
        ? offTopicFields(ctx.graph, topic, outside, query)
        : outside
          ? outsideFields(ctx.graph, outside)
          : null;
      if (fields)
        return answer({
          ...fields,
          shape: {
            ...ctx.citations.envelope(ctx.graph.as_of),
            total: 0,
            count: 0,
            offset,
            has_more: false,
            hotels: [],
            counts,
          },
          nearest: fields.nearest.length ? fields.nearest : undefined,
          format: response_format,
          text: noMatchText(ctx, {
            title: fields.title,
            message: fields.message,
            next: fields.next,
          }),
        });
    }
    const asked = [
      dog_weight_lb && `${dog_weight_lb} lb dog`,
      dogs > 1 && `${dogs} dogs`,
      `${nights} night${nights > 1 ? "s" : ""}`,
      max_total_fee != null && `pet fees up to $${max_total_fee}`,
    ].filter(Boolean);
    return listResponse(ctx, {
      format: response_format,
      total: evaluated.length,
      offset,
      items: page,
      key: "hotels",
      header: `# ${counts.match} match, ${counts.possible} possible, ${counts.excluded} excluded (${asked.join(", ")}). Amounts are pet fees, not room rates.`,
      extra: { counts },
    });
  },
});
