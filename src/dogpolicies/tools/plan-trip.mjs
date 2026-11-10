import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import { evaluateHotel, feeLine } from "../vendor/match.mjs";
import { isStay } from "../stay.mjs";
import {
  MAX_DAYS,
  placeRef,
  planDays,
  planMarkdown,
  stayPlan,
} from "../trip.mjs";
import { isIsoDate, tripUrl } from "../vendor/trip-link.mjs";
import { feeArithmetic, forMatcher } from "./find-hotels.mjs";
import {
  Envelope,
  OSM_ATTRIBUTION,
  OutcomeFields,
  PlaceItem,
  formatSchema,
  nearestTowns,
  stayCriteriaSchema,
  suggestionLines,
  summary,
  summaryLine,
} from "./common.mjs";
import { resolveScope, scopeAnswer, scopeSchema } from "./scope.mjs";
import { KIND_SYNONYMS, choiceList, flag } from "./tolerant.mjs";
import {
  I5,
  MILE_M,
  axisFields,
  axisOf,
  isFamilyStop,
  pairLine,
  pairRow,
  pairedIn,
  positionOf,
  windowStops,
} from "../i5.mjs";
import { closedNowOf, closuresFor } from "./conditions-source.mjs";
import { closureLine } from "../vendor/closures.mjs";

// A trip within this many miles of I-5 in California gets the corridor leg.
const I5_REACH_MILES = 10;
const I5_LEG_MILES = 60;

const SlotRef = z.looseObject({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  url: z.string(),
  rule: z.string(),
  quote: z.string().nullable(),
  source_url: z.string().nullable(),
  verified_at: z.string(),
  distance_mi: z.number().nullable(),
});

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
  // The I-5 leg skips rest areas Caltrans reports closed (a live feed): an answer holds five minutes.
  cacheTtlMs: 5 * 60_000,
  description: `Plan a dog trip to a town: where can we stay with this dog, what is the pet fee for all the nights, what can we do each day, where can we eat?
One answer covers a whole stay, such as "three nights in Monterey with our 70 lb Lab, pet fees under $150" or "camping near Mammoth Lakes".
Inputs: place (a city, county, neighborhood, area or region, with small spelling slips corrected) or near={lat, lon}; dog_weight_lb, dogs, nights, max_total_fee, stay_types. Optional: start_date (dates each day), stay_id (build the plan on that stay), save=true (adds trip_url, a dogpolicies.com page showing the plan; the plan travels inside the link, nothing is stored).
Returns stays that fit with the whole-stay pet fee worked out (a pet fee, never a room rate), stays that need a call to confirm, and "days": for each night the stay, a morning beach, trail or off-leash area, an afternoon park and a dinner patio, each a real record with source URL and verified date; a slot the data cannot fill is null with the reason (dinner often is). "plan_stay" shows the fee arithmetic and whether the dog's weight and number fit. Within 10 miles of I-5 in California it adds the drive leg: the town's mile and the next family stops each way. An unknown town is an answer with did_you_mean. The markdown answer is laid out as a trip document for the traveler.

Examples:
  - "Three nights in Monterey with our 70 lb Lab, pet fees under $100" -> place="Monterey", dog_weight_lb=70, nights=3, max_total_fee=100
  - "A weekend in South Lake Tahoe with two small dogs" -> place="South Lake Tahoe", dogs=2, nights=2
  - "Camping near Mammoth Lakes with a dog" -> place="Mono County", stay_types=["campground","cabins"]
  - "Plan 4 nights in Carmel with two dogs and give me a link" -> place="Carmel-by-the-Sea", dogs=2, nights=4, save=true`,
  inputSchema: z.strictObject({
    ...scopeSchema,
    ...stayCriteriaSchema,
    stay_types: choiceList(
      ["lodging", "campground", "cabins"],
      KIND_SYNONYMS,
      [],
      ["lodging", "campground", "cabins"],
    ).describe("Kinds of stay to consider"),
    include_possible: flag(true).describe(
      "Include stays that need a call to confirm",
    ),
    per_section: z.coerce
      .number()
      .int()
      .min(1)
      .max(15)
      .default(5)
      .describe("Results per section"),
    start_date: z
      .string()
      .refine(isIsoDate, "Use a real date as YYYY-MM-DD")
      .optional()
      .describe(
        "First night, YYYY-MM-DD; each day of the plan then carries its date",
      ),
    stay_id: z
      .string()
      .min(2)
      .max(140)
      .optional()
      .describe(
        "The stay the day-by-day plan is built on (an id from stays); the first stay by default",
      ),
    save: z
      .boolean()
      .default(false)
      .describe(
        "Also return trip_url: a link to this plan on dogpolicies.com, with the plan in the link itself. Nothing is stored",
      ),
    response_format: formatSchema().describe(
      "'markdown' for readable text, 'json' for structured data",
    ),
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    ...OutcomeFields,
    label: z.string(),
    radius_miles: z.number(),
    asked: z.looseObject({ dogs: z.number(), nights: z.number() }),
    stays: z.array(PlaceItem),
    stay_counts: z.record(z.string(), z.number()),
    days: z
      .array(
        z.looseObject({
          day: z.number(),
          date: z.string().nullable(),
          stay: SlotRef.nullable(),
          morning: SlotRef.nullable(),
          afternoon: SlotRef.nullable(),
          evening: SlotRef.nullable(),
          missing: z.record(z.string(), z.string()),
        }),
      )
      .optional()
      .describe(
        "The plan, one entry per night (up to 14): stay, morning beach/trail/off-leash area, afternoon park, dinner patio. A slot is a place record with its rule, quote, source and verified date, or null with the reason in missing",
      ),
    plan_stay: SlotRef.extend({
      verdict: z.string(),
      fee: z.looseObject({
        total: z.number().nullable(),
        per_night: z.number().nullable(),
        arithmetic: z.string(),
        based_on: z.string(),
      }),
      fit: z.looseObject({
        verdict: z.string(),
        weight: z.string(),
        pet_count: z.string(),
        reasons: z.array(z.string()),
      }),
    })
      .nullable()
      .optional()
      .describe(
        "The stay the plan is built on, with the pet fee for the whole stay (the same arithmetic as the hotel search) and whether the dog's weight and number fit",
      ),
    plan_notes: z.array(z.string()).optional(),
    trip_url: z
      .string()
      .nullable()
      .optional()
      .describe(
        "With save=true: https://dogpolicies.com/trips/#v1.… the plan as a page, carried in the link's fragment; nothing is stored",
      ),
    outings: z.array(
      z.looseObject({
        type: z.string(),
        label: z.string(),
        total: z.number(),
        places: z.array(PlaceItem),
      }),
    ),
    i5: z
      .looseObject({
        position: z.looseObject({ mile: z.number(), s: z.number() }),
        family_stops_north: z.array(PlaceItem),
        family_stops_south: z.array(PlaceItem),
        closed_now_stops: z
          .array(PlaceItem)
          .optional()
          .describe(
            "Family stops left out of the lists above because Caltrans reports the rest area fully closed now; each has closed_now",
          ),
        paired_stops: z.array(z.looseObject({})),
      })
      .nullable()
      .describe(
        "When the town is within 10 miles of I-5 in California: the trip's position on the I-5 axis, the next family stops in each direction within 60 miles, and the paired stops within 10 miles",
      ),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = resolveScope(ctx, args);
    const { dog_weight_lb, dogs, nights, max_total_fee } = args;
    if (scope.noMatch)
      return scopeAnswer(ctx, scope.noMatch, {
        format: args.response_format,
        shape: {
          label: args.place ?? "",
          radius_miles: args.radius_miles ?? 15,
          asked: {
            dog_weight_lb: dog_weight_lb ?? null,
            dogs,
            nights,
            max_total_fee: max_total_fee ?? null,
          },
          stays: [],
          stay_counts: { match: 0, possible: 0, excluded: 0 },
          days: [],
          plan_stay: null,
          plan_notes: [],
          trip_url: null,
          outings: [],
          i5: null,
        },
      });
    const today = ctx.today();
    const criteria = {
      weightLb: dog_weight_lb,
      dogs,
      nights,
      maxTotalFee: max_total_fee,
    };
    const found = scope.within(ctx.graph.places);
    const counts = { match: 0, possible: 0, excluded: 0 };
    const rank = { match: 0, possible: 1 };
    const ranked = found
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
      );
    const stays = ranked.slice(0, args.per_section).map((x) =>
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
    // The day-by-day plan: built on one stay, with its fee worked out.
    const planNotes = [];
    let chosen = ranked[0] ?? null;
    if (args.stay_id) {
      const hit = ranked.find((x) => x.place.id === args.stay_id);
      if (hit) chosen = hit;
      else
        planNotes.push(
          `stay_id "${args.stay_id}" is not among the stays that fit this dog and these criteria near ${scope.label}; the plan uses ${chosen ? chosen.place.name : "no stay"} instead.`,
        );
    }
    const planStay = chosen
      ? stayPlan(chosen.place, chosen.r, today, {
          dogs,
          nights,
          weightLb: dog_weight_lb,
        })
      : null;
    if (chosen?.r.verdict === "possible")
      planNotes.push(
        `${chosen.place.name} needs a call to confirm before booking: ${chosen.r.reasons.join(" ")}`,
      );
    const noPlan = !ranked.length && !outings.length;
    const plan = noPlan
      ? { days: [], truncated: false }
      : planDays({
          found,
          stayPlace: chosen?.place ?? null,
          stayRef: chosen
            ? {
                ...placeRef(chosen.place, today, {
                  distance: chosen.distance,
                  from: "destination",
                }),
                verdict: chosen.r.verdict,
              }
            : null,
          center: scope.center,
          radius: scope.radius,
          label: scope.label,
          nights,
          startDate: args.start_date ?? null,
          today,
        });
    if (plan.truncated)
      planNotes.push(
        `The plan shows the first ${MAX_DAYS} of ${nights} nights; ask again for the dates after that.`,
      );
    const days = plan.days;
    const slotIds = (slot) => days.map((d) => d[slot]?.id ?? null);
    const savedUrl =
      args.save && !noPlan
        ? tripUrl(ctx.citations.attribution.attribution_url, {
            destination: scope.label,
            start: args.start_date ?? null,
            nights,
            dogs,
            weightLb: dog_weight_lb ?? null,
            maxFee: max_total_fee ?? null,
            stay: chosen?.place.id ?? null,
            morning: slotIds("morning"),
            afternoon: slotIds("afternoon"),
            evening: slotIds("evening"),
          })
        : null;
    // The I-5 leg, when the town sits on the corridor.
    const i5Route = ctx.graph.routes[I5];
    const i5Axis = axisOf(i5Route);
    const pos =
      i5Axis && scope.center
        ? positionOf(i5Route, scope.center, { maxOffMiles: I5_REACH_MILES })
        : null;
    let i5 = null;
    if (pos) {
      const usable = await closuresFor(ctx);
      // The next family stops skip a rest area Caltrans reports closed now;
      // the closed ones are named beside them.
      const closedStops = [];
      const leg = (ahead) =>
        windowStops(i5Route, { startS: pos.s, ahead, aheadMiles: I5_LEG_MILES })
          .filter((x) => isFamilyStop(x.place))
          .filter((x) => {
            const closed = closedNowOf(x, usable);
            if (closed)
              closedStops.push(
                summary(x.place, today, {
                  mile: x.mile,
                  ...axisFields(x, { startS: pos.s, ahead }),
                  closed_now: closed,
                }),
              );
            return !closed;
          })
          .slice(0, args.per_section)
          .map((x) =>
            summary(x.place, today, {
              mile: x.mile,
              off_route_miles: x.off_miles,
              on_road: i5Route.short,
              exit: x.place.exit ?? null,
              ...axisFields(x, { startS: pos.s, ahead }),
            }),
          );
      i5 = {
        position: { mile: pos.mile, s: pos.s, off_miles: pos.off_miles },
        axis_version: i5Axis.version,
        family_stops_north: leg(true),
        family_stops_south: leg(false),
        ...(closedStops.length ? { closed_now_stops: closedStops } : {}),
        paired_stops: pairedIn(
          i5Axis,
          pos.s - I5_REACH_MILES * MILE_M,
          pos.s + I5_REACH_MILES * MILE_M,
        )
          .map((pr) => pairRow(pr, ctx.graph))
          .slice(0, args.per_section),
      };
    }
    const shown = [
      ...stays,
      ...days.flatMap((d) =>
        [d.morning, d.afternoon, d.evening].filter(Boolean),
      ),
      ...outings.flatMap((g) => g.places),
      ...(i5 ? [...i5.family_stops_north, ...i5.family_stops_south] : []),
    ];
    const askedWords = [
      dog_weight_lb && `${dog_weight_lb} lb dog`,
      dogs > 1 && `${dogs} dogs`,
      `${nights} night${nights > 1 ? "s" : ""}`,
      max_total_fee != null && `pet fees up to $${max_total_fee}`,
    ].filter(Boolean);
    // Nothing to stay at and nothing to do: say so, and name the nearest towns
    // that have records, so the trip can move rather than stop.
    const empty = !stays.length && !outings.length;
    const nearby = empty ? nearestTowns(ctx.graph, scope.center) : [];
    const emptyNext = empty
      ? [
          ...(counts.excluded
            ? [
                `${counts.excluded} stay${counts.excluded === 1 ? "" : "s"} nearby did not fit the dog or the budget: drop max_total_fee or dog_weight_lb to see them`,
              ]
            : []),
          `Widen radius_miles (now ${scope.radius})`,
          ...nearby
            .slice(0, 1)
            .map(
              (t) =>
                `place="${t.name}, ${t.state}" is the nearest town with records (${t.distance_miles} mi)`,
            ),
        ]
      : [];
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
      days,
      plan_stay: planStay,
      plan_notes: planNotes,
      trip_url: savedUrl,
      outings,
      i5,
      ...(empty
        ? {
            outcome: "no_match",
            code: "not_found",
            message: `No stays or outings in the data within ${scope.radius} miles of ${scope.label} that fit what was asked.`,
            did_you_mean: nearby,
            next: emptyNext,
          }
        : {}),
      ...(shown.some((s) => s.osm) ? { attribution: OSM_ATTRIBUTION } : {}),
    };
    return result(data, args.response_format, () => {
      const lines = [
        `# A trip to ${scope.label} with a dog (${askedWords.join(", ")}; within ${scope.radius} miles)`,
        "",
        ...planMarkdown({
          days,
          planStay,
          notes: planNotes,
          url: savedUrl,
        }),
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
      if (empty)
        lines.push(
          ...suggestionLines({ did_you_mean: nearby, next: emptyNext }),
        );
      if (i5) {
        const stopLine = (s) =>
          `${summaryLine(s)}\n  ${s.miles_ahead} mi along I-5 · ${s.side === "both" ? "both directions" : s.side === "right" ? "northbound side" : "southbound side"}${s.hours ? ` · ${s.hours.text}` : ""}`;
        lines.push(
          "",
          `## On I-5: mile ${i5.position.mile}, ${i5.position.off_miles} mi from the road`,
          "",
          `Family stops northbound within ${I5_LEG_MILES} miles (restrooms and a pet area or dog park stated by the source):`,
          ...(i5.family_stops_north.length
            ? i5.family_stops_north.map(stopLine)
            : ["- None within the leg."]),
          "",
          `Family stops southbound within ${I5_LEG_MILES} miles:`,
          ...(i5.family_stops_south.length
            ? i5.family_stops_south.map(stopLine)
            : ["- None within the leg."]),
          ...(i5.closed_now_stops?.length
            ? [
                "",
                `Left out, closed now (Caltrans, live feed, not a verified rule): ${i5.closed_now_stops.map((s) => `${s.name}, ${closureLine(s.closed_now).replace("Closed now: ", "")}`).join("; ")}.`,
              ]
            : []),
          "",
          `Paired stops within ${I5_REACH_MILES} miles (an exit with people-stops nearby, from OpenStreetMap, restrooms not verified, and the nearest dog-legal place):`,
          ...(i5.paired_stops.length
            ? i5.paired_stops.map(pairLine)
            : ["- None nearby."]),
        );
      }
      lines.push(...ctx.citations.footer(shown, { osmLine: OSM_ATTRIBUTION }));
      const text = lines.join("\n");
      return text.length <= LIMITS.resultCharacters
        ? text
        : text.slice(0, LIMITS.resultCharacters - 80) +
            "\n\n(Trimmed; ask for a smaller per_section.)";
    });
  },
});
