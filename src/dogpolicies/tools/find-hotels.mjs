import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { evaluateHotel, feeLine } from "../vendor/match.mjs";
import {
  ListOutput,
  filterByLocation,
  listResponse,
  locationSchema,
  matchesText,
  pageSchema,
  stayCriteriaSchema,
  summary,
} from "./common.mjs";

const PER_PET = ["per_pet_per_night", "per_pet_per_stay", "per_pet"];
const PER_NIGHT = ["per_night", "per_pet_per_night", "per_room_per_night"];

/** The fee estimate with its arithmetic spelled out, or why it cannot be. */
export function feeArithmetic(p, est, { dogs, nights }) {
  const fee = p.facts.fee?.value;
  if (!fee) return "No fee stated in the policy.";
  if (!est?.known) return est?.note ?? "Not settled by the policy.";
  if (fee.amount === 0) return "No pet fee.";
  const perPet = PER_PET.includes(fee.basis);
  const perNight = PER_NIGHT.includes(fee.basis);
  const terms = [
    perPet && dogs > 1 ? `${dogs} dogs` : null,
    perNight && nights > 1 ? `${nights} nights` : null,
    `$${fee.amount} ${fee.basis.replaceAll("_", " ")}`,
  ].filter(Boolean);
  const raw = fee.amount * (perPet ? dogs : 1) * (perNight ? nights : 1);
  let line = `${terms.join(" x ")} = $${raw}`;
  if (fee.capPerStay != null && raw > fee.capPerStay)
    line += `, capped at $${fee.capPerStay} per stay = $${est.amount}`;
  if (est.upTo)
    line = `Up to ${line.charAt(0).toLowerCase()}${line.slice(1)} (the policy states a maximum)`;
  return `${line}.`;
}

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
  description: `Find hotels and motels in California and Nevada that will take a specific dog, with the estimated pet fee for the stay.

Every amount is the hotel's pet fee, never the room rate: DogPolicies has no room prices.

Each hotel is sorted into "match" (the policy says yes on everything asked), "possible" (nothing rules it out, but something needs a call: a hotel that decides case by case, an unstated weight limit, a limit the hotel lifts with its approval, an "up to" fee) or excluded (left out). Matches come first, cheapest pet fee first. The fee arithmetic is spelled out for every result.

Examples:
  - "Will a Monterey hotel take my 70 lb Lab for under $50?" -> county="Monterey", dog_weight_lb=70, max_total_fee=50
  - "Two dogs, three nights near Palm Springs" -> near={lat:33.83, lon:-116.55}, dogs=2, nights=3
  - "Is the Motel 6 in Fresno dog friendly?" -> query="Motel 6 Fresno"
  - "A Las Vegas hotel for my 60 lb dog" -> county="Clark", state="NV", dog_weight_lb=60`,
  inputSchema: z.strictObject({
    query: z
      .string()
      .min(2)
      .max(100)
      .optional()
      .describe("Words in the hotel name, city or brand"),
    brand: z
      .enum(ctx.graph.brandIds)
      .optional()
      .describe("Only this hotel brand"),
    ...stayCriteriaSchema,
    include_possible: z
      .boolean()
      .default(true)
      .describe("Include hotels that need a call to confirm"),
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
    let hotels = ctx.graph.places.filter(
      (p) => p.type === "lodging" && matchesText(p, query),
    );
    if (brand) hotels = hotels.filter((p) => p.brand_id === brand);
    const located = filterByLocation(hotels, args);
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
